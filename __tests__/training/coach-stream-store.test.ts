import { consumeStream } from "@/lib/streaming/client";
import {
  getSnapshot,
  hydrate,
  send,
  setLlmId,
  removeLastUserMessage,
  clearError,
  _resetForTests,
} from "@/lib/training/coach-stream-store";

jest.mock("@/lib/streaming/client", () => ({
  consumeStream: jest.fn(),
}));

const mockConsume = consumeStream as jest.MockedFunction<typeof consumeStream>;

/** Helper: arma un mock de fetch que responde según la URL. */
function mockFetch(handlers: {
  get?: (url: string) => { ok: boolean; body?: unknown };
  post?: () => { ok: boolean; body?: unknown };
}) {
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const isPost = init?.method === "POST";
    const res = isPost
      ? handlers.post?.() ?? { ok: true, body: {} }
      : handlers.get?.(url) ?? { ok: true, body: { messages: [], llmId: "gemini" } };
    return {
      ok: res.ok,
      json: async () => res.body,
      body: {},
    } as Response;
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  _resetForTests();
  mockConsume.mockReset();
  mockFetch({});
});

describe("coach-stream-store (DB-backed)", () => {
  it("hydrate carga el historial desde la DB (GET)", async () => {
    mockFetch({
      get: () => ({
        ok: true,
        body: {
          messages: [
            { id: 1, role: "user", content: "hola" },
            { id: 2, role: "assistant", content: "que tal" },
          ],
          llmId: "claude",
        },
      }),
    });

    await hydrate(10);
    const s = getSnapshot(10);
    expect(s.messages.map((m) => m.content)).toEqual(["hola", "que tal"]);
    expect(s.llmId).toBe("claude");
    expect(s.hydrating).toBe(false);
  });

  it("hydrate es idempotente (no re-fetchea)", async () => {
    const spy = jest.fn(() => ({ ok: true, body: { messages: [], llmId: "gemini" } }));
    mockFetch({ get: spy });
    await hydrate(10);
    await hydrate(10);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("hydrate no truena si el GET falla (queda vacío)", async () => {
    mockFetch({ get: () => ({ ok: false, body: { error: "boom" } }) });
    await hydrate(10);
    expect(getSnapshot(10).messages).toEqual([]);
    expect(getSnapshot(10).hydrating).toBe(false);
  });

  it("send agrega el mensaje del usuario, transmite y agrega la respuesta", async () => {
    mockConsume.mockImplementation(async (_res, cb) => {
      cb.onChunk("Hola ");
      cb.onChunk("mundo");
      cb.onDone();
      return { content: "Hola mundo" };
    });

    await send(10, { text: "pregunta" });

    const s = getSnapshot(10);
    expect(s.streaming).toBe(false);
    expect(s.messages.map((m) => m.content)).toEqual(["pregunta", "Hola mundo"]);
    expect(s.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("send POSTea a la ruta de chat con message/llm_id/plan_id", async () => {
    let capturedBody: Record<string, unknown> | null = null;
    global.fetch = jest.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") capturedBody = JSON.parse(String(init.body));
      return { ok: true, json: async () => ({}), body: {} } as Response;
    }) as unknown as typeof fetch;
    mockConsume.mockImplementation(async (_res, cb) => {
      cb.onChunk("ok");
      cb.onDone();
      return { content: "ok" };
    });

    await send(10, { text: "hola" });

    // llm_id null = default de la instancia (spec doc 11); antes era "gemini".
    expect(capturedBody).toMatchObject({ message: "hola", llm_id: null, plan_id: 10 });
  });

  it("los ids optimistas son negativos (no chocan con los reales de la DB)", async () => {
    mockConsume.mockImplementation(async (_res, cb) => {
      cb.onChunk("x");
      cb.onDone();
      return { content: "x" };
    });
    await send(10, { text: "hola" });
    const ids = getSnapshot(10).messages.map((m) => m.id);
    expect(ids.every((id) => id < 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length); // únicos
  });

  it("send marca error cuando el fetch no es ok", async () => {
    mockFetch({ post: () => ({ ok: false, body: { error: "boom" } }) });

    await send(10, { text: "falla" });

    const s = getSnapshot(10);
    expect(s.streaming).toBe(false);
    expect(s.error).toContain("boom");
    expect(s.lastFailedMessage).toBe("falla");
  });

  it("removeLastUserMessage + clearError permiten reintentar", async () => {
    mockFetch({ post: () => ({ ok: false, body: { error: "boom" } }) });
    await send(10, { text: "falla" });
    expect(getSnapshot(10).messages).toHaveLength(1);

    removeLastUserMessage(10, "falla");
    clearError(10);
    const s = getSnapshot(10);
    expect(s.messages).toHaveLength(0);
    expect(s.error).toBeNull();
    expect(s.lastFailedMessage).toBeNull();
  });

  it("setLlmId cambia el LLM seleccionado (bloqueado durante streaming)", () => {
    setLlmId(10, "grok");
    expect(getSnapshot(10).llmId).toBe("grok");
  });

  it("mantiene estado separado por planId", async () => {
    mockConsume.mockImplementation(async (_res, cb) => {
      cb.onChunk("a");
      cb.onDone();
      return { content: "a" };
    });
    await send(10, { text: "para plan 10" });
    expect(getSnapshot(11).messages).toHaveLength(0);
    expect(getSnapshot(10).messages).toHaveLength(2);
  });

  it("getSnapshot devuelve la misma referencia si no cambió el estado (useSyncExternalStore)", () => {
    const a = getSnapshot(10);
    const b = getSnapshot(10);
    expect(a).toBe(b);
  });

  it("getSnapshot devuelve una referencia NUEVA tras cambiar el estado", () => {
    const before = getSnapshot(10);
    setLlmId(10, "grok");
    const after = getSnapshot(10);
    expect(after).not.toBe(before);
    expect(after.llmId).toBe("grok");
  });

  it("hydrate NO pisa mensajes existentes si un send optimista ganó la carrera", async () => {
    mockConsume.mockImplementation(async (_res, cb) => {
      cb.onChunk("respuesta");
      cb.onDone();
      return { content: "respuesta" };
    });
    await send(10, { text: "pregunta viva" });
    // Ahora el GET del hydrate devolvería historial DISTINTO; no debe pisar.
    mockFetch({
      get: () => ({ ok: true, body: { messages: [{ id: 99, role: "user", content: "viejo" }], llmId: "grok" } }),
    });
    await hydrate(10);
    expect(getSnapshot(10).messages.map((m) => m.content)).toEqual(["pregunta viva", "respuesta"]);
  });

  it("hydrate se puede reintentar tras un GET fallido (no queda deshabilitado para siempre)", async () => {
    const calls: string[] = [];
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      calls.push(String(input));
      const ok = calls.length > 1; // primer intento falla, segundo ok
      return {
        ok,
        json: async () => (ok ? { messages: [{ id: 1, role: "user", content: "hola" }], llmId: "gemini" } : { error: "boom" }),
        body: {},
      } as Response;
    }) as unknown as typeof fetch;

    await hydrate(10);
    expect(getSnapshot(10).messages).toHaveLength(0);
    // Un segundo hydrate (remonte) SÍ reintenta porque el fallo reseteó el flag.
    await hydrate(10);
    expect(getSnapshot(10).messages.map((m) => m.content)).toEqual(["hola"]);
    expect(calls).toHaveLength(2);
  });

  it("send es no-op con texto vacío o solo espacios (no llama fetch)", async () => {
    const fetchSpy = global.fetch as jest.Mock;
    await send(10, { text: "" });
    await send(10, { text: "   " });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(getSnapshot(10).messages).toHaveLength(0);
  });

  it("send concurrente durante streaming es no-op (segundo envío ignorado)", async () => {
    let releaseGate: () => void = () => {};
    const gate = new Promise<void>((r) => (releaseGate = r));
    mockConsume.mockImplementation(async (_res, cb) => {
      cb.onChunk("parcial");
      await gate;
      cb.onDone();
      return { content: "parcial" };
    });

    const first = send(10, { text: "primero" });
    expect(getSnapshot(10).streaming).toBe(true);
    await send(10, { text: "segundo (ignorado)" }); // no-op: ya está streaming
    expect(getSnapshot(10).messages.map((m) => m.content)).toEqual(["primero"]);

    releaseGate();
    await first;
    expect(getSnapshot(10).streaming).toBe(false);
  });

  it("setLlmId es ignorado mientras hay streaming en curso", async () => {
    let releaseGate: () => void = () => {};
    const gate = new Promise<void>((r) => (releaseGate = r));
    mockConsume.mockImplementation(async (_res, cb) => {
      await gate;
      cb.onChunk("x");
      cb.onDone();
      return { content: "x" };
    });

    const p = send(10, { text: "hola" });
    expect(getSnapshot(10).streaming).toBe(true);
    setLlmId(10, "claude");
    expect(getSnapshot(10).llmId).toBeNull(); // sin cambio durante streaming (default null)

    releaseGate();
    await p;
    setLlmId(10, "claude"); // ya no hay streaming → ahora sí cambia
    expect(getSnapshot(10).llmId).toBe("claude");
  });

  it("maneja el hilo sin plan (planId undefined, key 'no-plan') aislado de los planes", async () => {
    mockConsume.mockImplementation(async (_res, cb) => {
      cb.onChunk("sin plan");
      cb.onDone();
      return { content: "sin plan" };
    });
    await send(undefined, { text: "hola sin plan" });
    expect(getSnapshot(undefined).messages.map((m) => m.content)).toEqual(["hola sin plan", "sin plan"]);
    expect(getSnapshot(10).messages).toHaveLength(0);
  });

  it("send envía plan_id undefined en el body cuando no hay plan", async () => {
    let capturedBody: Record<string, unknown> | null = null;
    global.fetch = jest.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") capturedBody = JSON.parse(String(init.body));
      return { ok: true, json: async () => ({}), body: {} } as Response;
    }) as unknown as typeof fetch;
    mockConsume.mockImplementation(async (_res, cb) => {
      cb.onChunk("ok");
      cb.onDone();
      return { content: "ok" };
    });
    await send(undefined, { text: "hola" });
    expect(capturedBody).not.toBeNull();
    expect(Object.keys(capturedBody ?? {})).not.toContain("plan_id"); // undefined se omite al serializar
  });

  it("onError('terminated') no marca error (aborto silencioso)", async () => {
    mockConsume.mockImplementation(async (_res, cb) => {
      cb.onError("terminated");
      return { content: "", error: "terminated" };
    });
    await send(10, { text: "hola" });
    const s = getSnapshot(10);
    expect(s.error).toBeNull();
    expect(s.streaming).toBe(false);
  });

  it("respuesta vacía (onDone sin contenido) avisa y ofrece reintentar", async () => {
    mockConsume.mockImplementation(async (_res, cb) => {
      cb.onDone();
      return { content: "" };
    });
    await send(10, { text: "hola" });
    const s = getSnapshot(10);
    expect(s.error).toContain("no devolvió respuesta");
    expect(s.lastFailedMessage).toBe("hola");
    // No se agregó un assistant vacío
    expect(s.messages.filter((m) => m.role === "assistant")).toHaveLength(0);
  });

  it("removeLastUserMessage no hace nada si el contenido no coincide", async () => {
    mockFetch({ post: () => ({ ok: false, body: { error: "boom" } }) });
    await send(10, { text: "real" });
    removeLastUserMessage(10, "otro texto");
    expect(getSnapshot(10).messages.map((m) => m.content)).toEqual(["real"]);
  });

  it("removeLastUserMessage salta mensajes assistant y quita el último user", async () => {
    // Semilla: user + assistant vía un send exitoso, luego un user colgado por error.
    mockConsume.mockImplementation(async (_res, cb) => {
      cb.onChunk("ok");
      cb.onDone();
      return { content: "ok" };
    });
    await send(10, { text: "primero" });
    mockFetch({ post: () => ({ ok: false, body: { error: "boom" } }) });
    await send(10, { text: "segundo colgado" });
    expect(getSnapshot(10).messages.map((m) => `${m.role}:${m.content}`)).toEqual([
      "user:primero",
      "assistant:ok",
      "user:segundo colgado",
    ]);
    removeLastUserMessage(10, "segundo colgado");
    expect(getSnapshot(10).messages.map((m) => `${m.role}:${m.content}`)).toEqual([
      "user:primero",
      "assistant:ok",
    ]);
  });
});
