/**
 * Política de versiones del plan (para deshacer). Helpers puros y testeables.
 * Las versiones se guardan en `training_plan_versions` (snapshot de plan_json
 * antes de cada modificación).
 */

export interface PlanVersionRow {
  id: number;
  created_at: string;
}

/** Ids de las versiones a borrar, dejando las `keep` más recientes. */
export function versionsToPrune(versions: PlanVersionRow[], keep = 10): number[] {
  if (versions.length <= keep) return [];
  const sorted = [...versions].sort((a, b) => b.created_at.localeCompare(a.created_at));
  return sorted.slice(keep).map((v) => v.id);
}

/** La versión más reciente por created_at, o null. */
export function latestVersion<T extends PlanVersionRow>(versions: T[]): T | null {
  if (versions.length === 0) return null;
  return [...versions].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
}
