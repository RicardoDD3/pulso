// Lógica pura del registro rápido de pesas (QuickLogModal, modo "strength").
// El usuario captura peso + cuántos sets + cuántas reps, y el modal dispara un
// POST a /api/training/exercise-sets por cada set (el route auto-incrementa
// set_number, así que tienen que ir uno por uno y en orden).

/** Sets que trae precargados el modal. */
export const DEFAULT_SETS = 3;
/** Reps por set que trae precargadas el modal. */
export const DEFAULT_REPS = 5;
/** Tope de sets por ejercicio por día en la API (mismo límite aquí). */
export const MAX_SETS_PER_ENTRY = 20;
/** Límites del route de exercise-sets. */
const MAX_WEIGHT = 1000;
const MAX_REPS = 200;

export interface SetEntryInput {
  weight: string;
  sets: string;
  reps: string;
}

export type SetEntryResult =
  | { ok: true; weightKg: number; sets: number; reps: number }
  | { ok: false; error: string };

/**
 * Valida lo capturado en el modal contra los mismos límites que la API, para
 * no mandar POSTs que el server va a rechazar. Un solo error a la vez, en el
 * orden en que aparecen los campos.
 */
// TODO(i18n): los mensajes de error y labels de este módulo son visibles al usuario.
export function parseSetEntry({ weight, sets, reps }: SetEntryInput): SetEntryResult {
  const weightKg = parseFloat(weight);
  if (!Number.isFinite(weightKg) || weightKg < 0 || weightKg > MAX_WEIGHT) {
    return { ok: false, error: "Peso inválido" };
  }

  const setCount = parseInt(sets, 10);
  if (!Number.isFinite(setCount) || setCount < 1 || setCount > MAX_SETS_PER_ENTRY) {
    return { ok: false, error: `Sets debe ser entre 1 y ${MAX_SETS_PER_ENTRY}` };
  }

  const repCount = parseInt(reps, 10);
  if (!Number.isFinite(repCount) || repCount < 1 || repCount > MAX_REPS) {
    return { ok: false, error: `Reps debe ser entre 1 y ${MAX_REPS}` };
  }

  return { ok: true, weightKg, sets: setCount, reps: repCount };
}

/** Texto del botón: dice exactamente qué se va a guardar. */
export function formatAddSetsLabel(sets: string, reps: string): string {
  const setCount = parseInt(sets, 10);
  const repCount = parseInt(reps, 10);
  if (!Number.isFinite(setCount) || !Number.isFinite(repCount)) return "+ Sets";
  return `+ ${setCount} ${setCount === 1 ? "set" : "sets"} × ${repCount} reps`;
}
