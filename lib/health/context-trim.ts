/**
 * Presupuesto de contexto (spec doc 08, regla dura §budget — nueva en Pulso).
 *
 * El original confiaba en el 1M de contexto de DeepSeek; Pulso no puede asumir
 * el modelo. Antes de armar el prompt final se estima su tamaño (~chars/4) y,
 * si excede MAX_CONTEXT_TOKENS, se recortan los bloques en orden inverso de
 * valor: primero el registro diario (90 → 45 días), luego el detalle de
 * actividades (15 → 10 días). Cada recorte se anota DENTRO del propio bloque
 * para que el LLM sepa que la ventana anunciada quedó reducida.
 *
 * Todo puro: entra la lista de bloques con nombre, sale la lista recortada.
 */

export interface ContextBlock {
  name: string;
  text: string;
}

/** Días a los que se recorta el registro diario cuando el prompt excede el presupuesto. */
export const DAILY_LOG_TRIM_DAYS = 45;
/** Días a los que se recorta el detalle de actividades en el segundo paso. */
export const ACTIVITY_DETAIL_TRIM_DAYS = 10;

/** Nombres reservados que el recorte sabe tratar. */
export const DAILY_LOG_BLOCK = "daily-log";
export const ACTIVITY_DETAIL_BLOCK = "activity-detail";

/** Estimación barata de tokens (~4 chars/token; no vale la pena tiktoken aquí). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

const DAY_LINE = /^ {2}\d{4}-\d{2}-\d{2}: /;

/** Recorta el bloque "REGISTRO DIARIO COMPLETO" a sus últimos `days` líneas-día. */
function trimDailyLog(text: string, days: number): string {
  const lines = text.split("\n");
  const dayLines = lines.filter((l) => DAY_LINE.test(l));
  if (dayLines.length <= days) return text;
  const header = lines.filter((l) => !DAY_LINE.test(l));
  const note = `  [Recortado por presupuesto de contexto: solo los últimos ${days} días de ${dayLines.length}.]`;
  return [...header, note, ...dayLines.slice(-days)].join("\n");
}

/** Recorta el detalle de actividades a las entradas de los `days` días más recientes. */
function trimActivityDetail(text: string, days: number): string {
  const entries = text.split("\n\n");
  const dateOf = (entry: string): string | null => {
    const m = entry.match(/^\[(\d{4}-\d{2}-\d{2})\]/);
    return m ? m[1] : null;
  };
  const dates = [...new Set(entries.map(dateOf).filter((d): d is string => d != null))]
    .sort()
    .reverse();
  if (dates.length <= days) return text;
  const keep = new Set(dates.slice(0, days));
  const kept = entries.filter((e) => {
    const d = dateOf(e);
    return d == null || keep.has(d);
  });
  const note = `[Recortado por presupuesto de contexto: solo los últimos ${days} días con actividades, de ${dates.length}.]`;
  return [...kept, note].join("\n\n");
}

export interface TrimResult {
  blocks: ContextBlock[];
  /** Nombres de los bloques que sí se recortaron (vacío = todo cupo). */
  trimmed: string[];
}

/**
 * Aplica el presupuesto sobre el TOTAL de los bloques. Solo conoce dos
 * recortes (registro diario y detalle de actividades, en ese orden); si aun
 * así no cabe, se devuelve tal cual — el caller ya hizo lo que el spec pide.
 */
export function trimContextToBudget(blocks: ContextBlock[], maxTokens: number): TrimResult {
  const total = (bs: ContextBlock[]) => bs.reduce((sum, b) => sum + estimateTokens(b.text), 0);
  let current = blocks;
  const trimmed: string[] = [];
  if (total(current) <= maxTokens) return { blocks: current, trimmed };

  const apply = (name: string, fn: (text: string) => string) => {
    let changed = false;
    current = current.map((b) => {
      if (b.name !== name) return b;
      const text = fn(b.text);
      if (text !== b.text) changed = true;
      return { ...b, text };
    });
    if (changed) trimmed.push(name);
  };

  apply(DAILY_LOG_BLOCK, (t) => trimDailyLog(t, DAILY_LOG_TRIM_DAYS));
  if (total(current) > maxTokens) {
    apply(ACTIVITY_DETAIL_BLOCK, (t) => trimActivityDetail(t, ACTIVITY_DETAIL_TRIM_DAYS));
  }
  return { blocks: current, trimmed };
}
