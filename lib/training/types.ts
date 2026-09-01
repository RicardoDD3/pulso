export interface IntervalDetail {
  reps: number;
  distance_m: number;
  pace: string;
  rest: string;
}

export interface StrengthExercise {
  name: string;
  sets: number;
  reps: number;
}

export interface PlannedWorkout {
  day_of_week: number;
  date: string;
  workout_type: string;
  title: string;
  description: string;
  target_distance_km: number | null;
  target_duration_min: number | null;
  target_pace_range: string | null;
  target_hr_zone: string | null;
  intervals_detail: IntervalDetail[] | null;
  strength_exercises: StrengthExercise[] | null;
}

export interface PlanWeek {
  week_number: number;
  phase: string;
  target_km: number;
  notes: string;
  workouts: PlannedWorkout[];
}

export interface PlanPhase {
  name: string;
  weeks: [number, number];
  focus: string;
}

export interface HrZone {
  zone: string;
  bpm_range: [number, number];
}

export interface NutritionFlag {
  biomarker: string;
  status: string;
  recommendation: string;
}

export interface PaceTargets {
  easy: string;
  tempo: string;
  interval: string;
  long_run: string;
  race: string;
}

export interface PlanData {
  summary: {
    total_weeks: number;
    peak_weekly_km: number;
    phases: PlanPhase[];
  };
  pace_targets: PaceTargets;
  hr_zones: HrZone[];
  nutrition_flags: NutritionFlag[];
  weeks: PlanWeek[];
}

export interface TrainingPlan {
  id: number;
  clerk_id: string;
  name: string;
  goal_type: string;
  goal_date: string;
  goal_time: string | null;
  goal_distance_km: number | null;
  available_days: number;
  terrain: string;
  plan_json: PlanData;
  llm_used: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface ExerciseSet {
  reps: number;
  weight: number | null;
  rpe: number | null;
}

export interface Exercise {
  name: string;
  sets: ExerciseSet[];
}

export interface TrainingWorkout {
  id: number;
  clerk_id: string;
  plan_id: number | null;
  date: string;
  workout_type: string;
  title: string;
  exercises: Exercise[];
  duration_minutes: number | null;
  notes: string | null;
  created_at: string;
}

export interface TrainingPlanWorkout {
  id: number;
  plan_id: number;
  week_number: number;
  day_of_week: number;
  date: string;
  workout_type: string;
  title: string;
  target_distance_km: number | null;
  target_pace_range: string | null;
  target_hr_zone: string | null;
  matched_activity_id: number | null;
  matched_workout_id: number | null;
  status: string;
  actual_distance_km: number | null;
  actual_pace: number | null;
  created_at: string;
}

export const GOAL_TYPES = [
  { value: "marathon", label: "Maraton" },
  { value: "ultra", label: "Ultra" },
  { value: "half_marathon", label: "Medio Maraton" },
  { value: "10k", label: "10K" },
  { value: "general", label: "General" },
] as const;

export const TERRAIN_TYPES = [
  { value: "road", label: "Asfalto" },
  { value: "trail", label: "Trail" },
  { value: "mixed", label: "Mixto" },
] as const;

export const WORKOUT_TYPES = [
  { value: "strength", label: "Fuerza" },
  { value: "mobility", label: "Movilidad" },
  { value: "cross_training", label: "Cross Training" },
] as const;

export interface ExerciseDefinitionRow {
  id: number;
  clerk_id: string;
  exercise_key: string;
  label: string;
  emoji: string;
  color: string;
  type: "bodyweight" | "weighted";
  increment: number;
  sort_order: number;
  is_active: boolean;
  /** Meta semanal de reps (columna agregada por SQL manual; puede faltar). */
  weekly_goal?: number | null;
}

export interface ExerciseSetRow {
  id: number;
  clerk_id: string;
  date: string;
  exercise: string;
  set_number: number;
  weight_kg: number;
  reps: number;
  created_at: string;
}
