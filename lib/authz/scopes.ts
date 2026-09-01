/** Grant scopes (client-safe module — no DB imports). */
export const GRANT_SCOPES = ["health", "workouts", "labs", "training", "exercises"] as const;
export type GrantScope = (typeof GRANT_SCOPES)[number];
