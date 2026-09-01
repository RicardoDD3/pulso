// plan-modifier.ts — Natural language plan modification utilities
// Detects modification requests, builds LLM prompts, validates responses,
// diffs plans, and rebuilds DB rows.

import type {
  GeneratedPlan,
  GeneratedDay,
} from "./plan-generator-types";
import { replaceDayExtras } from "./carryover";
import { recalcWeekAggregates } from "./week-tracks";
import { resolveCurrentWeek, formatWeekAnchor } from "./plan-week";

// ---------------------------------------------------------------------------
// 1. isModificationRequest
// ---------------------------------------------------------------------------

/** Remove diacritics so "día" matches "dia", "sesión" matches "sesion", etc. */
function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

const MODIFICATION_VERBS = [
  "mueve", "mover",
  "cambia", "cambiar",
  "agrega", "agregar",
  "anade", "anadir", // stripped: añade → anade, añadir → anadir
  "quita", "quitar",
  "elimina", "eliminar",
  "baja", "bajar",
  "sube", "subir",
  "ajusta", "ajustar",
  "modifica", "modificar",
  "reemplaza", "reemplazar",
  "sustituye", "sustituir",
  "acorta", "acortar",
  "alarga", "alargar",
  "skip", "salta", "saltar",
  "haz", "hacer",
  "convierte", "convertir",
  "pon", "poner",
  "mete", "meter",
  "intercambia", "intercambiar",
  "cancela", "cancelar",
  "borra", "borrar",
  "reduce", "reducir",
  "disminuye", "disminuir",
  "aumenta", "aumentar",
];

const TRAINING_NOUNS = [
  "plan",
  "semana",
  "entrenamiento",
  "workout",
  "long run",
  "tempo",
  "intervalo",
  "descanso",
  "rest",
  "z2",
  "easy",
  "hiit",
  "fuerza",
  "strength",
  "km",
  "kilometr", // matches kilómetro, kilómetros, kilometraje
  "distancia",
  "ritmo",
  "pace",
  "dia", // stripped: día → dia
  "lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo",
  "back to back", "b2b",
  "sesion", // stripped: sesión → sesion
  "corrida",
  "carrera",
];

/**
 * Detect whether a user message is requesting a modification to a training plan.
 * Requires BOTH a modification verb AND a training noun to return true.
 */
export function isModificationRequest(message: string): boolean {
  const normalized = stripAccents(message.toLowerCase());

  // Verbs are matched as whole words (every MODIFICATION_VERBS entry is a single
  // token), so short verbs no longer match inside unrelated words —
  // e.g. "pon" ⊄ "responder", "baja" ⊄ "trabajar".
  const words = new Set(normalized.split(/[^a-z0-9]+/).filter(Boolean));
  const hasVerb = MODIFICATION_VERBS.some((v) => words.has(v));
  // Nouns stay on substring matching on purpose: the list uses prefixes
  // ("kilometr") and multi-word phrases ("long run", "back to back").
  const hasNoun = TRAINING_NOUNS.some((n) => normalized.includes(n));

  return hasVerb && hasNoun;
}

/**
 * Detecta si la instrucción pide explícitamente días de descanso (p. ej.
 * "los domingos son días de descanso", "quiero descansar los domingos").
 * Se usa para marcar restLocked en los días parcheados a "rest": sin petición
 * explícita, la política del plan sigue siendo "no hay descansos" y
 * removeRestDays() los convierte a Z2.
 */
export function instructionRequestsRest(instruction: string): boolean {
  const normalized = stripAccents(instruction.toLowerCase());
  // "descans" cubre descanso/descansar/descansa; "rest" como palabra completa
  // para no matchear "restar"/"resta" (quitar km).
  return /\bdescans/.test(normalized) || /\brest\b/.test(normalized) || /\bdia(s)? libre(s)?\b/.test(normalized);
}

// dayOfWeek de GeneratedDay: 0=Lun … 6=Dom.
const WEEKDAY_NAMES: [RegExp, number][] = [
  [/\blunes\b/, 0],
  [/\bmartes\b/, 1],
  [/\bmiercoles\b/, 2],
  [/\bjueves\b/, 3],
  [/\bviernes\b/, 4],
  [/\bsabados?\b/, 5],
  [/\bdomingos?\b/, 6],
];

/**
 * Días de la semana (0=Lun…6=Dom) en los que la instrucción pide descanso
 * recurrente (p. ej. "los domingos son días de descanso" → [6]). Vacío si la
 * instrucción no pide descanso o no nombra ningún día.
 */
export function parseRestWeekdays(instruction: string): number[] {
  if (!instructionRequestsRest(instruction)) return [];
  const normalized = stripAccents(instruction.toLowerCase());
  return WEEKDAY_NAMES.filter(([re]) => re.test(normalized)).map(([, dow]) => dow);
}

/**
 * Garantía determinística del descanso recurrente: fuerza rest + restLocked en
 * los días `dows` de TODAS las semanas, redistribuyendo los km del día a los
 * días z2 de la misma semana (total semanal intacto). El LLM puede saltarse
 * semanas ("sesión clave"); esto cubre las que omitió. No toca semanas con
 * phase "race" ni el día de la carrera (plan.raceDate). Idempotente; devuelve
 * true si cambió algo.
 */
export function enforceWeekdayRest(
  plan: GeneratedPlan,
  dows: number[],
  fromWeek?: number
): boolean {
  if (dows.length === 0) return false;
  const round1 = (x: number) => Math.round(x * 10) / 10;
  let changed = false;

  for (const week of plan.weeks) {
    if (week.phase === "race") continue;
    // Un descanso recurrente aplica de la semana en curso hacia adelante:
    // reescribir semanas ya vividas falsearía el histórico del usuario.
    if (fromWeek !== undefined && week.weekNumber < fromWeek) continue;

    let weekChanged = false;
    for (const day of week.days) {
      if (!dows.includes(day.dayOfWeek)) continue;
      if (day.date === plan.raceDate) continue;

      const moved = day.distanceKm || 0;
      const wasRest = day.sessionType === "rest";
      if (wasRest && moved === 0 && day.restLocked) continue;

      day.sessionType = "rest";
      day.distanceKm = 0;
      day.zone = "";
      day.notes = "";
      day.isKeySession = false;
      day.restLocked = true;
      weekChanged = true;

      if (moved > 0) {
        const receivers = week.days.filter(
          (d) => d !== day && !dows.includes(d.dayOfWeek) && d.sessionType === "z2" && (d.distanceKm || 0) > 0
        );
        const receiverTotal = receivers.reduce((s, d) => s + d.distanceKm, 0);
        if (receiverTotal > 0) {
          for (const r of receivers) {
            r.distanceKm = round1(r.distanceKm + (r.distanceKm / receiverTotal) * moved);
          }
        }
      }
    }

    if (weekChanged) {
      changed = true;
      // Corrige drift de redondeo en el receptor más grande y recalcula totales.
      const targetTotal = week.totalKm;
      const z2Days = week.days.filter((d) => d.sessionType === "z2" && (d.distanceKm || 0) > 0);
      const sum = round1(week.days.reduce((s, d) => s + (d.distanceKm || 0), 0));
      const drift = round1(targetTotal - sum);
      if (drift !== 0 && z2Days.length > 0) {
        const biggest = z2Days.reduce((a, b) => (b.distanceKm > a.distanceKm ? b : a), z2Days[0]);
        biggest.distanceKm = round1(biggest.distanceKm + drift);
      }
      recalcWeekAggregates(week);
    }
  }

  return changed;
}

// ---------------------------------------------------------------------------
// 2. buildModifyPrompt
// ---------------------------------------------------------------------------

/**
 * Build a compact representation of the plan for LLM context.
 * Strips nutritionGuide, strengthProgram, and unnecessary fields to reduce tokens.
 *
 * Con `today` marca la semana en curso (`current`) y el día de hoy (`today`)
 * para que el LLM tenga el ancla inline, no solo en las reglas. `fz` expone la
 * fuerza del día (flag `strengthDay`) — sin ella el LLM estaba ciego a la
 * fuerza aunque la regla 7 le pida parchearla. Ambas llaves se omiten cuando
 * son falsas: en un plan de 32 semanas cada llave son ~220 tokens de ruido.
 */
function compactPlanForLLM(planJson: GeneratedPlan, today?: string): string {
  const current = today ? resolveCurrentWeek(planJson, today) : null;
  const compact = planJson.weeks.map((w) => ({
    weekNumber: w.weekNumber,
    phase: w.phase,
    weekStartDate: w.weekStartDate,
    totalKm: w.totalKm,
    ...(current && current.weekNumber === w.weekNumber ? { current: true } : {}),
    days: w.days.map((d, i) => ({
      i,
      day: d.dayLabel,
      date: d.date,
      type: d.sessionType,
      km: d.distanceKm,
      zone: d.zone || "",
      notes: d.notes || "",
      key: d.isKeySession || false,
      ...(d.strengthDay ? { fz: true } : {}),
      ...(d.restLocked ? { rest: true } : {}),
      ...(today && d.date === today ? { today: true } : {}),
      ...(d.extraSessions?.length
        ? {
            extra: d.extraSessions.map((e) => ({
              id: e.id,
              type: e.sessionType,
              km: e.distanceKm,
              origin: e.origin,
            })),
          }
        : {}),
    })),
  }));
  return JSON.stringify(compact);
}

/**
 * Build the system prompt and user message for asking an LLM to modify a plan.
 * Uses a patch-based approach: the LLM returns only the changes, not the full plan.
 */
export function buildModifyPrompt(
  planJson: GeneratedPlan,
  instruction: string,
  today?: string
): { systemPrompt: string; userMessage: string } {
  // Ancla temporal: sin ella el LLM no sabe qué día es hoy y aplica los
  // cambios sin semana explícita a la semana 1 (el usuario va en la 23).
  const anchor = today ? formatWeekAnchor(planJson, today) : "";
  const anchorBlock = anchor
    ? `
${anchor}

ALCANCE EN EL TIEMPO (regla 0, la más importante):
- Si la instrucción NO menciona una semana ni una fecha explícita, aplícala SOLO a la SEMANA EN CURSO.
- Un día suelto ("el miércoles", "mañana", "el fin de semana") es el de la SEMANA EN CURSO.
- Si la instrucción es recurrente ("los domingos", "siempre", "todas las semanas", "de aquí en adelante"), aplícala desde la SEMANA EN CURSO hacia adelante, hasta el final del plan. NUNCA toques semanas anteriores a la actual: ya se entrenaron y reescribirlas falsea el histórico.
- Solo edita una semana pasada si el usuario la nombra explícitamente ("la semana 12").
- En el plan compacto, la semana en curso viene marcada con "current": true y el día de hoy con "today": true.
`
    : "";

  const systemPrompt = `Eres un asistente experto en entrenamiento de resistencia (trail running, ultra, maratón).
Tu trabajo es determinar qué cambios hacer a un plan de entrenamiento según la instrucción del usuario.
${anchorBlock}
REGLAS:
1. Solo modifica lo que el usuario pide. No cambies nada más.
2. sessionType válidos: "z2", "hiit", "long_run", "back_to_back", "rest"
3. Un día de descanso: distanceKm=0, zone="", notes=""
4. Si mueves una sesión de un día a otro, incluye AMBOS cambios (el día original y el nuevo).
5. Si el usuario pide más/menos intensidad o volumen, ajusta los km y/o tipos de sesión relevantes.
6. Si el usuario pide descanso en un día de la semana de forma recurrente (p. ej. "los domingos son descanso"), aplica el cambio a ESE día en la semana en curso y en TODAS las siguientes — también cuando ese día tiene long run o back-to-back (redistribuye esos km en otros días de la misma semana). Nunca en semanas anteriores a la actual. La otra excepción es el día de la carrera misma.
7. La fuerza NO es un sessionType: es un flag por día. En el plan compacto, "fz": true significa que ese día YA tiene fuerza (si la llave no aparece, no tiene). Para agregar/quitar fuerza usa "strengthDay": true/false en el cambio, sin tocar la corrida de ese día (no incluyas sessionType/distanceKm si solo cambia la fuerza). Para MOVER la fuerza de un día a otro, manda ambos días: el origen con "strengthDay": false y el destino con "strengthDay": true.
8. Sesiones EXTRA (cuadritos adicionales de correr en un mismo día): un día puede traer "extra": [{id, type, km, origin}] además de su sesión principal. Para agregar/editar/quitar extras, incluye en el cambio "extraSessions" con el ARRAY COMPLETO resultante de ese día: [{ "id": "...", "sessionType": "z2|hiit|long_run|back_to_back", "distanceKm": N, "origin": "planner" }]. Conserva los extras existentes (con su id y origin originales) que el usuario no pidió quitar; para quitar uno, omítelo del array. Los extras nuevos usan origin "planner" y pueden ir sin id. Un extra con origin "carryover" es un pendiente automático de km que faltaron un día anterior; si el usuario pide quitarlo o perdonarlo, exclúyelo del array. Un extra con origin "moved" es una sesión que el usuario arrastró desde otro día (drag & drop en la vista de semana): CUENTA para la meta semanal (a diferencia de los otros orígenes), así que si no lo tocaste, consérvalo TAL CUAL en el array — con su "id", su "origin": "moved" y su "movedFrom" — para no borrarle esos km a la meta sin que el usuario lo haya pedido. NO uses "extraSessions" para cambiar la sesión principal del día.

FORMATO DE RESPUESTA — responde ÚNICAMENTE con un JSON array de cambios:
[
  { "week": <weekNumber>, "day": <dayIndex 0-6>, "sessionType": "...", "distanceKm": N, "zone": "...", "notes": "...", "isKeySession": false, "strengthDay": true, "extraSessions": [...] }
]

Cada objeto representa un día que cambia. Solo incluye los días que SE MODIFICAN.
"week" es el weekNumber (1-based). "day" es el índice del día en la semana (0=Lun, 6=Dom).
Responde SOLO con el JSON array. Sin explicaciones, sin markdown, sin bloques de código.`;

  const userMessage = `PLAN ACTUAL (compacto):
${compactPlanForLLM(planJson, today)}

INSTRUCCIÓN DEL USUARIO:
${instruction}`;

  return { systemPrompt, userMessage };
}

// ---------------------------------------------------------------------------
// 2b. applyPlanPatches
// ---------------------------------------------------------------------------

interface PlanPatch {
  week: number;
  day: number;
  sessionType?: string;
  distanceKm?: number;
  zone?: string;
  notes?: string;
  isKeySession?: boolean;
  /** La fuerza es un flag por día, independiente de la corrida. */
  strengthDay?: boolean;
  /** Array COMPLETO de sesiones extra del día (reemplaza el existente). */
  extraSessions?: unknown;
}

/**
 * Parse LLM output as a list of patches and apply them to the original plan.
 * Returns a new plan with patches applied and totals recalculated.
 * Con opts.lockRestDays, los días parcheados a "rest" se marcan restLocked
 * (descanso pedido por el usuario) para que removeRestDays() los respete.
 */
export function applyPlanPatches(
  raw: string,
  originalPlan: GeneratedPlan,
  opts?: { lockRestDays?: boolean }
): { plan: GeneratedPlan; error?: string } | { plan: null; error: string } {
  // Strip markdown code blocks
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?\s*```$/, "");
  }

  // Parse JSON
  let patches: PlanPatch[];
  try {
    const parsed = JSON.parse(cleaned);
    // Accept both array and { changes: [...] } format
    patches = Array.isArray(parsed) ? parsed : parsed.changes;
    if (!Array.isArray(patches)) {
      return { plan: null, error: "El LLM no devolvió un array de cambios." };
    }
  } catch {
    return { plan: null, error: "El LLM devolvió JSON inválido." };
  }

  if (patches.length === 0) {
    return { plan: null, error: "El LLM no propuso ningún cambio." };
  }

  // Deep clone the original plan
  const newPlan: GeneratedPlan = JSON.parse(JSON.stringify(originalPlan));

  // Apply patches
  for (const patch of patches) {
    const weekIdx = newPlan.weeks.findIndex((w) => w.weekNumber === patch.week);
    if (weekIdx < 0) {
      return { plan: null, error: `Semana ${patch.week} no existe en el plan.` };
    }
    const week = newPlan.weeks[weekIdx];
    if (patch.day < 0 || patch.day > 6 || !week.days[patch.day]) {
      return { plan: null, error: `Día ${patch.day} inválido en semana ${patch.week}.` };
    }

    const day = week.days[patch.day];

    if (patch.sessionType !== undefined) day.sessionType = patch.sessionType as GeneratedDay["sessionType"];
    if (patch.distanceKm !== undefined) day.distanceKm = patch.distanceKm;
    if (patch.zone !== undefined) day.zone = patch.zone;
    if (patch.notes !== undefined) day.notes = patch.notes;
    if (patch.isKeySession !== undefined) day.isKeySession = patch.isKeySession;
    if (patch.strengthDay !== undefined) day.strengthDay = !!patch.strengthDay;
    if (patch.extraSessions !== undefined) {
      const res = replaceDayExtras(day, patch.extraSessions);
      if (!res.ok) {
        return { plan: null, error: `Extras inválidos en semana ${patch.week} día ${patch.day}: ${res.error}` };
      }
    }

    // Enforce rest day rules
    if (day.sessionType === "rest") {
      day.distanceKm = 0;
      day.zone = "";
      day.notes = "";
      day.isKeySession = false;
      if (opts?.lockRestDays) day.restLocked = true;
    } else if (patch.sessionType !== undefined) {
      // El usuario reasignó el día: un lock viejo ya no aplica.
      delete day.restLocked;
    }
  }

  // Recalculate week totals
  let peakWeeklyKm = 0;
  for (const week of newPlan.weeks) {
    recalcWeekAggregates(week);
    if (week.totalKm > peakWeeklyKm) peakWeeklyKm = week.totalKm;
  }
  newPlan.peakWeeklyKm = peakWeeklyKm;

  return { plan: newPlan };
}

// ---------------------------------------------------------------------------
// 4. diffPlans
// ---------------------------------------------------------------------------

/**
 * Generate a human-readable Spanish summary of differences between two plans.
 */
export function diffPlans(oldPlan: GeneratedPlan, newPlan: GeneratedPlan): string {
  const changes: string[] = [];

  for (let w = 0; w < oldPlan.weeks.length && w < newPlan.weeks.length; w++) {
    const oldWeek = oldPlan.weeks[w];
    const newWeek = newPlan.weeks[w];
    const weekLabel = `Semana ${oldWeek.weekNumber}`;

    // Week-level totalKm change
    if (oldWeek.totalKm !== newWeek.totalKm) {
      changes.push(
        `${weekLabel}: totalKm ${oldWeek.totalKm} → ${newWeek.totalKm}`
      );
    }

    // Day-level changes
    for (let d = 0; d < oldWeek.days.length && d < newWeek.days.length; d++) {
      const oldDay = oldWeek.days[d];
      const newDay = newWeek.days[d];
      const dayLabel = `${weekLabel}, ${newDay.dayLabel || `día ${d + 1}`}`;

      if (oldDay.sessionType !== newDay.sessionType) {
        changes.push(
          `${dayLabel}: sesión ${oldDay.sessionType} → ${newDay.sessionType}`
        );
      }
      if (oldDay.distanceKm !== newDay.distanceKm) {
        changes.push(
          `${dayLabel}: ${oldDay.distanceKm}km → ${newDay.distanceKm}km`
        );
      }
      if (oldDay.zone !== newDay.zone) {
        changes.push(
          `${dayLabel}: zona ${oldDay.zone || "(vacía)"} → ${newDay.zone || "(vacía)"}`
        );
      }
    }
  }

  if (changes.length === 0) {
    return "No se detectaron cambios.";
  }

  return changes.join("\n");
}

// ---------------------------------------------------------------------------
// 5. rebuildPlanWorkouts
// ---------------------------------------------------------------------------

const SESSION_TYPE_TO_WORKOUT_TYPE: Record<string, string> = {
  z2: "easy_run",
  hiit: "intervals",
  long_run: "long_run",
  back_to_back: "long_run",
  strength: "strength",
};

/**
 * Delete old training_plan_workouts and insert new ones from a modified plan.
 * Preserves completion data for workouts where the same date+type existed
 * before and had status "completed".
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function rebuildPlanWorkouts(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  planId: number,
  newPlan: GeneratedPlan
): Promise<void> {
  // 1. Fetch existing workouts to preserve completion data
  const { data: existingWorkouts } = await supabase
    .from("training_plan_workouts")
    .select("*")
    .eq("plan_id", planId);

  // Build a lookup map: "date|workout_type" → workout row
  const completedMap = new Map<
    string,
    {
      status: string;
      matched_activity_id: number | null;
      matched_workout_id: number | null;
      actual_distance_km: number | null;
      actual_pace: number | null;
    }
  >();

  if (existingWorkouts) {
    for (const w of existingWorkouts) {
      if (w.status === "completed") {
        const key = `${w.date}|${w.workout_type}`;
        completedMap.set(key, {
          status: w.status,
          matched_activity_id: w.matched_activity_id,
          matched_workout_id: w.matched_workout_id,
          actual_distance_km: w.actual_distance_km,
          actual_pace: w.actual_pace,
        });
      }
    }
  }

  // 2. Delete all existing workouts for this plan
  const { error: deleteError } = await supabase
    .from("training_plan_workouts")
    .delete()
    .eq("plan_id", planId);

  if (deleteError) {
    throw new Error(`Failed to delete existing workouts: ${deleteError.message}`);
  }

  // 3. Build new workout rows from the modified plan
  const newRows: Record<string, unknown>[] = [];

  const pushRow = (
    week: { weekNumber: number },
    day: { date: string; dayOfWeek: number; zone: string; distanceKm: number },
    workoutType: string,
    targetKm: number | null,
    title: string
  ) => {
    const key = `${day.date}|${workoutType}`;
    const completed = completedMap.get(key);
    newRows.push({
      plan_id: planId,
      week_number: week.weekNumber,
      day_of_week: day.dayOfWeek,
      date: day.date,
      workout_type: workoutType,
      title,
      target_distance_km: targetKm,
      target_pace_range: null,
      target_hr_zone: null,
      status: completed ? completed.status : "planned",
      matched_activity_id: completed ? completed.matched_activity_id : null,
      matched_workout_id: completed ? completed.matched_workout_id : null,
      actual_distance_km: completed ? completed.actual_distance_km : null,
      actual_pace: completed ? completed.actual_pace : null,
    });
  };

  for (const week of newPlan.weeks) {
    for (const day of week.days) {
      // Sesión de corrida (o fuerza legacy como sessionType)
      if (day.sessionType !== "rest") {
        const workoutType =
          SESSION_TYPE_TO_WORKOUT_TYPE[day.sessionType] || "easy_run";
        pushRow(week, day, workoutType, day.distanceKm || null, day.zone);
      }
      // Día de fuerza como dimensión independiente (flag strengthDay)
      if (day.strengthDay && day.sessionType !== ("strength" as string)) {
        pushRow(week, day, "strength", null, "Fuerza");
      }
    }
  }

  // 4. Insert new rows
  if (newRows.length > 0) {
    const { error: insertError } = await supabase
      .from("training_plan_workouts")
      .insert(newRows);

    if (insertError) {
      throw new Error(`Failed to insert modified workouts: ${insertError.message}`);
    }
  }
}
