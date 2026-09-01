/**
 * Helpers puros del hilo del coach de Training.
 *
 * Se extraen del route para poder testearlos en aislamiento. Un "hilo" es el
 * conjunto de mensajes que comparten (clerk_id, plan_id) en
 * `training_coach_messages`; ver scripts/sql/2026-07-17-training-coach-messages.sql.
 */

export const COACH_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h rodantes
// Modelo NULL = default de la instancia (spec doc 11). El original fijaba el id
// de un LLM del consejo ("gemini"); aquí el default lo resuelve el servidor.
export const DEFAULT_LLM: string | null = null;

interface RoleContent {
  role: string;
  content: string;
}

/**
 * Construye el historial que se le pasa al LLM a partir de los mensajes del hilo.
 * - Solo user/assistant.
 * - Últimos 20 para acotar contexto.
 * - Descarta un último mensaje "user" colgado (aún sin respuesta).
 * - Recorta el inicio hasta que empiece con "user" (requisito de la API de Claude).
 */
export function buildLlmHistory(messages: RoleContent[]): RoleContent[] {
  let history = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-20)
    .map((m) => ({ role: m.role, content: m.content }));

  if (history.length > 0 && history[history.length - 1].role === "user") {
    history = history.slice(0, -1);
  }

  while (history.length > 0 && history[0].role !== "user") {
    history = history.slice(1);
  }

  return history;
}

/** LLM seleccionado = el del mensaje más reciente que tenga llm_id; si no, fallback. */
export function deriveSelectedLlm(
  messages: Array<{ llm_id?: string | null }>,
  fallback: string | null = DEFAULT_LLM
): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const id = messages[i].llm_id;
    if (id) return id;
  }
  return fallback;
}

/** ISO del corte de la ventana de vida (por defecto hace 24h). */
export function cutoffIso(now: number, windowMs: number = COACH_WINDOW_MS): string {
  return new Date(now - windowMs).toISOString();
}

/**
 * Normaliza el plan_id (query param o body) a number | null.
 * Trata "", "undefined", "null" y valores no numéricos como null (hilo sin plan).
 */
export function parsePlanId(raw: string | null): number | null {
  if (raw === null || raw === "" || raw === "undefined" || raw === "null") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * ¿Debe el route persistir el intercambio en el fallback post-stream?
 * Solo si hubo contenido, NO se guardó ya (en el chunk `done`) y NO hubo un chunk
 * `error`. Esto evita guardar un intercambio parcial cuando el LLM falla a media
 * respuesta (que el retry luego duplicaría).
 */
export function shouldPersistFallback(saved: boolean, errored: boolean, hasContent: boolean): boolean {
  return !saved && !errored && hasContent;
}
