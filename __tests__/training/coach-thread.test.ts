import {
  buildLlmHistory,
  deriveSelectedLlm,
  cutoffIso,
  parsePlanId,
  shouldPersistFallback,
} from "@/lib/training/coach-thread";

describe("coach-thread", () => {
  describe("buildLlmHistory", () => {
    it("mapea a {role, content} y conserva orden", () => {
      const out = buildLlmHistory([
        { role: "user", content: "a" },
        { role: "assistant", content: "b" },
      ]);
      expect(out).toEqual([
        { role: "user", content: "a" },
        { role: "assistant", content: "b" },
      ]);
    });

    it("descarta el último mensaje si es del usuario (colgado)", () => {
      const out = buildLlmHistory([
        { role: "user", content: "a" },
        { role: "assistant", content: "b" },
        { role: "user", content: "colgado" },
      ]);
      expect(out).toEqual([
        { role: "user", content: "a" },
        { role: "assistant", content: "b" },
      ]);
    });

    it("recorta el inicio hasta empezar con user (requisito de Claude)", () => {
      const out = buildLlmHistory([
        { role: "assistant", content: "saludo huérfano" },
        { role: "user", content: "a" },
        { role: "assistant", content: "b" },
      ]);
      expect(out[0]).toEqual({ role: "user", content: "a" });
    });

    it("limita a los ÚLTIMOS 20 mensajes conservando el orden", () => {
      // 30 mensajes 0..29; los últimos 20 son 10..29, empezando en un "user".
      const many = Array.from({ length: 30 }, (_, i) => ({
        role: i % 2 === 0 ? "user" : "assistant",
        content: String(i),
      }));
      const out = buildLlmHistory(many);
      expect(out.length).toBe(20);
      expect(out[0].content).toBe("10"); // primer elemento de los últimos 20 (par → user)
      expect(out[out.length - 1].content).toBe("29");
      // Orden estrictamente creciente
      const nums = out.map((m) => Number(m.content));
      expect(nums).toEqual([...nums].sort((a, b) => a - b));
    });

    it("ignora roles que no son user/assistant", () => {
      const out = buildLlmHistory([
        { role: "system", content: "x" },
        { role: "user", content: "a" },
        { role: "assistant", content: "b" },
      ]);
      expect(out).toEqual([
        { role: "user", content: "a" },
        { role: "assistant", content: "b" },
      ]);
    });

    it("devuelve [] con lista vacía", () => {
      expect(buildLlmHistory([])).toEqual([]);
    });
  });

  describe("deriveSelectedLlm", () => {
    it("toma el llm_id del mensaje más reciente que lo tenga", () => {
      expect(
        deriveSelectedLlm([
          { llm_id: "claude" },
          { llm_id: "grok" },
          { llm_id: null },
        ])
      ).toBe("grok");
    });

    it("cae al fallback cuando ninguno tiene llm_id", () => {
      // DEFAULT_LLM = null: modelo NULL = default de la instancia (spec doc 11).
      expect(deriveSelectedLlm([{ llm_id: null }, { llm_id: undefined }])).toBeNull();
    });

    it("cae al fallback con lista vacía", () => {
      expect(deriveSelectedLlm([])).toBeNull();
    });

    it("respeta un fallback personalizado", () => {
      expect(deriveSelectedLlm([], "chatgpt")).toBe("chatgpt");
    });
  });

  describe("cutoffIso", () => {
    it("calcula el ISO de hace 24h por defecto", () => {
      const now = Date.parse("2026-07-17T12:00:00.000Z");
      expect(cutoffIso(now)).toBe("2026-07-16T12:00:00.000Z");
    });

    it("acepta una ventana personalizada", () => {
      const now = Date.parse("2026-07-17T12:00:00.000Z");
      expect(cutoffIso(now, 60 * 60 * 1000)).toBe("2026-07-17T11:00:00.000Z");
    });
  });

  describe("parsePlanId", () => {
    it("convierte un número válido", () => {
      expect(parsePlanId("10")).toBe(10);
    });

    it("trata null/vacío/'undefined'/'null' como null", () => {
      expect(parsePlanId(null)).toBeNull();
      expect(parsePlanId("")).toBeNull();
      expect(parsePlanId("undefined")).toBeNull();
      expect(parsePlanId("null")).toBeNull();
    });

    it("trata no-numérico como null", () => {
      expect(parsePlanId("abc")).toBeNull();
    });
  });

  describe("shouldPersistFallback", () => {
    it("persiste solo con contenido, sin guardado previo y sin error", () => {
      expect(shouldPersistFallback(false, false, true)).toBe(true);
    });

    it("NO persiste si ya se guardó (en el chunk done)", () => {
      expect(shouldPersistFallback(true, false, true)).toBe(false);
    });

    it("NO persiste si hubo un chunk de error (respuesta parcial del LLM)", () => {
      expect(shouldPersistFallback(false, true, true)).toBe(false);
    });

    it("NO persiste si no hubo contenido", () => {
      expect(shouldPersistFallback(false, false, false)).toBe(false);
    });
  });
});
