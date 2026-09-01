// carryover.ts — Motor determinístico de carryover de km faltantes.
// Si un día pasado quedó corto (o no se corrió), el faltante se REPARTE
// PROPORCIONAL entre las PRÓXIMAS sesiones del MISMO tipo de la MISMA semana
// (Z2 corto → los próximos Z2, HIIT corto → los próximos HIIT), pesando por el
// tamaño de cada sesión (la más grande absorbe más). Si no queda un día de ese
// tipo en la semana, el faltante se descarta: la meta semanal es fija y no se
// arrastra deuda a la semana siguiente. El encadenado (un día que recibe una
// porción y no la cubre re-reparte lo suyo hacia adelante) preserva la
// cobertura. Funciones puras; el sync recalcula desde cero en cada corrida, así
// que el resultado es idempotente y un re-sync con más km ajusta los carryovers.

import type {
  GeneratedPlan,
  GeneratedDay,
  GeneratedWeek,
  ExtraSession,
  SessionType,
} from "./plan-generator-types";
import { sessionActuals, type AssignableRun } from "./run-assignment";
import { placeSession, recalcWeekAggregates } from "./week-tracks";

/** Carreras Garmin por fecha ISO (input del sync para el carryover). */
export type RunsByDate = Record<string, AssignableRun[]>;

/** Faltantes menores a esto no generan carryover (mismo espíritu que rebalance). */
export const MIN_CARRYOVER_KM = 2;

const round1 = (x: number) => Math.round(x * 10) / 10;

/**
 * Reparte `total` km entre `weights` (>= 0) proporcional a cada peso, redondeado
 * a 0.1 km y garantizando que la suma sea exactamente `total` (el residuo de
 * redondeo va al de mayor peso). Sin pesos positivos o total <= 0 → ceros.
 */
export function proportionalSplit(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0 || total <= 0) return weights.map(() => 0);
  const out = weights.map((w) => round1((total * w) / sum));
  const residual = round1(total - out.reduce((a, b) => a + b, 0));
  if (residual !== 0) {
    let mi = 0;
    for (let i = 1; i < weights.length; i++) if (weights[i] > weights[mi]) mi = i;
    out[mi] = round1(out[mi] + residual);
  }
  return out;
}

/** Clave estable de un carryover descartado por el usuario en un día. */
export function carryoverKey(from: string, sessionType: string): string {
  return `${from}:${sessionType}`;
}

/** Km objetivo del día: sesión principal + todos los extras. */
export function dayTargetKm(day: GeneratedDay): number {
  const extras = (day.extraSessions ?? []).reduce((s, e) => s + (e.distanceKm || 0), 0);
  return round1((day.distanceKm || 0) + extras);
}

const EXTRA_SESSION_TYPES = new Set<SessionType>(["z2", "hiit", "long_run", "back_to_back"]);
const EXTRA_ORIGINS = new Set(["carryover", "manual", "planner", "moved"]);

/**
 * Reemplaza los extras de un día con validación (usado por PATCH /day y el
 * chat Planes). Si un carryover existente desaparece del nuevo array, se
 * registra su descarte en day.carryoverDismissed para que el sync no lo
 * reviva. Muta el día solo cuando todo el input es válido.
 */
export function replaceDayExtras(
  day: GeneratedDay,
  next: unknown
): { ok: true } | { ok: false; error: string } {
  // TODO(i18n): los mensajes de error de este módulo llegan a la UI.
  if (!Array.isArray(next)) return { ok: false, error: "extraSessions debe ser un array" };

  // Extras existentes por id, para heredar el origin cuando el input no trae
  // uno válido (ver más abajo).
  const existingById = new Map((day.extraSessions ?? []).map((e) => [e.id, e]));

  const cleaned: ExtraSession[] = [];
  for (let i = 0; i < next.length; i++) {
    const raw = next[i] as Partial<ExtraSession> | null;
    const sessionType = raw?.sessionType as SessionType;
    if (!raw || !EXTRA_SESSION_TYPES.has(sessionType)) {
      return { ok: false, error: `sessionType inválido en extra ${i}` };
    }
    const km = Number(raw.distanceKm);
    if (!Number.isFinite(km) || km <= 0) {
      return { ok: false, error: `distanceKm inválido en extra ${i}` };
    }
    const existing = typeof raw.id === "string" ? existingById.get(raw.id) : undefined;
    // Un origin ausente o inválido hereda el del extra existente con el mismo
    // id, en vez de degradar a "manual": el chat Planes reemite el array
    // COMPLETO de extras del día en cada modificación, y si el LLM omite
    // "origin" para uno que no pidió tocar (p. ej. un "moved", que el prompt
    // no explicaba), degradarlo a manual le borraría los km a la meta semanal
    // en silencio (moved es el único origin que suma ahí). Un origin EXPLÍCITO
    // y válido siempre manda, aunque difiera del existente.
    const origin: ExtraSession["origin"] = EXTRA_ORIGINS.has(raw.origin as string)
      ? (raw.origin as ExtraSession["origin"])
      : existing
        ? existing.origin
        : "manual";
    const carryoverFrom = origin === "carryover" ? raw.carryoverFrom ?? existing?.carryoverFrom : undefined;
    const movedFrom = origin === "moved" ? raw.movedFrom ?? existing?.movedFrom : undefined;
    // Misma herencia que carryoverFrom/movedFrom: si el input omite
    // isKeySession, se hereda del extra existente con ese id en vez de
    // perderse. Sin esto, cualquier edición del día (PATCH /day o el chat
    // Planes, que reemite el array COMPLETO de extras en cada modificación)
    // borraría en silencio la estrella de un chip que el usuario no tocó.
    const isKeySession = raw.isKeySession ?? existing?.isKeySession;
    cleaned.push({
      id: typeof raw.id === "string" && raw.id ? raw.id : `x-${day.date}-${i}`,
      sessionType,
      distanceKm: Math.round(km * 10) / 10,
      origin,
      ...(carryoverFrom ? { carryoverFrom } : {}),
      ...(movedFrom ? { movedFrom } : {}),
      ...(isKeySession ? { isKeySession: true } : {}),
    });
  }

  // Carryovers que el usuario quitó → descarte persistente.
  const keptIds = new Set(cleaned.map((e) => e.id));
  for (const e of day.extraSessions ?? []) {
    if (e.origin === "carryover" && !keptIds.has(e.id)) {
      const key = carryoverKey(e.carryoverFrom ?? day.date, e.sessionType);
      if (!day.carryoverDismissed?.includes(key)) {
        day.carryoverDismissed = [...(day.carryoverDismissed ?? []), key];
      }
    }
  }

  if (cleaned.length > 0) day.extraSessions = cleaned;
  else delete day.extraSessions;
  return { ok: true };
}

/**
 * Cambia el tipo de un cuadrito extra (chip de correr). Devuelve un array NUEVO
 * (no muta el input). Un extra manual/planner cambia de tipo en su lugar
 * (conserva id y origen). Un carryover ("Pendiente de X") se CONVIERTE en
 * `manual` (id nuevo, sin carryoverFrom) para que el recálculo determinístico
 * del sync no lo revierta al tipo del día origen: al guardar con
 * replaceDayExtras, el id viejo desaparece del array y su descarte queda
 * registrado (mismo mecanismo que arrastrar un pendiente). Elegir el mismo tipo
 * o un tipo inválido devuelve el array sin cambios.
 */
export function retypeExtraSessions(
  extras: ExtraSession[],
  extraId: string,
  newType: SessionType
): ExtraSession[] {
  if (!EXTRA_SESSION_TYPES.has(newType)) return extras;
  return extras.map((e) => {
    if (e.id !== extraId || e.sessionType === newType) return e;
    if (e.origin === "carryover") {
      // Un carryover nunca llega a tener estrella hoy, pero se preserva por si
      // eso cambia: esta rama reconstruye el objeto campo por campo (no hace
      // spread de `e`) y perderla en silencio sería la misma trampa que ya
      // tuvimos con isKeySession en replaceDayExtras.
      return {
        id: `rt-${e.id}`,
        sessionType: newType,
        distanceKm: e.distanceKm,
        origin: "manual",
        ...(e.isKeySession ? { isKeySession: true } : {}),
      };
    }
    return { ...e, sessionType: newType };
  });
}

/**
 * Mueve una sesión extra (cuadrito de correr) de un día a otro dentro del plan
 * — el usuario arrastra el chip. Muta el plan solo si todo es válido.
 *
 * Un pendiente (carryover) movido a mano SIEMPRE aterriza como un cuadrito
 * `manual` nuevo — nunca se funde con el principal ni con otro chip del
 * destino (fundirlo lo volvería indistinguible del trabajo ya planeado,
 * cuando el usuario lo está moviendo justo para tenerlo aparte). Se registra
 * su descarte en el día origen (`carryoverDismissed`) para que el recálculo
 * determinístico del sync (`applyCarryover`, que borra y recrea los carryover
 * desde cero) no lo revive ni lo duplique.
 *
 * Los extras manual/planner/moved siguen las MISMAS reglas de colocación que
 * mover la caja principal de un día (`placeSession`, en week-tracks.ts):
 * funden en un cuadrito del mismo tipo, adoptan el destino si está vacío, o
 * crean un cuadrito nuevo. Antes de esto, un chip siempre se apilaba sin
 * mirar el destino — arrastrar de vuelta un chip "moved" a un día que ya
 * había quedado vacío por el primer movimiento dejaba DOS cuadritos en vez de
 * devolver el día a su estado original (bug del viaje de ida y vuelta,
 * 2026-08-04).
 */
export function moveExtraBetweenDays(
  plan: GeneratedPlan,
  from: { weekIndex: number; dayIndex: number },
  to: { weekIndex: number; dayIndex: number },
  extraId: string
): { ok: true } | { ok: false; error: string } {
  const fromWeek = plan.weeks?.[from.weekIndex];
  const toWeek = plan.weeks?.[to.weekIndex];
  if (!fromWeek || !toWeek) return { ok: false, error: "weekIndex fuera de rango" };
  const fromDay = fromWeek.days?.[from.dayIndex];
  const toDay = toWeek.days?.[to.dayIndex];
  if (!fromDay || !toDay) return { ok: false, error: "dayIndex fuera de rango" };
  if (fromDay === toDay) return { ok: false, error: "origen y destino son el mismo día" };

  const extras = fromDay.extraSessions ?? [];
  const idx = extras.findIndex((e) => e.id === extraId);
  if (idx < 0) return { ok: false, error: "sesión extra no encontrada" };
  const extra = extras[idx];

  // Sacar del origen.
  const remaining = extras.filter((_, i) => i !== idx);
  if (remaining.length > 0) fromDay.extraSessions = remaining;
  else delete fromDay.extraSessions;

  if (extra.origin === "carryover") {
    const key = carryoverKey(extra.carryoverFrom ?? fromDay.date, extra.sessionType);
    if (!fromDay.carryoverDismissed?.includes(key)) {
      fromDay.carryoverDismissed = [...(fromDay.carryoverDismissed ?? []), key];
    }
    const newId = `mv-${fromDay.date}-${extra.id}-${toDay.date}`;
    toDay.extraSessions = [
      ...(toDay.extraSessions ?? []),
      { id: newId, sessionType: extra.sessionType, distanceKm: extra.distanceKm, origin: "manual" },
    ];
  } else {
    // Un chip "moved" conserva su origen (fecha del día que lo originó) a
    // través de varios saltos; manual/planner no tienen esa historia, así que
    // el origen para el nuevo cuadrito (si nace uno) es el día del que sale
    // ahora mismo. La estrella del chip (si trae una) viaja con él — placeSession
    // decide si aterriza en el día destino o en el chip resultante.
    const originDate = extra.origin === "moved" ? extra.movedFrom! : fromDay.date;
    placeSession(
      toDay,
      { sessionType: extra.sessionType, distanceKm: extra.distanceKm, originDate, isKeySession: extra.isKeySession },
      (id) =>
        extra.origin === "moved"
          ? { id, sessionType: extra.sessionType, distanceKm: extra.distanceKm, origin: "moved", movedFrom: originDate }
          : { id, sessionType: extra.sessionType, distanceKm: extra.distanceKm, origin: extra.origin }
    );
  }

  recalcWeekAggregates(fromWeek);
  if (toWeek !== fromWeek) recalcWeekAggregates(toWeek);
  return { ok: true };
}

interface FlatDay {
  day: GeneratedDay;
  week: GeneratedWeek;
}

interface Shortfall {
  sessionType: SessionType;
  km: number;
  /** Fecha en la que se originó el faltante (se preserva al encadenar). */
  from: string;
}

/** Suma una porción de pendiente al día destino, fusionando por (origen, tipo). */
function addCarryoverPortion(
  day: GeneratedDay,
  from: string,
  sessionType: SessionType,
  km: number
): void {
  const id = `co-${from}-${sessionType}-${day.date}`;
  const list = day.extraSessions ?? [];
  const existing = list.find((e) => e.id === id);
  if (existing) {
    existing.distanceKm = round1(existing.distanceKm + km);
  } else {
    day.extraSessions = [
      ...list,
      { id, sessionType, distanceKm: round1(km), origin: "carryover", carryoverFrom: from },
    ];
  }
}

/**
 * Recalcula los extras origin:"carryover" de todo el plan a partir de los
 * actuals. Muta el plan (convención de normalizeStrength/removeRestDays) y
 * devuelve true si algo cambió. Los extras manual/planner no se tocan; los
 * descartes (day.carryoverDismissed) no se reviven.
 */
export function applyCarryover(
  plan: GeneratedPlan,
  runsByDate: RunsByDate,
  todayISO: string
): boolean {
  const flat: FlatDay[] = [];
  for (const week of plan.weeks) {
    for (const day of week.days) flat.push({ day, week });
  }

  const before = flat.map(({ day }) => JSON.stringify(day.extraSessions ?? []));

  // Recalcular desde cero: fuera todos los carryovers previos.
  for (const { day } of flat) {
    if (day.extraSessions?.some((e) => e.origin === "carryover")) {
      day.extraSessions = day.extraSessions.filter((e) => e.origin !== "carryover");
    }
    if (day.extraSessions && day.extraSessions.length === 0) delete day.extraSessions;
  }

  // Descartes globales: un pendiente descartado por el usuario no revive,
  // aunque el encadenado lo hubiera movido a otro día.
  const dismissed = new Set<string>();
  for (const { day } of flat) {
    for (const k of day.carryoverDismissed ?? []) dismissed.add(k);
  }

  for (let i = 0; i < flat.length; i++) {
    const { day, week } = flat[i];
    if (day.date >= todayISO) break; // días de hoy en adelante aún no cuentan
    if (week.phase === "race") continue; // en semana de carrera no se "recupera"

    // Actual por sesión según la asignación de carreras (ya sin cascada):
    // cada cuadrito cubre solo con SUS carreras asignadas. Un carryover
    // conserva su fecha de origen original al volver a fluir.
    const extras = day.extraSessions ?? [];
    const runs = runsByDate[day.date] ?? [];
    const actuals = sessionActuals(day, runs);

    const shortfalls: Shortfall[] = [];
    // El faltante conserva su tipo y su fecha de origen; solo se fusionan
    // duplicados exactos (mismo tipo + origen). La sesión principal (y los
    // extras manual/planner) usan el umbral mínimo; un pendiente (carryover)
    // ya en curso fluye completo (umbral ínfimo) para no perder deuda al
    // repartirla proporcionalmente entre varios días.
    const addShort = (sessionType: SessionType, km: number, actual: number, from: string, gate: number) => {
      const short = round1(km - actual);
      if (short < gate) return;
      const existing = shortfalls.find((x) => x.sessionType === sessionType && x.from === from);
      if (existing) existing.km = round1(existing.km + short);
      else shortfalls.push({ sessionType, km: short, from });
    };

    if (day.sessionType !== "rest" && (day.distanceKm || 0) > 0) {
      addShort(day.sessionType, day.distanceKm, actuals.main ?? 0, day.date, MIN_CARRYOVER_KM);
    }
    for (const e of extras) {
      if ((e.distanceKm || 0) <= 0) continue;
      const from = e.origin === "carryover" ? (e.carryoverFrom ?? day.date) : day.date;
      const gate = e.origin === "carryover" ? 0.05 : MIN_CARRYOVER_KM;
      addShort(e.sessionType, e.distanceKm, actuals.extras[e.id] ?? 0, from, gate);
    }

    // El pendiente vive en UN solo lugar: un carryover que quedó en un día ya
    // pasado no se conserva como cuadrito — su parte no cubierta fluye.
    if (extras.some((e) => e.origin === "carryover")) {
      const kept = extras.filter((e) => e.origin !== "carryover");
      if (kept.length > 0) day.extraSessions = kept;
      else delete day.extraSessions;
    }

    if (shortfalls.length === 0) continue;

    const di = week.days.indexOf(day);
    for (const s of shortfalls) {
      if (dismissed.has(carryoverKey(s.from, s.sessionType))) continue;
      // Destinos: TODOS los días de la MISMA semana DESPUÉS de este con una
      // sesión principal del MISMO tipo (z2→z2, hiit→hiit, long→long). El
      // faltante se REPARTE entre ellos PROPORCIONAL a su tamaño (una sesión
      // más grande absorbe más). Si no queda ninguno, se descarta (no cruza de
      // semana): la meta semanal es fija, no se arrastra deuda a la siguiente.
      const targets = week.days.filter(
        (d, j) =>
          j > di &&
          d.sessionType === s.sessionType &&
          (d.distanceKm || 0) > 0 &&
          d.date !== plan.raceDate
      );
      if (targets.length === 0) continue;
      const portions = proportionalSplit(s.km, targets.map((t) => t.distanceKm));
      for (let k = 0; k < targets.length; k++) {
        if (portions[k] <= 0.05) continue;
        addCarryoverPortion(targets[k], s.from, s.sessionType, portions[k]);
      }
    }
  }

  let changed = false;
  for (let i = 0; i < flat.length; i++) {
    if (JSON.stringify(flat[i].day.extraSessions ?? []) !== before[i]) {
      changed = true;
      break;
    }
  }
  return changed;
}
