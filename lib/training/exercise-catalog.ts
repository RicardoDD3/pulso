// exercise-catalog.ts — Lógica pura para editar el catálogo de ejercicios
// desde el chat "Planes" (acción edit_exercises). Calcula qué filas de
// exercise_definitions crear/actualizar sin tocar la DB; el route del chat
// aplica las mutaciones. Nunca borra: ocultar = is_active=false (gotcha #11),
// así el historial de exercise_sets/exercise_logs se conserva.

export type ExerciseType = "bodyweight" | "weighted";

export type ExerciseOp =
  | { op: "add"; type: ExerciseType; label: string; emoji?: string }
  | { op: "deactivate"; exercise: string }
  | { op: "reactivate"; exercise: string }
  | { op: "set_goal"; exercise: string; weekly_goal: number | null }
  | { op: "replace_catalog"; type: ExerciseType; labels: string[] };

/** Subconjunto de exercise_definitions que necesita el cálculo. */
export interface CatalogDef {
  exercise_key: string;
  label: string;
  type: ExerciseType;
  is_active: boolean;
}

export interface CatalogCreate {
  exercise_key: string;
  label: string;
  emoji: string;
  color: string;
  type: ExerciseType;
  increment: number;
}

export interface CatalogUpdate {
  exercise_key: string;
  changes: { is_active?: boolean; weekly_goal?: number | null };
}

export interface CatalogMutations {
  creates: CatalogCreate[];
  updates: CatalogUpdate[];
  /** Líneas legibles para la respuesta del chat. */
  summary: string[];
}

/** Misma generación de clave que el POST de /api/training/exercise-definitions. */
export function slugifyExerciseKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeName(s: string): string {
  return stripAccents(s.toLowerCase().trim());
}

const CREATE_COLORS = ["amber", "red", "blue", "green", "orange", "teal", "purple"];
const DEFAULT_EMOJI: Record<ExerciseType, string> = { weighted: "🏋️", bodyweight: "💪" };
const DEFAULT_INCREMENT: Record<ExerciseType, number> = { weighted: 5, bodyweight: 1 };

/**
 * Un label "matchea" una definición existente si coincide con su label
 * (case/acentos-insensible) o si su slug coincide con la clave. Así "Squat"
 * conserva el `sentadilla_barra` existente (label "Squat") en vez de duplicarlo.
 */
function findMatch(defs: CatalogDef[], type: ExerciseType, label: string): CatalogDef | undefined {
  const norm = normalizeName(label);
  const slug = slugifyExerciseKey(label);
  return defs.find(
    (d) => d.type === type && (normalizeName(d.label) === norm || d.exercise_key === slug)
  );
}

/**
 * Calcula las mutaciones (creates + updates) para aplicar una lista de ops
 * sobre el catálogo actual. Determinístico e idempotente respecto al estado
 * que recibe: ops sobre claves inexistentes o sin efecto no generan mutación.
 */
export function computeCatalogMutations(defs: CatalogDef[], ops: ExerciseOp[]): CatalogMutations {
  // Copia de trabajo: las ops se aplican en orden y las siguientes ven el
  // estado ya mutado (p. ej. add después de replace_catalog).
  const working: CatalogDef[] = defs.map((d) => ({ ...d }));
  const usedKeys = new Set(working.map((d) => d.exercise_key));
  const creates: CatalogCreate[] = [];
  const updates: CatalogUpdate[] = [];
  const summary: string[] = [];

  const uniqueKey = (label: string): string => {
    const base = slugifyExerciseKey(label) || "ejercicio";
    let key = base;
    let suffix = 2;
    while (usedKeys.has(key)) key = `${base}_${suffix++}`;
    usedKeys.add(key);
    return key;
  };

  const pushCreate = (type: ExerciseType, label: string, emoji?: string) => {
    const create: CatalogCreate = {
      exercise_key: uniqueKey(label),
      label,
      emoji: emoji || DEFAULT_EMOJI[type],
      color: CREATE_COLORS[creates.length % CREATE_COLORS.length],
      type,
      increment: DEFAULT_INCREMENT[type],
    };
    creates.push(create);
    working.push({ exercise_key: create.exercise_key, label, type, is_active: true });
    // TODO(i18n): los textos de `summary` de este módulo se muestran en el chat.
    summary.push(`➕ ${label}`);
  };

  const setActive = (def: CatalogDef, active: boolean) => {
    if (def.is_active === active) return;
    def.is_active = active;
    updates.push({ exercise_key: def.exercise_key, changes: { is_active: active } });
    summary.push(active ? `♻️ ${def.label} (reactivado)` : `🚫 ${def.label} (oculto)`);
  };

  for (const op of ops) {
    switch (op.op) {
      case "add": {
        const existing = findMatch(working, op.type, op.label);
        if (existing) {
          setActive(existing, true);
        } else {
          pushCreate(op.type, op.label, op.emoji);
        }
        break;
      }
      case "deactivate": {
        const def = working.find((d) => d.exercise_key === op.exercise);
        if (def) setActive(def, false);
        break;
      }
      case "reactivate": {
        const def = working.find((d) => d.exercise_key === op.exercise);
        if (def) setActive(def, true);
        break;
      }
      case "set_goal": {
        const def = working.find((d) => d.exercise_key === op.exercise);
        if (def) {
          const goal = op.weekly_goal === null ? null : Math.round(op.weekly_goal);
          updates.push({ exercise_key: def.exercise_key, changes: { weekly_goal: goal } });
          summary.push(`🎯 ${def.label}: meta semanal ${goal === null ? "sin meta" : goal}`);
        }
        break;
      }
      case "replace_catalog": {
        // "Solo debe haber estos N": conserva/reactiva los que matchean,
        // desactiva el resto del mismo type, crea los que faltan.
        const matched = new Set<string>();
        for (const label of op.labels) {
          const existing = findMatch(working, op.type, label);
          if (existing) {
            matched.add(existing.exercise_key);
            setActive(existing, true);
          } else {
            pushCreate(op.type, label);
            matched.add(working[working.length - 1].exercise_key);
          }
        }
        for (const def of working) {
          if (def.type === op.type && def.is_active && !matched.has(def.exercise_key)) {
            setActive(def, false);
          }
        }
        break;
      }
    }
  }

  return { creates, updates, summary };
}
