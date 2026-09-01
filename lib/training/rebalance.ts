// rebalance.ts — Motor determinístico de rebalanceo semanal.
// Si el atleta corre de menos (o de más) en un día, propone repartir la
// diferencia entre los días de corrida restantes de la semana, respetando
// límites de periodización. Funciones puras; la propuesta se calcula en el
// cliente y el servidor solo aplica parches explícitos.

import type { GeneratedPlan, GeneratedWeek } from "./plan-generator-types";

/** Subconjunto de training_plan_workouts que necesita el motor. */
export interface RebalanceMatch {
  date: string;
  status: string;
  actual_distance_km: number | null;
}

export interface RebalancePatch {
  weekIndex: number;
  dayIndex: number;
  dayLabel: string;
  oldKm: number;
  newKm: number;
}

export interface RebalanceProposal {
  /** Positivo = déficit (faltan km), negativo = superávit. */
  deltaKm: number;
  patches: RebalancePatch[];
  /** Km del déficit que pasaron a la semana siguiente. */
  overflowKm: number;
  /** Km que no cupieron en ningún lado y se descartan. */
  discardedKm: number;
  /** Resumen en español para el banner. */
  summary: string;
}

const RUN_TYPES = new Set(["z2", "long_run", "back_to_back"]);
const LR_TYPES = new Set(["long_run", "back_to_back"]);
/** Un día no baja de 50% de su km original. */
const MIN_FACTOR = 0.5;
/** No se propone nada por debajo de este delta. */
const MIN_DELTA_KM = 2;

const round1 = (x: number) => Math.round(x * 10) / 10;
const roundHalf = (x: number) => Math.round(x * 2) / 2;

function completedByDate(matches: RebalanceMatch[]): Map<string, RebalanceMatch> {
  const map = new Map<string, RebalanceMatch>();
  for (const m of matches) {
    if (m.status === "completed") map.set(m.date, m);
  }
  return map;
}

/**
 * Km de sesiones extra de un día. Por defecto suma TODOS los orígenes
 * (carryover/manual/planner/moved) — lo que necesita `projectedWeekKm` para
 * proyectar el trabajo restante de un día futuro con un chip "moved" que
 * todavía no se corre. `excludeMoved` es para `weekTargetKm` (ver abajo).
 */
function extrasKm(day: GeneratedWeek["days"][number], excludeMoved = false): number {
  return (day.extraSessions ?? [])
    .filter((e) => !excludeMoved || e.origin !== "moved")
    .reduce((s, e) => s + (e.distanceKm || 0), 0);
}

/**
 * Volumen objetivo de la semana. Los extras carryover/manual/planner suben el
 * target igual que suben la proyección: son trabajo adicional intencional, no
 * un superávit a recortar. Los "moved", en cambio, se EXCLUYEN aquí: son una
 * sesión que ya estaba en el volumen de la semana y solo cambió de día —
 * `recalcWeekAggregates` ya los suma dentro de `week.totalKm` (y por lo tanto
 * dentro de `week.targetKm` una vez congelado), así que sumarlos de nuevo acá
 * los cuenta dos veces: mover un HIIT de 10 km a un día Z2 subiría el target
 * 10 km sin que el volumen semanal real haya cambiado.
 */
export function weekTargetKm(week: GeneratedWeek): number {
  const extras = week.days.reduce((s, d) => s + extrasKm(d, true), 0);
  return round1((week.targetKm ?? week.totalKm) + extras);
}

/**
 * Km que la semana va a acumular si no se toca nada:
 * actuals en días completados, 0 en días pasados sin actividad,
 * y el planeado en días de hoy en adelante.
 */
function projectedWeekKm(
  week: GeneratedWeek,
  done: Map<string, RebalanceMatch>,
  todayISO: string
): number {
  let sum = 0;
  for (const day of week.days) {
    const m = done.get(day.date);
    if (m) sum += m.actual_distance_km ?? day.distanceKm + extrasKm(day);
    else if (day.date < todayISO) sum += 0;
    else sum += day.distanceKm + extrasKm(day);
  }
  return sum;
}

/** Déficit (+) o superávit (−) contra el volumen objetivo de la semana. */
export function computeWeekDelta(
  week: GeneratedWeek,
  matches: RebalanceMatch[],
  todayISO: string
): number {
  const done = completedByDate(matches);
  return round1(weekTargetKm(week) - projectedWeekKm(week, done, todayISO));
}

interface EligibleDay {
  dayIndex: number;
  dayLabel: string;
  km: number;
  isLongRun: boolean;
}

function eligibleDays(
  week: GeneratedWeek,
  done: Map<string, RebalanceMatch>,
  todayISO: string
): EligibleDay[] {
  return week.days
    .map((day, dayIndex) => ({ day, dayIndex }))
    .filter(
      ({ day }) =>
        day.date >= todayISO &&
        !done.has(day.date) &&
        RUN_TYPES.has(day.sessionType) &&
        day.distanceKm > 0
    )
    .map(({ day, dayIndex }) => ({
      dayIndex,
      dayLabel: day.dayLabel,
      km: day.distanceKm,
      isLongRun: LR_TYPES.has(day.sessionType),
    }));
}

/** Reparte un superávit reduciendo días proporcionalmente, piso 50%. */
function allocateSurplus(
  days: EligibleDay[],
  amount: number
): { cuts: number[]; leftover: number } {
  const cuts = days.map(() => 0);
  const totalOrig = days.reduce((s, d) => s + d.km, 0);
  if (totalOrig <= 0 || amount <= 0) return { cuts, leftover: amount };

  const ratio = Math.min(amount / totalOrig, MIN_FACTOR);
  for (let i = 0; i < days.length; i++) cuts[i] = days[i].km * ratio;
  const allocated = totalOrig * ratio;
  return { cuts, leftover: Math.max(0, amount - allocated) };
}

/** Redondea deltas por día a 0.5 km y ajusta el residuo en el mejor día. */
function roundPatches(
  days: EligibleDay[],
  deltas: number[],
  targetSum: number,
  sign: 1 | -1
): number[] {
  const rounded = deltas.map((d) => roundHalf(d));
  const residual = roundHalf(targetSum - rounded.reduce((s, d) => s + d, 0));
  if (residual !== 0 && days.length > 0) {
    // El residuo va al día z2 más largo (o al más largo si no hay z2) para
    // no romper la regla del 35% en el long run.
    let best = -1;
    for (let i = 0; i < days.length; i++) {
      if (days[i].isLongRun) continue;
      if (best < 0 || days[i].km > days[best].km) best = i;
    }
    if (best < 0) {
      best = days.reduce((b, d, i) => (d.km > days[b].km ? i : b), 0);
    }
    const adjusted = rounded[best] + residual;
    // Nunca dejar un día en negativo al restar
    if (sign === 1 || days[best].km - Math.abs(adjusted) >= 0) {
      rounded[best] = adjusted;
    }
  }
  return rounded;
}

function fmtKm(x: number): string {
  const r = round1(x);
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/** Clave estable para persistir un rebalanceo descartado. */
export function rebalanceDismissKey(weekIndex: number, deltaKm: number): string {
  return `w${weekIndex}:d${round1(deltaKm)}`;
}

/**
 * Calcula la propuesta de rebalanceo para una semana.
 * Devuelve null si el delta es menor al umbral o no hay días elegibles.
 */
export function proposeRebalance(
  plan: GeneratedPlan,
  weekIndex: number,
  matches: RebalanceMatch[],
  todayISO: string
): RebalanceProposal | null {
  const week = plan.weeks[weekIndex];
  if (!week) return null;

  const done = completedByDate(matches);
  const deltaKm = computeWeekDelta(week, matches, todayISO);
  if (Math.abs(deltaKm) < MIN_DELTA_KM) return null;

  // Déficit: ya no se propone reparto — el carryover automático (ver
  // lib/training/carryover.ts) manda el faltante al día siguiente.
  if (deltaKm > 0) return null;

  const days = eligibleDays(week, done, todayISO);
  if (days.length === 0) return null;

  const patches: RebalancePatch[] = [];
  const parts: string[] = [];

  // ----- Superávit: restar km -----
  const surplus = -deltaKm;
  const { cuts, leftover } = allocateSurplus(days, surplus);
  const rounded = roundPatches(days, cuts, surplus - leftover, -1);
  for (let i = 0; i < days.length; i++) {
    if (rounded[i] <= 0) continue;
    const newKm = round1(Math.max(0, days[i].km - rounded[i]));
    patches.push({
      weekIndex,
      dayIndex: days[i].dayIndex,
      dayLabel: days[i].dayLabel,
      oldKm: days[i].km,
      newKm,
    });
    parts.push(`−${fmtKm(rounded[i])} ${days[i].dayLabel}`);
  }
  const discardedKm = round1(surplus - patches.reduce((s, p) => s + (p.oldKm - p.newKm), 0));

  if (patches.length === 0) return null;

  const summary = `Te pasaste ${fmtKm(surplus)} km → ${parts.join(" · ")}`;

  return { deltaKm, patches, overflowKm: 0, discardedKm, summary };
}
