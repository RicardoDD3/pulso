// run-assignment.ts — Asignación de carreras Garmin a sesiones del día.
// Cada carrera del día pertenece a UNA sesión (principal, extra, "ninguna", o
// "Z2 detectado"): en un día de SOLO calidad (HIIT), un 2º entrenamiento suave
// (swing de FC bajo, isEasyRun) NO es HIIT — se reconoce como Z2 bonus, no cubre
// el HIIT y cuenta como km fáciles. El auto se recalcula desde cero
// (determinístico); solo los overrides manuales (day.runOverrides) persisten y
// ganan. Reemplaza al reparto en cascada (splitDayActual).

import type { GeneratedDay, SessionType, ExtraSession } from "./plan-generator-types";
import type { RunAggregate } from "./activity-match";

export const MAIN_REF = "main";
export const NONE_REF = "none";
/** Ref sintético: una carrera detectada como Z2 fácil en un día de solo calidad
 *  (un 2º entrenamiento suave que NO es HIIT). Cuenta como Z2, no como HIIT. */
export const Z2_BONUS_REF = "z2-bonus";

/** Swing de FC (max − avg) a partir del cual una carrera se considera calidad
 *  (HIIT/intervalos). Por debajo es fácil (Z2). */
export const HIIT_SPREAD_THRESHOLD = 28;

export interface AssignableRun {
  activity_id: number;
  distance_meters: number | null;
  duration_seconds: number | null;
  avg_hr: number | null;
  max_hr: number | null;
}

/**
 * Una carrera "fácil" (Z2): swing de FC bajo (no son intervalos). Sin datos de
 * FC no se puede afirmar → NO se marca fácil (se respeta el tipo planeado del
 * día). Se usa para reconocer que un 2º entrenamiento suave en un día HIIT es
 * en realidad Z2.
 */
export function isEasyRun(r: AssignableRun): boolean {
  if (r.max_hr == null || r.avg_hr == null) return false;
  return r.max_hr - r.avg_hr < HIIT_SPREAD_THRESHOLD;
}

export interface SessionSlot {
  ref: string; // MAIN_REF o el id del extra
  sessionType: SessionType;
  distanceKm: number;
  isExtra: boolean;
}

export interface DayActuals {
  main: number | null;
  extras: Record<string, number | null>;
  /** Km de carreras detectadas Z2 fáciles sin slot (2º entreno suave en día HIIT). */
  bonusZ2: number;
  assignments: Record<number, string>;
}

const round1 = (x: number) => Math.round(x * 10) / 10;
const kmOf = (r: AssignableRun) => Number(r.distance_meters || 0) / 1000;

/**
 * Para la vista: separa los pendientes (origin "carryover") del MISMO tipo que
 * la sesión principal del día — se FUNDEN en su número ("sumado a la próxima
 * sesión del mismo tipo") — de los demás extras, que se muestran como cuadrito
 * aparte. Un carryover de otro tipo (p. ej. si se cambió el tipo del día a mano
 * entre syncs) cae a chips para no perderse. Un día rest/0 km no funde nada.
 */
export function partitionExtrasForDisplay(day: GeneratedDay): {
  folded: ExtraSession[];
  chips: ExtraSession[];
} {
  const folded: ExtraSession[] = [];
  const chips: ExtraSession[] = [];
  const isRun = day.sessionType !== "rest" && (day.distanceKm || 0) > 0;
  for (const e of day.extraSessions ?? []) {
    if (isRun && e.origin === "carryover" && e.sessionType === day.sessionType) folded.push(e);
    else chips.push(e);
  }
  return { folded, chips };
}

/** Cuadritos de correr del día en orden: principal primero, luego extras. */
export function daySessionSlots(day: GeneratedDay): SessionSlot[] {
  const slots: SessionSlot[] = [];
  // Un día no-rest expone su slot principal aunque tenga 0 km: si le sacaron
  // la sesión (se arrastró a otro día) y ya había carrera Garmin, esa carrera
  // tiene que seguir contando en vez de caer a "excluida".
  if (day.sessionType !== "rest") {
    slots.push({
      ref: MAIN_REF,
      sessionType: day.sessionType,
      distanceKm: day.distanceKm,
      isExtra: false,
    });
  }
  for (const e of day.extraSessions ?? []) {
    slots.push({ ref: e.id, sessionType: e.sessionType, distanceKm: e.distanceKm, isExtra: true });
  }
  return slots;
}

/**
 * Intensidad relativa entre carreras del mismo día. Señales en orden:
 * spread de FC (max - avg: los picos de los intervalos), velocidad (m/s),
 * FC promedio. Devuelve >0 si b es más intensa que a (orden descendente).
 */
function compareIntensityDesc(a: AssignableRun, b: AssignableRun): number {
  const spread = (r: AssignableRun) =>
    r.max_hr != null && r.avg_hr != null ? r.max_hr - r.avg_hr : null;
  const speed = (r: AssignableRun) =>
    r.distance_meters && r.duration_seconds
      ? Number(r.distance_meters) / Number(r.duration_seconds)
      : null;

  const sa = spread(a), sb = spread(b);
  if (sa != null && sb != null && sa !== sb) return sb - sa;
  const va = speed(a), vb = speed(b);
  if (va != null && vb != null && va !== vb) return vb - va;
  const ha = a.avg_hr, hb = b.avg_hr;
  if (ha != null && hb != null && ha !== hb) return hb - ha;
  return a.activity_id - b.activity_id; // empate: cronológico
}

/** Slot con distancia objetivo más cercana a la carrera; empate → primer slot. */
function closestSlot(r: AssignableRun, slots: SessionSlot[]): SessionSlot {
  let best = slots[0];
  let bestDiff = Math.abs(kmOf(r) - best.distanceKm);
  for (const s of slots.slice(1)) {
    const diff = Math.abs(kmOf(r) - s.distanceKm);
    if (diff < bestDiff) {
      best = s;
      bestDiff = diff;
    }
  }
  return best;
}

/**
 * Asignación de cada carrera del día a un slot: overrides manuales primero
 * (refs huérfanos se ignoran), el resto por heurística determinística.
 */
export function assignRuns(
  day: GeneratedDay,
  runs: AssignableRun[]
): Record<number, string> {
  const slots = daySessionSlots(day);
  const validRefs = new Set([...slots.map((s) => s.ref), NONE_REF]);
  const out: Record<number, string> = {};
  const pool: AssignableRun[] = [];

  const sorted = [...runs].sort((a, b) => a.activity_id - b.activity_id);
  for (const r of sorted) {
    const o = day.runOverrides?.[String(r.activity_id)];
    if (o && validRefs.has(o)) out[r.activity_id] = o;
    else pool.push(r);
  }

  if (pool.length === 0) return out;
  if (slots.length === 0) {
    for (const r of pool) out[r.activity_id] = NONE_REF;
    return out;
  }

  // Un slot con 0 km no es una sesión que espera carrera: es el hueco que
  // dejó una sesión que se movió a otro día. Tiene que EXISTIR (para eso es
  // esta tarea: que una carrera pueda caer ahí y no en "excluida"), pero no
  // debe COMPETIR con las sesiones que sí esperan trabajo — si compitiera,
  // le robaría por cercanía de distancia carreras que ya tienen a dónde ir
  // (un extra con km) o apagaría la clasificación de "solo calidad" (un
  // slot vacío cuenta como "fácil" y desactiva la rama HIIT-sin-fácil). Las
  // heurísticas de reparto usan solo los slots con distanceKm > 0; si NINGÚN
  // slot espera km (día vaciado sin extras) se usan todos — el caso base.
  const withKm = slots.filter((s) => s.distanceKm > 0);
  const matchSlots = withKm.length > 0 ? withKm : slots;

  const hiitSlots = matchSlots.filter((s) => s.sessionType === "hiit");
  const easySlots = matchSlots.filter((s) => s.sessionType !== "hiit");

  // Día de SOLO calidad (slots hiit sin ningún slot fácil): la(s) carrera(s) de
  // calidad cubren los slots hiit (una por slot, por intensidad); una carrera
  // fácil (un 2º entrenamiento suave) NO es HIIT → se reconoce como Z2 (bonus).
  if (hiitSlots.length > 0 && easySlots.length === 0) {
    const ranked = [...pool].sort(compareIntensityDesc);
    let h = 0;
    for (const r of ranked) {
      if (!isEasyRun(r) && h < hiitSlots.length) out[r.activity_id] = hiitSlots[h++].ref;
      else out[r.activity_id] = Z2_BONUS_REF;
    }
    return out;
  }

  if (matchSlots.length === 1) {
    for (const r of pool) out[r.activity_id] = matchSlots[0].ref;
    return out;
  }

  if (pool.length >= 2 && hiitSlots.length > 0 && easySlots.length > 0) {
    // La(s) carrera(s) más intensa(s) van a los cuadritos HIIT (una por slot);
    // el resto se reparte entre las sesiones fáciles por cercanía de distancia.
    const ranked = [...pool].sort(compareIntensityDesc);
    const hiitRuns = new Set(ranked.slice(0, hiitSlots.length));
    let h = 0;
    for (const r of ranked) {
      if (hiitRuns.has(r)) out[r.activity_id] = hiitSlots[h++].ref;
    }
    for (const r of pool) {
      if (!hiitRuns.has(r)) out[r.activity_id] = closestSlot(r, easySlots).ref;
    }
    return out;
  }

  for (const r of pool) out[r.activity_id] = closestSlot(r, matchSlots).ref;
  return out;
}

/**
 * Actual de cada cuadrito = suma de SUS carreras asignadas (las "none" no
 * cuentan). Sin carreras: todo null, salvo fallbackTotalKm (dato legacy sin
 * actividades en rango), que cae completo al primer slot.
 */
export function sessionActuals(
  day: GeneratedDay,
  runs: AssignableRun[],
  fallbackTotalKm?: number | null
): DayActuals {
  const slots = daySessionSlots(day);
  const extras = day.extraSessions ?? [];
  const assignments = assignRuns(day, runs);

  if (runs.length === 0) {
    if (fallbackTotalKm != null && slots.length > 0) {
      const first = slots[0].ref;
      const hasMain = slots.some((s) => s.ref === MAIN_REF);
      return {
        main: hasMain ? (first === MAIN_REF ? round1(fallbackTotalKm) : 0) : null,
        extras: Object.fromEntries(
          extras.map((e) => [e.id, e.id === first ? round1(fallbackTotalKm) : 0])
        ),
        bonusZ2: 0,
        assignments,
      };
    }
    return {
      main: null,
      extras: Object.fromEntries(extras.map((e) => [e.id, null])),
      bonusZ2: 0,
      assignments,
    };
  }

  const kmByRef: Record<string, number> = {};
  for (const r of runs) {
    const ref = assignments[r.activity_id] ?? NONE_REF;
    if (ref === NONE_REF) continue;
    kmByRef[ref] = (kmByRef[ref] || 0) + kmOf(r);
  }

  const hasMain = slots.some((s) => s.ref === MAIN_REF);
  return {
    main: hasMain ? round1(kmByRef[MAIN_REF] || 0) : null,
    extras: Object.fromEntries(extras.map((e) => [e.id, round1(kmByRef[e.id] || 0)])),
    bonusZ2: round1(kmByRef[Z2_BONUS_REF] || 0),
    assignments,
  };
}

/**
 * Agregado de las carreras ASIGNADAS del día (para training_plan_workouts):
 * suma km, ritmo ponderado, la más larga como principal. Null si ninguna.
 */
export function assignedAggregate(
  day: GeneratedDay,
  runs: AssignableRun[]
): RunAggregate | null {
  const assignments = assignRuns(day, runs);
  const assigned = runs.filter((r) => assignments[r.activity_id] !== NONE_REF);
  if (!assigned.length) return null;

  const totalMeters = assigned.reduce((s, r) => s + Number(r.distance_meters || 0), 0);
  const totalSeconds = assigned.reduce((s, r) => s + Number(r.duration_seconds || 0), 0);
  const primary = assigned.reduce((best, r) =>
    Number(r.distance_meters || 0) > Number(best.distance_meters || 0) ? r : best
  );

  return {
    matchedActivityId: primary.activity_id,
    actualDistanceKm: totalMeters / 1000,
    actualPace: totalMeters > 0 && totalSeconds > 0 ? (totalSeconds / totalMeters) * 1000 / 60 : null,
    activityIds: assigned.map((r) => r.activity_id),
  };
}

/**
 * Carreras del día agrupadas por sesión asignada (para pintarlas DENTRO del
 * cuadrito de su sesión). byRef tiene una entrada por slot (aunque quede
 * vacía); las excluidas ("none") van aparte. Grupos en orden cronológico.
 */
export function runsBySlot(
  day: GeneratedDay,
  runs: AssignableRun[]
): { byRef: Record<string, AssignableRun[]>; excluded: AssignableRun[]; bonusZ2: AssignableRun[] } {
  const assignments = assignRuns(day, runs);
  const byRef: Record<string, AssignableRun[]> = {};
  for (const s of daySessionSlots(day)) byRef[s.ref] = [];
  const excluded: AssignableRun[] = [];
  const bonusZ2: AssignableRun[] = [];
  for (const r of [...runs].sort((a, b) => a.activity_id - b.activity_id)) {
    const ref = assignments[r.activity_id] ?? NONE_REF;
    if (ref === Z2_BONUS_REF) bonusZ2.push(r);
    else if (ref === NONE_REF || !byRef[ref]) excluded.push(r);
    else byRef[ref].push(r);
  }
  return { byRef, excluded, bonusZ2 };
}

/**
 * Ciclo del tap de reasignación: siguiente ref en [...slots, "none"] con
 * wrap-around. Un ref desconocido cae al primer slot; sin slots → "none".
 */
export function nextRunRef(day: GeneratedDay, currentRef: string): string {
  const cycle = [...daySessionSlots(day).map((s) => s.ref), NONE_REF];
  if (cycle.length === 1) return NONE_REF;
  const i = cycle.indexOf(currentRef);
  return i === -1 ? cycle[0] : cycle[(i + 1) % cycle.length];
}

/**
 * Registra un override manual (chip de la UI / PATCH /day). Valida que el
 * ref exista en el día (o sea "none") y que activityId sea numérico.
 */
export function applyRunOverride(
  day: GeneratedDay,
  activityId: unknown,
  ref: unknown
): { ok: true } | { ok: false; error: string } {
  const id = Number(activityId);
  // TODO(i18n): los mensajes de error de este módulo llegan a la UI.
  if (!Number.isFinite(id)) return { ok: false, error: "activityId inválido" };
  const validRefs = new Set([...daySessionSlots(day).map((s) => s.ref), NONE_REF]);
  if (typeof ref !== "string" || !validRefs.has(ref)) {
    return { ok: false, error: `ref inválido: ${String(ref)}` };
  }
  day.runOverrides = { ...(day.runOverrides ?? {}), [String(id)]: ref };
  return { ok: true };
}

/** Poda overrides que apuntan a slots que ya no existen en el día. */
export function pruneRunOverrides(day: GeneratedDay): void {
  if (!day.runOverrides) return;
  const validRefs = new Set([...daySessionSlots(day).map((s) => s.ref), NONE_REF]);
  const pruned = Object.fromEntries(
    Object.entries(day.runOverrides).filter(([, ref]) => validRefs.has(ref))
  );
  if (Object.keys(pruned).length === 0) delete day.runOverrides;
  else day.runOverrides = pruned;
}
