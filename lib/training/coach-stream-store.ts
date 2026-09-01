/**
 * Store del chat del coach de Training a nivel de módulo.
 *
 * Fuente de verdad: la DB de Garmin (tabla `training_coach_messages`), vía las
 * rutas `/api/training/coach/messages` (GET, historial de 24h) y
 * `/api/training/coach/chat` (POST, que persiste el intercambio al terminar).
 * Así el historial está disponible en móvil y escritorio.
 *
 * El store vive fuera del árbol de React, así que el stream sobrevive a que el
 * componente se desmonte (cambio de tab/página dentro de la SPA): la respuesta
 * se sigue escribiendo y, al terminar, el servidor la guarda. Ambos montajes del
 * coach (desktop + mobile) se suscriben al mismo estado por plan.
 */
import { consumeStream } from "@/lib/streaming/client";
import { DEFAULT_LLM } from "@/lib/training/coach-thread";

export interface CoachChatMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
}

export interface CoachStreamState {
  messages: CoachChatMessage[];
  /** null = default de la instancia (spec doc 11); ver DEFAULT_LLM. */
  llmId: string | null;
  streaming: boolean;
  streamContent: string;
  streamReasoning: string;
  error: string | null;
  lastFailedMessage: string | null;
  hydrating: boolean;
}

type Listener = () => void;

interface Entry extends CoachStreamState {
  listeners: Set<Listener>;
  abort: AbortController | null;
  hydrated: boolean;
  snapshot: CoachStreamState;
}

const store = new Map<string, Entry>();

function keyOf(planId: number | undefined): string {
  return String(planId ?? "no-plan");
}

function makeSnapshot(e: Entry): CoachStreamState {
  return {
    messages: e.messages,
    llmId: e.llmId,
    streaming: e.streaming,
    streamContent: e.streamContent,
    streamReasoning: e.streamReasoning,
    error: e.error,
    lastFailedMessage: e.lastFailedMessage,
    hydrating: e.hydrating,
  };
}

function getEntry(planId: number | undefined): Entry {
  const key = keyOf(planId);
  let e = store.get(key);
  if (!e) {
    const base: CoachStreamState = {
      messages: [],
      llmId: DEFAULT_LLM,
      streaming: false,
      streamContent: "",
      streamReasoning: "",
      error: null,
      lastFailedMessage: null,
      hydrating: false,
    };
    e = {
      ...base,
      listeners: new Set(),
      abort: null,
      hydrated: false,
      snapshot: base,
    };
    store.set(key, e);
  }
  return e;
}

function emit(e: Entry): void {
  e.snapshot = makeSnapshot(e);
  e.listeners.forEach((l) => l());
}

/* ------------------------------------------------------------------ */
/* Suscripción (useSyncExternalStore)                                 */
/* ------------------------------------------------------------------ */

export function subscribe(planId: number | undefined, listener: Listener): () => void {
  const e = getEntry(planId);
  e.listeners.add(listener);
  return () => {
    e.listeners.delete(listener);
  };
}

export function getSnapshot(planId: number | undefined): CoachStreamState {
  return getEntry(planId).snapshot;
}

/* ------------------------------------------------------------------ */
/* Acciones                                                           */
/* ------------------------------------------------------------------ */

/** Carga el historial (últimas 24h) desde la DB. Idempotente por plan. */
export async function hydrate(planId: number | undefined): Promise<void> {
  const e = getEntry(planId);
  if (e.hydrated) return;
  // Marca hydrated antes del await para evitar fetches concurrentes; si el GET
  // falla se resetea abajo para que un remonte/recarga vuelva a intentar.
  e.hydrated = true;
  e.hydrating = true;
  emit(e);
  let ok = false;
  try {
    // Ruta nueva: el historial del coach de Tracking vive en /api/coach/tracking
    // (antes /api/training/coach/messages).
    const res = await fetch(`/api/coach/tracking/messages?plan_id=${planId ?? ""}`);
    if (res.ok) {
      ok = true;
      const data = await res.json();
      // No pisar si ya hay mensajes (p.ej. un send optimista ganó la carrera).
      if (Array.isArray(data.messages) && e.messages.length === 0) {
        e.messages = data.messages.map((m: { id: number | string; role: string; content: string }) => ({
          id: Number(m.id),
          role: m.role === "assistant" ? "assistant" : "user",
          content: m.content,
        }));
        if (typeof data.llmId === "string") e.llmId = data.llmId;
      }
    }
  } catch {
    // Red no disponible: se reintenta al volver a montar/recargar.
  } finally {
    if (!ok) e.hydrated = false; // permite reintentar la hidratación
    e.hydrating = false;
    emit(e);
  }
}

export function setLlmId(planId: number | undefined, llmId: string): void {
  const e = getEntry(planId);
  if (e.streaming) return;
  e.llmId = llmId;
  emit(e);
}

export function clearError(planId: number | undefined): void {
  const e = getEntry(planId);
  e.error = null;
  e.lastFailedMessage = null;
  emit(e);
}

/** Quita el último mensaje del usuario si coincide (para reintentar en memoria). */
export function removeLastUserMessage(planId: number | undefined, content: string): void {
  const e = getEntry(planId);
  const idx = e.messages.findLastIndex((m) => m.role === "user");
  if (idx >= 0 && e.messages[idx].content === content) {
    e.messages = e.messages.slice(0, idx);
    emit(e);
  }
}

interface SendOptions {
  text: string;
}

let optimisticIdSeq = 0;
function optimisticId(): number {
  // ids negativos para no colisionar con los ids reales (bigint positivo) de la DB.
  optimisticIdSeq += 1;
  return -optimisticIdSeq;
}

export async function send(planId: number | undefined, opts: SendOptions): Promise<void> {
  const e = getEntry(planId);
  const text = opts.text.trim();
  if (!text || e.streaming) return;

  e.streaming = true;
  e.streamContent = "";
  e.streamReasoning = "";
  e.error = null;
  e.lastFailedMessage = null;

  const userMsg: CoachChatMessage = { id: optimisticId(), role: "user", content: text };
  e.messages = [...e.messages, userMsg];
  emit(e);

  try {
    const controller = new AbortController();
    e.abort = controller;

    // Ruta nueva: el POST del chat del coach de Tracking vive en
    // /api/coach/tracking/chat (antes /api/training/coach/chat).
    const res = await fetch(`/api/coach/tracking/chat?stream=true`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: text,
        llm_id: e.llmId,
        plan_id: planId ?? undefined,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Error" }));
      e.error = `Error: ${err.error}`;
      e.lastFailedMessage = text;
      e.streaming = false;
      e.abort = null;
      emit(e);
      return;
    }

    let fullContent = "";
    let fullReasoning = "";
    await consumeStream(res, {
      onChunk: (content) => {
        fullContent += content;
        e.streamContent = fullContent;
        emit(e);
      },
      onReasoning: (content) => {
        fullReasoning += content;
        e.streamReasoning = fullReasoning;
        emit(e);
      },
      onDone: () => {
        if (fullContent) {
          e.messages = [...e.messages, { id: optimisticId(), role: "assistant", content: fullContent }];
        } else {
          // Respuesta vacía: el servidor no guardó nada. Avisa y deja reintentar
          // en vez de perder el mensaje del usuario en silencio.
          // TODO(i18n): mensajes de error visibles al usuario en este módulo.
          e.error = "El coach no devolvió respuesta. Intenta de nuevo.";
          e.lastFailedMessage = text;
        }
        e.streamContent = "";
        e.streamReasoning = "";
        e.streaming = false;
        e.abort = null;
        emit(e);
      },
      onError: (err) => {
        if (err !== "terminated") {
          e.error = `Error: ${err}`;
          e.lastFailedMessage = text;
        }
        e.streaming = false;
        e.abort = null;
        emit(e);
      },
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      e.streaming = false;
      e.abort = null;
      emit(e);
      return;
    }
    e.error = `Error: ${err instanceof Error ? err.message : String(err)}`;
    e.lastFailedMessage = text;
    e.streaming = false;
    e.abort = null;
    emit(e);
  }
}

/** Solo para tests: limpia el store singleton entre casos. */
export function _resetForTests(): void {
  store.clear();
  optimisticIdSeq = 0;
}
