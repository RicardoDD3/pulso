/**
 * Default exercise catalog seeded on a user's first GET
 * (ported verbatim from the original — biohacking-spec/02 §5.1: 8 defaults,
 * 4 bodyweight + 4 weighted).
 */
export type ExerciseType = "bodyweight" | "weighted";

export type DefaultExercise = {
  exerciseKey: string;
  label: string;
  emoji: string;
  color: string;
  type: ExerciseType;
  increment: number;
  sortOrder: number;
};

export const DEFAULT_EXERCISES: DefaultExercise[] = [
  { exerciseKey: "sentadillas", label: "Sentadillas", emoji: "🧎", color: "amber", type: "bodyweight", increment: 10, sortOrder: 1 },
  { exerciseKey: "lagartijas", label: "Push Ups", emoji: "💪", color: "red", type: "bodyweight", increment: 5, sortOrder: 2 },
  { exerciseKey: "barras", label: "Barras", emoji: "🪂", color: "blue", type: "bodyweight", increment: 1, sortOrder: 3 },
  { exerciseKey: "planks", label: "Planks", emoji: "🧘", color: "green", type: "bodyweight", increment: 1, sortOrder: 4 },
  { exerciseKey: "press_banca", label: "Bench", emoji: "🏋️", color: "orange", type: "weighted", increment: 5, sortOrder: 5 },
  { exerciseKey: "peso_muerto", label: "Deadlift", emoji: "🦵", color: "red", type: "weighted", increment: 10, sortOrder: 6 },
  { exerciseKey: "sentadilla_barra", label: "Squat", emoji: "🏗️", color: "amber", type: "weighted", increment: 10, sortOrder: 7 },
  { exerciseKey: "press_militar", label: "Press Militar", emoji: "🫡", color: "blue", type: "weighted", increment: 5, sortOrder: 8 },
];
