/**
 * Clasificador de intención del chat "Planes" (editor de planes).
 *
 * `buildIntentPrompt` arma el prompt para que un LLM devuelva SOLO JSON con la
 * acción a ejecutar. `parseIntent` valida ese JSON y cae a `answer` ante
 * cualquier ambigüedad o error (nunca ejecuta una acción mal formada).
 */

import type { ExerciseOp, ExerciseType } from "./exercise-catalog";

export interface WorkoutInput {
  title: string;
  workout_type: string; // "strength" | "mobility" | "cross_training"
  date?: string; // YYYY-MM-DD; default hoy CDMX (lo resuelve el route)
  duration_minutes?: number;
  notes?: string;
}

export type ExerciseInput =
  | { kind: "weighted"; exercise: string; weight_kg: number; reps: number; date?: string }
  | { kind: "bodyweight"; exercise: string; reps: number; date?: string };

export type PlannerAction =
  | { action: "answer" }
  | { action: "modify_plan"; instruction: string }
  | { action: "rename_plan"; name: string }
  | { action: "log_workout"; workout: WorkoutInput }
  | { action: "log_exercise"; exercise: ExerciseInput }
  | { action: "edit_exercises"; ops: ExerciseOp[] }
  | { action: "set_steps_goal"; min: number | null; max: number | null }
  | { action: "undo" };

const ANSWER: PlannerAction = { action: "answer" };

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

const EXERCISE_TYPES: ExerciseType[] = ["bodyweight", "weighted"];

/** Valida una op de edit_exercises; null si está mal formada. */
function parseExerciseOp(raw: unknown): ExerciseOp | null {
  const o = raw as Record<string, unknown> | null;
  if (!o || typeof o.op !== "string") return null;

  switch (o.op) {
    case "add":
      if (
        EXERCISE_TYPES.includes(o.type as ExerciseType) &&
        typeof o.label === "string" &&
        o.label.trim()
      ) {
        return {
          op: "add",
          type: o.type as ExerciseType,
          label: o.label.trim(),
          ...(typeof o.emoji === "string" && o.emoji ? { emoji: o.emoji } : {}),
        };
      }
      return null;
    case "deactivate":
    case "reactivate":
      if (typeof o.exercise === "string" && o.exercise.trim()) {
        return { op: o.op, exercise: o.exercise.trim() };
      }
      return null;
    case "set_goal": {
      const goal = o.weekly_goal;
      const validGoal = goal === null || (typeof goal === "number" && Number.isFinite(goal) && goal >= 0);
      if (typeof o.exercise === "string" && o.exercise.trim() && validGoal) {
        return { op: "set_goal", exercise: o.exercise.trim(), weekly_goal: goal as number | null };
      }
      return null;
    }
    case "replace_catalog": {
      const labels = Array.isArray(o.labels)
        ? o.labels.filter((l): l is string => typeof l === "string" && !!l.trim()).map((l) => l.trim())
        : [];
      if (EXERCISE_TYPES.includes(o.type as ExerciseType) && labels.length > 0) {
        return { op: "replace_catalog", type: o.type as ExerciseType, labels };
      }
      return null;
    }
    default:
      return null;
  }
}

/** Valida un objeto acción; cae a ANSWER ante cualquier malformación. */
function validateAction(obj: Record<string, unknown>): PlannerAction {
  if (typeof obj.action !== "string") return ANSWER;

  switch (obj.action) {
    case "answer":
      return ANSWER;
    case "undo":
      return { action: "undo" };
    case "modify_plan":
      return typeof obj.instruction === "string" && obj.instruction.trim()
        ? { action: "modify_plan", instruction: obj.instruction.trim() }
        : ANSWER;
    case "rename_plan":
      return typeof obj.name === "string" && obj.name.trim()
        ? { action: "rename_plan", name: obj.name.trim() }
        : ANSWER;
    case "log_workout": {
      const w = obj.workout as Record<string, unknown> | undefined;
      if (w && typeof w.title === "string" && w.title.trim() && typeof w.workout_type === "string") {
        return {
          action: "log_workout",
          workout: {
            title: w.title.trim(),
            workout_type: w.workout_type,
            date: typeof w.date === "string" ? w.date : undefined,
            duration_minutes: typeof w.duration_minutes === "number" ? w.duration_minutes : undefined,
            notes: typeof w.notes === "string" ? w.notes : undefined,
          },
        };
      }
      return ANSWER;
    }
    case "edit_exercises": {
      const ops = (Array.isArray(obj.ops) ? obj.ops : [])
        .map(parseExerciseOp)
        .filter((op): op is ExerciseOp => op !== null);
      return ops.length > 0 ? { action: "edit_exercises", ops } : ANSWER;
    }
    case "set_steps_goal": {
      // min/max opcionales (actualización parcial); al menos uno positivo válido.
      const isPos = (v: unknown): v is number =>
        typeof v === "number" && Number.isFinite(v) && v > 0;
      const isAbsent = (v: unknown) => v === undefined || v === null;
      const validMin = isAbsent(obj.min) || isPos(obj.min);
      const validMax = isAbsent(obj.max) || isPos(obj.max);
      if ((isPos(obj.min) || isPos(obj.max)) && validMin && validMax) {
        return {
          action: "set_steps_goal",
          min: isPos(obj.min) ? obj.min : null,
          max: isPos(obj.max) ? obj.max : null,
        };
      }
      return ANSWER;
    }
    case "log_exercise": {
      const e = obj.exercise as Record<string, unknown> | undefined;
      if (!e || typeof e.exercise !== "string" || typeof e.reps !== "number") return ANSWER;
      if (e.kind === "weighted" && typeof e.weight_kg === "number") {
        return {
          action: "log_exercise",
          exercise: {
            kind: "weighted",
            exercise: e.exercise,
            weight_kg: e.weight_kg,
            reps: e.reps,
            date: typeof e.date === "string" ? e.date : undefined,
          },
        };
      }
      if (e.kind === "bodyweight") {
        return {
          action: "log_exercise",
          exercise: {
            kind: "bodyweight",
            exercise: e.exercise,
            reps: e.reps,
            date: typeof e.date === "string" ? e.date : undefined,
          },
        };
      }
      return ANSWER;
    }
    default:
      return ANSWER;
  }
}

export function parseIntent(text: string): PlannerAction {
  const obj = extractJson(text) as Record<string, unknown> | null;
  if (!obj) return ANSWER;
  return validateAction(obj);
}

/**
 * Versión multi-acción: acepta {"actions":[...]} para mensajes compuestos
 * ("crea un ejercicio Y pon los domingos de descanso") o un objeto suelto.
 * Filtra las acciones inválidas/answer; si no queda ninguna, [answer].
 */
export function parseIntents(text: string): PlannerAction[] {
  const obj = extractJson(text) as Record<string, unknown> | null;
  if (!obj) return [ANSWER];

  if (Array.isArray(obj.actions)) {
    const actions = obj.actions
      .map((a) =>
        a && typeof a === "object" ? validateAction(a as Record<string, unknown>) : ANSWER
      )
      .filter((a) => a.action !== "answer");
    return actions.length > 0 ? actions : [ANSWER];
  }

  return [validateAction(obj)];
}

export function buildIntentPrompt(
  message: string,
  planSummary: string,
  history: { role: string; content: string }[],
  catalog?: string,
  weekAnchor?: string
): { systemPrompt: string; userMessage: string } {
  const recent = history.slice(-6).map((m) => `${m.role}: ${m.content}`).join("\n");
  // Sin el ancla, una fecha relativa ("ayer hice 3 series") caía al default de
  // hoy y el registro quedaba en el día equivocado.
  const anchorBlock = weekAnchor
    ? `\n${weekAnchor}\nResuelve con esa fecha cualquier referencia relativa ("hoy", "ayer", "el lunes pasado") y escríbela como "date":"YYYY-MM-DD". Si el usuario no dice cuándo, omite "date" (el sistema usa hoy).\n`
    : "";
  const systemPrompt = `Eres un router de intención para un asistente editor de planes de entrenamiento. Analiza el mensaje del usuario y responde ÚNICAMENTE con un objeto JSON (sin texto extra) con una de estas formas:
{"action":"answer"}  // preguntas, dudas, análisis — no ejecuta ninguna acción
{"action":"modify_plan","instruction":"<instrucción textual del cambio al plan>"}
{"action":"rename_plan","name":"<nuevo nombre del plan>"}
{"action":"log_workout","workout":{"title":"...","workout_type":"strength|mobility|cross_training","date":"YYYY-MM-DD?","duration_minutes":N?,"notes":"?"}}
{"action":"log_exercise","exercise":{"kind":"weighted","exercise":"<clave>","weight_kg":N,"reps":N,"date":"YYYY-MM-DD?"}}
{"action":"log_exercise","exercise":{"kind":"bodyweight","exercise":"<clave>","reps":N,"date":"YYYY-MM-DD?"}}
{"action":"edit_exercises","ops":[
  {"op":"add","type":"bodyweight|weighted","label":"<nombre>","emoji":"?"},
  {"op":"deactivate","exercise":"<clave>"},
  {"op":"reactivate","exercise":"<clave>"},
  {"op":"set_goal","exercise":"<clave>","weekly_goal":N|null},
  {"op":"replace_catalog","type":"bodyweight|weighted","labels":["<nombre>",...]}
]}
{"action":"set_steps_goal","min":N|null,"max":N|null}  // meta SEMANAL de pasos (Garmin); min/max en pasos, ambos opcionales
{"action":"undo"}  // deshacer / revertir el último cambio al plan

Si el mensaje pide varias cosas a la vez (p. ej. "crea un ejercicio Y pon los domingos de descanso"), responde un objeto con TODAS las acciones en orden:
{"actions":[{...},{...}]}

Reglas:
- Si el usuario solo pregunta o pide análisis, usa "answer".
- Un mensaje puede requerir varias acciones ("actions"). No descartes ninguna petición del usuario.
- Usa "modify_plan" para cambios a la ESTRUCTURA del plan (alargar/acortar semanas, cambiar km, sesiones, zonas, poner días de descanso — p. ej. "los domingos son descanso" —, mover/agregar/quitar días de fuerza, agregar carreras, etc.). También cubre las SESIONES EXTRA de correr (cuadritos adicionales en un día): "agrégame mañana una sesión extra de 5 km de HIIT", "quita el pendiente del miércoles", "perdóname los km que debo" → modify_plan.
- Usa "rename_plan" SOLO para cambiar el NOMBRE del plan (p.ej. "cámbiale el nombre a X", "renombra el plan a X").
- Usa "log_workout" cuando reporta un entrenamiento hecho (fuerza, movilidad, cross).
- Usa "log_exercise" cuando reporta series con peso o reps de peso corporal. Usa la clave exacta del catálogo.
- Usa "edit_exercises" para cambios al CATÁLOGO de ejercicios: crear ejercicios nuevos ("add"), ocultar ("deactivate"), recuperar ("reactivate"), metas semanales ("set_goal"), o dejar SOLO una lista exacta ("replace_catalog" con type y labels — p. ej. "solo debe haber estos 5 ejercicios en fuerza" → type "weighted" y esos 5 labels). "fuerza"/"pesas" = weighted; reps de cuerpo = bodyweight.
- Usa "set_steps_goal" cuando pida cambiar su META DE PASOS semanal (Garmin). Convierte "180 mil" a 180000. Si solo menciona un valor (p. ej. "sube la meta de pasos a 180 mil"), pon ese como "min" y deja "max" en null; si da un rango ("de 180 a 220 mil"), min y max.
- Usa "undo" si pide deshacer/revertir el último cambio al plan.
- Ante la duda, usa "answer".
${anchorBlock}
Contexto del plan activo:
${planSummary}

Catálogo de ejercicios del usuario (clave — label):
${catalog || "(desconocido)"}

Conversación reciente:
${recent || "(vacía)"}`;
  return { systemPrompt, userMessage: message };
}
