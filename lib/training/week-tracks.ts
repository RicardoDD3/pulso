// week-tracks.ts — Helpers para la vista de semana con 3 pistas por día
// (Correr / Fuerza / Ejercicios) y la columna de totales semanales.
// La fuerza deja de ser un sessionType y pasa a ser un flag por día
// (GeneratedDay.strengthDay); normalizeStrength migra planes viejos.

import type {
  GeneratedPlan,
  GeneratedWeek,
  GeneratedDay,
  SessionType,
  ExtraSession,
} from "./plan-generator-types";
import type { RebalanceMatch } from "./rebalance";
import { sessionActuals } from "./run-assignment";
import type { RunsByDate } from "./carryover";

/* ------------------------------------------------------------------ */
/* Normalización de fuerza                                             */
/* ------------------------------------------------------------------ */

/**
 * Convierte días con sessionType "strength" a rest + strengthDay=true y
 * recalcula strengthSessions. Idempotente. Devuelve true si cambió algo.
 */
export function normalizeStrength(plan: GeneratedPlan): boolean {
  let changed = false;
  for (const week of plan.weeks) {
    for (const day of week.days) {
      if ((day.sessionType as string) === "strength") {
        day.sessionType = "rest";
        day.strengthDay = true;
        day.distanceKm = 0;
        changed = true;
      }
    }
    const count = week.days.filter((d) => d.strengthDay).length;
    if (week.strengthSessions !== count) {
      week.strengthSessions = count;
      changed = true;
    }
  }
  return changed;
}

/* ------------------------------------------------------------------ */
/* Totales agregados de la semana                                      */
/* ------------------------------------------------------------------ */

const LONG_TYPES: SessionType[] = ["long_run", "back_to_back"];

/** Km de extras `moved` del día que caen en alguno de los tipos dados. */
function movedKmOf(day: GeneratedDay, types: SessionType[]): number {
  return (day.extraSessions ?? [])
    .filter((e) => e.origin === "moved" && types.includes(e.sessionType))
    .reduce((s, e) => s + (e.distanceKm || 0), 0);
}

/**
 * Recalcula totalKm / z2Km / longRunPlusB2bKm / strengthSessions de la semana.
 *
 * Cuenta el distanceKm de cada día MÁS los extras con origin "moved" (sesiones
 * arrastradas a un día que ya tenía otro tipo): sus km salieron del día origen,
 * así que si no contaran, la meta semanal se caería sola. Los extras
 * carryover/manual/planner NO cuentan: son redistribución de trabajo ya
 * contado en el distanceKm de su día.
 *
 * Única fuente de esta aritmética: llamarla desde cualquier path que mute el
 * plan, en vez de recalcular a mano.
 */
export function recalcWeekAggregates(week: GeneratedWeek): void {
  let total = 0;
  let z2 = 0;
  let long = 0;

  for (const day of week.days) {
    const km = day.distanceKm || 0;
    total += km + movedKmOf(day, ["z2", "hiit", ...LONG_TYPES]);
    if (day.sessionType === "z2") z2 += km;
    z2 += movedKmOf(day, ["z2"]);
    if (LONG_TYPES.includes(day.sessionType)) long += km;
    long += movedKmOf(day, LONG_TYPES);
  }

  week.totalKm = round1(total);
  week.z2Km = round1(z2);
  week.longRunPlusB2bKm = round1(long);
  week.strengthSessions = week.days.filter((d) => d.strengthDay).length;
}

/**
 * Elimina los días de descanso del plan: cada día "rest" se convierte en Z2
 * redistribuyendo km dentro de la semana sin cambiar el total planeado. Los
 * km del ex-descanso (totalSemana/7 por día) salen de los días Z2 existentes,
 * proporcionalmente y con tope del 50% por donador (misma filosofía que
 * rebalance.ts); HIIT, long run y B2B no se tocan. Sin donadores, el día queda
 * en Z2 con 0 km. Correr después de normalizeStrength. Idempotente; devuelve
 * true si cambió algo. Los días con restLocked (descanso pedido explícitamente
 * por el usuario) no se tocan.
 */
export function removeRestDays(plan: GeneratedPlan): boolean {
  let changed = false;

  for (const week of plan.weeks) {
    const restDays = week.days.filter((d) => d.sessionType === "rest" && !d.restLocked);
    if (restDays.length === 0) continue;
    changed = true;

    const weekTotal = round1(week.days.reduce((s, d) => s + (d.distanceKm || 0), 0));
    const donors = week.days.filter((d) => d.sessionType === "z2" && (d.distanceKm || 0) > 0);
    const donorTotal = donors.reduce((s, d) => s + d.distanceKm, 0);

    for (const day of restDays) {
      day.sessionType = "z2";
      day.zone = "Z2";
      day.distanceKm = 0;
    }

    const need = (weekTotal / week.days.length) * restDays.length;
    const assign = Math.min(need, donorTotal * 0.5);

    if (assign > 0) {
      for (const day of restDays) {
        day.distanceKm = round1(assign / restDays.length);
      }
      for (const donor of donors) {
        donor.distanceKm = round1(donor.distanceKm - (donor.distanceKm / donorTotal) * assign);
      }
      // Corrige el drift de redondeo en el donador más grande para que el
      // total semanal no cambie.
      const drift = round1(weekTotal - week.days.reduce((s, d) => s + (d.distanceKm || 0), 0));
      if (drift !== 0) {
        const biggest = donors.reduce((a, b) => (b.distanceKm > a.distanceKm ? b : a), donors[0]);
        biggest.distanceKm = round1(biggest.distanceKm + drift);
      }
    }

    recalcWeekAggregates(week);
  }

  return changed;
}

/**
 * Días de fuerza por defecto: lunes, miércoles y viernes (dayOfWeek 0/2/4).
 * El usuario luego los mueve libremente. Muta el plan y recalcula
 * strengthSessions. La fuerza es un flag independiente del run del día.
 */
export const DEFAULT_STRENGTH_DOWS = [0, 2, 4];

export function applyDefaultStrengthDays(plan: GeneratedPlan): void {
  for (const week of plan.weeks) {
    for (const day of week.days) {
      day.strengthDay = DEFAULT_STRENGTH_DOWS.includes(day.dayOfWeek);
    }
    week.strengthSessions = week.days.filter((d) => d.strengthDay).length;
  }
}

/* ------------------------------------------------------------------ */
/* Mover una sección de un día a otro                                  */
/* ------------------------------------------------------------------ */

export type SwapSection = "run" | "strength";

/**
 * Cuadrito del día que puede FUNDIR una sesión del tipo dado: el principal, o
 * un extra con origin "moved". Nunca un carryover (se borra y recrea en cada
 * sync: los km se perderían) ni un manual/planner (no suman a la meta: los km
 * desaparecerían de ella).
 */
function findMergeSlot(
  day: GeneratedDay,
  type: SessionType
): { kind: "main" } | { kind: "extra"; index: number } | null {
  if (day.sessionType === type && (day.distanceKm || 0) > 0) return { kind: "main" };
  const extras = day.extraSessions ?? [];
  for (let i = 0; i < extras.length; i++) {
    if (extras[i].origin === "moved" && extras[i].sessionType === type) {
      return { kind: "extra", index: i };
    }
  }
  return null;
}

/** Id determinístico y sin choques para un extra movido. */
function movedExtraId(fromDate: string, to: GeneratedDay, type: SessionType): string {
  const used = new Set((to.extraSessions ?? []).map((e) => e.id));
  const base = `mv-${fromDate}-${to.date}-${type}`;
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

export type MoveKind = "merge" | "adopt" | "new_box";

/**
 * Qué haría colocar una sesión de tipo `type` en el día `to`: fundir (regla
 * 2), adoptar el día si su principal está vacío (regla 3), o crear un
 * cuadrito nuevo (regla 4). Puro, no muta nada. Es el núcleo compartido por
 * describeSectionMove (mover la caja principal) y describeExtraMove (mover un
 * chip) — ambos caminos deben decidir merge/adopt/new_box de la misma forma.
 */
function describePlacement(
  to: GeneratedDay,
  type: SessionType
): { kind: MoveKind; needsConfirm: boolean; targetKm: number } {
  const slot = findMergeSlot(to, type);
  if (slot) {
    const targetKm =
      slot.kind === "main" ? to.distanceKm : (to.extraSessions ?? [])[slot.index].distanceKm;
    return { kind: "merge", needsConfirm: true, targetKm };
  }
  const destEmpty = to.sessionType === "rest" || (to.distanceKm || 0) === 0;
  return { kind: destEmpty ? "adopt" : "new_box", needsConfirm: false, targetKm: 0 };
}

/**
 * Coloca una sesión de `type`/`km` en el día `to`, mutándolo, siguiendo las 3
 * reglas de describePlacement: funde en el cuadrito del mismo tipo (adjunta
 * los km al principal o a un extra "moved" existente, vía findMergeSlot),
 * adopta el día si su principal está vacío (toma zone/notes SOLO si `session`
 * los trae — un chip no tiene), o crea un cuadrito nuevo con `newExtra(id)`.
 *
 * También coloca la estrella de sesión clave (`session.isKeySession`) siempre
 * junto al TRABAJO, no al día que lo hospeda (decisión de producto
 * 2026-08-04, ver ExtraSession.isKeySession): en `merge`/`adopt` sobre el
 * cuadrito principal la estrella queda en el DÍA `to`; en `merge` sobre un
 * chip existente o en `new_box` queda en ESE chip. Si el destino ya traía
 * estrella (día o chip, según el caso) y la sesión entrante también, el
 * resultado la conserva (nunca se pierde). No toca el día origen: eso es
 * responsabilidad del llamador (quien decide cuándo el origen "entrega" la
 * estrella junto con la sesión).
 *
 * Compartida por moveSection (mover la caja principal, en este archivo) y
 * moveExtraBetweenDays (mover un chip, en carryover.ts) para que un viaje de
 * ida y vuelta por cualquiera de los dos caminos dé el mismo resultado — antes
 * de esto, moveExtraBetweenDays siempre apilaba un chip nuevo sin mirar si el
 * destino ya tenía dónde fundirse o adoptarlo (bug 2026-08-04).
 */
export function placeSession(
  to: GeneratedDay,
  session: {
    sessionType: SessionType;
    distanceKm: number;
    /** Día atribuido al chip "moved" resultante (fusión o cuadrito nuevo). */
    originDate: string;
    /** Solo trae valor al mover la caja PRINCIPAL de un día; un chip no tiene zona/notas propias. */
    zone?: string;
    notes?: string;
    /** Estrella que trae la sesión (del día o del chip que se está moviendo). */
    isKeySession?: boolean;
  },
  newExtra: (id: string) => ExtraSession
): void {
  const { sessionType: type, distanceKm: km, originDate } = session;
  const slot = findMergeSlot(to, type);

  if (slot) {
    if (slot.kind === "main") {
      to.distanceKm = round1(to.distanceKm + km);
      if (session.isKeySession) to.isKeySession = true;
    } else {
      const extras = [...(to.extraSessions ?? [])];
      const target = extras[slot.index];
      const merged = { ...target, distanceKm: round1(target.distanceKm + km) };
      // Si el chip ya existente venía de un día DISTINTO al que se está
      // fundiendo ahora, "movedFrom" mentiría al nombrar solo uno de los dos
      // orígenes ("Movida de lun 3" con km de lunes Y de viernes): se limpia
      // para que el chip caiga al texto genérico ("Sesión extra") en vez de
      // atribuir todos los km a un solo día.
      if (merged.movedFrom !== originDate) delete merged.movedFrom;
      if (session.isKeySession) merged.isKeySession = true;
      extras[slot.index] = merged;
      to.extraSessions = extras;
    }
  } else if (to.sessionType === "rest" || (to.distanceKm || 0) === 0) {
    to.sessionType = type;
    to.distanceKm = km;
    if (session.zone !== undefined) to.zone = session.zone;
    if (session.notes !== undefined) to.notes = session.notes;
    delete to.restLocked;
    if (session.isKeySession) to.isKeySession = true;
  } else {
    const extra = newExtra(movedExtraId(originDate, to, type));
    if (session.isKeySession) extra.isKeySession = true;
    to.extraSessions = [...(to.extraSessions ?? []), extra];
  }
}

/** Descripción de lo que haría un movimiento, para la UI (modal de confirmación). */
export interface SectionMoveInfo {
  section: SwapSection;
  kind: MoveKind;
  /** merge = fusión irreversible arrastrando: hay que confirmar. */
  needsConfirm: boolean;
  fromLabel: string;
  toLabel: string;
  /** El tipo que se mueve; nunca cambia. */
  sessionType: SessionType;
  fromKm: number;
  /** Km del cuadrito destino con el que se funde (0 si no hay fusión). */
  targetKm: number;
  resultKm: number;
}

/** "Lun 3" — mismo formato que el encabezado del día en DayColumn. */
function dayHeaderLabel(day: GeneratedDay): string {
  return `${day.dayLabel} ${parseInt(day.date.split("-")[2], 10)}`;
}

/**
 * Qué haría mover una sección de fromIndex a toIndex, sin mutar nada.
 * Devuelve null si el movimiento es no-op (índices inválidos, mismo día, u
 * origen sin nada que mover).
 */
export function describeSectionMove(
  week: GeneratedWeek,
  fromIndex: number,
  toIndex: number,
  section: SwapSection
): SectionMoveInfo | null {
  const from = week.days[fromIndex];
  const to = week.days[toIndex];
  if (!from || !to || fromIndex === toIndex) return null;

  const labels = { fromLabel: dayHeaderLabel(from), toLabel: dayHeaderLabel(to) };

  if (section === "strength") {
    if (!from.strengthDay) return null;
    const merge = !!to.strengthDay;
    return {
      section,
      kind: merge ? "merge" : "adopt",
      needsConfirm: merge,
      ...labels,
      sessionType: "strength",
      fromKm: 0,
      targetKm: 0,
      resultKm: 0,
    };
  }

  // "strength" se excluye también de la rama "run": un plan legacy sin
  // normalizar (normalizeStrength no corrió aún) puede traer un día con
  // sessionType "strength" y distanceKm > 0. Sin esta cláusula, esa km viajaría
  // como extra "moved" de tipo "strength", y groupOf("strength") en
  // computeRunTotals devuelve null — la km sumaría al total planeado sin sumar
  // a ningún grupo (z2/hiit/longRun), descuadrando la meta semanal en silencio.
  if (
    from.sessionType === "rest" ||
    from.sessionType === "strength" ||
    (from.distanceKm || 0) <= 0
  )
    return null;

  const placement = describePlacement(to, from.sessionType);
  return {
    section,
    kind: placement.kind,
    needsConfirm: placement.needsConfirm,
    ...labels,
    sessionType: from.sessionType,
    fromKm: from.distanceKm,
    targetKm: placement.targetKm,
    resultKm: round1(from.distanceKm + placement.targetKm),
  };
}

/**
 * Qué haría mover el cuadrito extra `extra` (que vive en `fromDay`) al día
 * `toDay`, sin mutar nada. Misma decisión que describeSectionMove (comparten
 * describePlacement) — salvo un pendiente (carryover), que jamás se funde:
 * moveExtraBetweenDays siempre lo convierte en un cuadrito manual nuevo, así
 * que aquí tampoco pide confirmación.
 */
export function describeExtraMove(
  fromDay: GeneratedDay,
  toDay: GeneratedDay,
  extra: ExtraSession
): SectionMoveInfo {
  const labels = { fromLabel: dayHeaderLabel(fromDay), toLabel: dayHeaderLabel(toDay) };

  if (extra.origin === "carryover") {
    return {
      section: "run",
      kind: "new_box",
      needsConfirm: false,
      ...labels,
      sessionType: extra.sessionType,
      fromKm: extra.distanceKm,
      targetKm: 0,
      resultKm: extra.distanceKm,
    };
  }

  const placement = describePlacement(toDay, extra.sessionType);
  return {
    section: "run",
    kind: placement.kind,
    needsConfirm: placement.needsConfirm,
    ...labels,
    sessionType: extra.sessionType,
    fromKm: extra.distanceKm,
    targetKm: placement.targetKm,
    resultKm: round1(extra.distanceKm + placement.targetKm),
  };
}

/**
 * Mueve una sección de un día a otro dentro de la semana (muta la semana).
 * A diferencia del viejo swap, el día origen NO recibe nada a cambio: queda
 * vacío y el destino acumula. Una sesión NUNCA cambia de tipo al moverse.
 *
 * Ver docs/superpowers/specs/2026-08-04-mover-sesiones-sin-swap-design.md
 */
export function moveSection(
  week: GeneratedWeek,
  fromIndex: number,
  toIndex: number,
  section: SwapSection
): void {
  if (!describeSectionMove(week, fromIndex, toIndex, section)) return;
  const from = week.days[fromIndex];
  const to = week.days[toIndex];

  if (section === "strength") {
    from.strengthDay = false;
    to.strengthDay = true;
    recalcWeekAggregates(week);
    return;
  }

  const km = from.distanceKm;
  const type = from.sessionType;

  placeSession(
    to,
    {
      sessionType: type,
      distanceKm: km,
      originDate: from.date,
      zone: from.zone,
      notes: from.notes,
      isKeySession: from.isKeySession,
    },
    (id) => ({ id, sessionType: type, distanceKm: km, origin: "moved", movedFrom: from.date })
  );

  // El origen entrega la estrella junto con la sesión; placeSession decide
  // DÓNDE aterriza en el destino (día o chip, según la colocación).
  from.distanceKm = 0;
  from.notes = "";
  from.isKeySession = false;
  recalcWeekAggregates(week);
}

/* ------------------------------------------------------------------ */
/* Totales de corrida                                                  */
/* ------------------------------------------------------------------ */

export interface RunGroupTotal {
  plannedKm: number;
  actualKm: number;
}

export interface RunTotals {
  z2: RunGroupTotal;
  hiit: RunGroupTotal;
  /** long_run + back_to_back */
  longRun: RunGroupTotal;
  total: RunGroupTotal;
}

const round1 = (x: number) => Math.round(x * 10) / 10;

function groupOf(sessionType: string): keyof Omit<RunTotals, "total"> | null {
  if (sessionType === "z2") return "z2";
  if (sessionType === "hiit") return "hiit";
  if (sessionType === "long_run" || sessionType === "back_to_back") return "longRun";
  return null;
}

/** Km planeados vs reales de la semana, agrupados por tipo de sesión. */
export function computeRunTotals(
  week: GeneratedWeek,
  matches: RebalanceMatch[],
  runsByDate: RunsByDate = {}
): RunTotals {
  const actualByDate = new Map<string, number>();
  for (const m of matches) {
    if (m.status === "completed" && m.actual_distance_km != null) {
      actualByDate.set(m.date, (actualByDate.get(m.date) || 0) + m.actual_distance_km);
    }
  }

  const empty = (): RunGroupTotal => ({ plannedKm: 0, actualKm: 0 });
  const totals: RunTotals = { z2: empty(), hiit: empty(), longRun: empty(), total: empty() };

  for (const day of week.days) {
    const extras = day.extraSessions ?? [];
    const mainGroup = groupOf(day.sessionType);
    if (!mainGroup && extras.length === 0) continue;

    // Actual por cuadrito según la asignación de carreras; si no hay
    // actividades en el rango (dato legacy), el total del día cae al primer
    // cuadrito vía fallback.
    const runs = runsByDate[day.date] ?? [];
    const fallback = actualByDate.has(day.date) ? actualByDate.get(day.date)! : null;
    const split = sessionActuals(day, runs, fallback);

    if (mainGroup) {
      totals[mainGroup].plannedKm += day.distanceKm || 0;
      totals[mainGroup].actualKm += split.main || 0;
      totals.total.plannedKm += day.distanceKm || 0;
      totals.total.actualKm += split.main || 0;
    }
    // Carreras detectadas Z2 (2º entreno suave en un día de calidad): cuentan
    // como Z2 real, no como el tipo del día. No suman a la meta planeada.
    if (split.bonusZ2 > 0) {
      totals.z2.actualKm += split.bonusZ2;
      totals.total.actualKm += split.bonusZ2;
    }
    // Las sesiones extra carryover/manual/planner son REDISTRIBUCIÓN de la
    // meta semanal fija — un pendiente de km que se movió de día, no trabajo
    // adicional. NO suman a la meta planeada (si lo hicieran, un día corto se
    // contaría dos veces: en su distanceKm base y otra vez como extra). Su
    // cobertura real (Garmin) sí cuenta como actual, así "recuperar" un día
    // corto avanza la meta sin inflarla.
    //
    // EXCEPCIÓN: origin "moved" SÍ suma a la meta. Sus km se restaron del
    // distanceKm del día origen al arrastrar la sesión, así que sin esto la
    // meta semanal se caería sola al mover un HIIT a un día Z2.
    for (const e of extras) {
      const group = groupOf(e.sessionType);
      if (e.origin === "moved") {
        const planned = e.distanceKm || 0;
        if (group) totals[group].plannedKm += planned;
        totals.total.plannedKm += planned;
      }
      const covered = split.extras[e.id] || 0;
      if (group) totals[group].actualKm += covered;
      totals.total.actualKm += covered;
    }
  }

  for (const key of ["z2", "hiit", "longRun", "total"] as const) {
    totals[key].plannedKm = round1(totals[key].plannedKm);
    totals[key].actualKm = round1(totals[key].actualKm);
  }
  return totals;
}

/* ------------------------------------------------------------------ */
/* Estado de fuerza                                                    */
/* ------------------------------------------------------------------ */

/** Subconjunto de training_workouts que necesita la vista. */
export interface WeekManualWorkout {
  date: string;
  workout_type: string;
  exercises: { name: string }[] | null;
}

/** Subconjunto de exercise_sets que necesita la vista. */
export interface WeekExerciseSet {
  date: string;
  exercise: string;
}

export interface StrengthDayStatus {
  planned: boolean;
  done: boolean;
  /** Ejercicios distintos registrados ese día (manual + pesas). */
  exerciseCount: number;
}

export interface StrengthStatus {
  days: Record<string, StrengthDayStatus>;
  plannedCount: number;
  doneCount: number;
}

/** Estado de fuerza por día: planeada (strengthDay) y/o hecha (registros). */
export function computeStrengthStatus(
  week: GeneratedWeek,
  manualWorkouts: WeekManualWorkout[],
  sets: WeekExerciseSet[]
): StrengthStatus {
  const manualByDate = new Map<string, WeekManualWorkout[]>();
  for (const w of manualWorkouts) {
    if (w.workout_type !== "strength") continue;
    const list = manualByDate.get(w.date) || [];
    list.push(w);
    manualByDate.set(w.date, list);
  }
  const setsByDate = new Map<string, Set<string>>();
  for (const s of sets) {
    const set = setsByDate.get(s.date) || new Set<string>();
    set.add(s.exercise);
    setsByDate.set(s.date, set);
  }

  const days: Record<string, StrengthDayStatus> = {};
  let plannedCount = 0;
  let doneCount = 0;

  for (const day of week.days) {
    const planned = !!day.strengthDay;
    const manual = manualByDate.get(day.date) || [];
    const weighted = setsByDate.get(day.date)?.size || 0;
    const manualExercises = manual.reduce((s, w) => s + (w.exercises?.length || 0), 0);
    const done = manual.length > 0 || weighted > 0;

    days[day.date] = {
      planned,
      done,
      exerciseCount: manualExercises + weighted,
    };
    if (planned) plannedCount++;
    if (done) doneCount++;
  }

  return { days, plannedCount, doneCount };
}

/* ------------------------------------------------------------------ */
/* Pasos diarios (Garmin)                                              */
/* ------------------------------------------------------------------ */

/** Meta semanal de pasos: 150k–200k. */
export const WEEKLY_STEPS_GOAL_MIN = 150000;
export const WEEKLY_STEPS_GOAL_MAX = 200000;

/** Subconjunto de daily_summary que necesita la vista (pasos por fecha). */
export interface WeekStepsEntry {
  date: string;
  steps: number | null;
}

export interface StepsTotals {
  /** Pasos por fecha, para los boxes de cada día. */
  byDate: Record<string, number>;
  /** Suma semanal de pasos. */
  total: number;
  goalMin: number;
  goalMax: number;
}

/**
 * Pasos por día y total semanal para la pista de pasos. Suma por fecha (por si
 * hubiera filas duplicadas) y trata null/undefined como 0.
 */
export function computeStepsTotals(
  entries: WeekStepsEntry[],
  goalMin: number = WEEKLY_STEPS_GOAL_MIN,
  goalMax: number = WEEKLY_STEPS_GOAL_MAX
): StepsTotals {
  const byDate: Record<string, number> = {};
  let total = 0;
  for (const e of entries) {
    const steps = e.steps || 0;
    byDate[e.date] = (byDate[e.date] || 0) + steps;
    total += steps;
  }
  return { byDate, total, goalMin, goalMax };
}

/** Formato compacto para pasos: 8432 → "8.4k", 24100 → "24.1k", <1000 sin sufijo. */
export function formatStepsCompact(steps: number): string {
  if (steps < 1000) return String(steps);
  const k = steps / 1000;
  return `${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}k`;
}

export interface StepsGoal {
  min: number;
  max: number;
}

function toPosInt(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseInt(v, 10) : NaN;
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.round(n);
}

/**
 * Normaliza una meta de pasos: min/max enteros positivos (cada valor inválido o
 * ausente cae a su fallback correspondiente) y garantiza max >= min. Pensada
 * para actualizaciones parciales: pasa la meta actual como fallback y solo los
 * campos provistos cambian.
 */
export function normalizeStepsGoal(
  min: unknown,
  max: unknown,
  fallback: StepsGoal = { min: WEEKLY_STEPS_GOAL_MIN, max: WEEKLY_STEPS_GOAL_MAX }
): StepsGoal {
  const m = toPosInt(min, fallback.min);
  const x = toPosInt(max, fallback.max);
  return { min: m, max: x < m ? m : x };
}

/* ------------------------------------------------------------------ */
/* Totales de ejercicios (bodyweight)                                  */
/* ------------------------------------------------------------------ */

/** Subconjunto de exercise_logs que necesita la vista. */
export interface WeekExerciseLog {
  date: string;
  exercise: string;
  reps: number;
}

export interface ExerciseDefLite {
  exercise_key: string;
  label: string;
  emoji: string;
  type: "bodyweight" | "weighted";
  weekly_goal: number | null;
  sort_order: number;
  is_active: boolean;
  /** Paso del stepper de reps (QuickLogModal); default 1. */
  increment?: number;
}

export interface ExerciseTotal {
  key: string;
  label: string;
  emoji: string;
  reps: number;
  goal: number | null;
  /** Reps por fecha, para los boxes de cada día. */
  byDate?: Record<string, number>;
}

/**
 * Reps semanales por ejercicio bodyweight activo (todos, con o sin reps/meta,
 * para que el box de totales siempre los muestre); ordena por sort_order.
 */
export function computeExerciseTotals(
  logs: WeekExerciseLog[],
  defs: ExerciseDefLite[]
): ExerciseTotal[] {
  const byKey = new Map<string, { reps: number; byDate: Record<string, number> }>();
  for (const log of logs) {
    const entry = byKey.get(log.exercise) || { reps: 0, byDate: {} };
    entry.reps += log.reps;
    entry.byDate[log.date] = (entry.byDate[log.date] || 0) + log.reps;
    byKey.set(log.exercise, entry);
  }

  return defs
    .filter((d) => d.type === "bodyweight" && d.is_active)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((d) => {
      const entry = byKey.get(d.exercise_key);
      return {
        key: d.exercise_key,
        label: d.label,
        emoji: d.emoji,
        reps: entry?.reps || 0,
        goal: d.weekly_goal ?? null,
        byDate: entry?.byDate || {},
      };
    });
}
