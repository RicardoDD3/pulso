/**
 * Snapshot de una versión del plan en `training_plan_versions` (para deshacer).
 *
 * Se llama ANTES de sobrescribir `plan_json` en cualquier ruta que edite el plan
 * (modify, day, swap, rebalance), así "deshacer" retrocede el último cambio sin
 * importar qué ruta lo hizo. Best-effort: si el insert falla, se registra y se
 * continúa (no bloquea la edición).
 */
import { versionsToPrune, type PlanVersionRow } from "@/lib/training/plan-versions";

// TODO(repo-wiring): el original recibía un `SupabaseClient` (@supabase/supabase-js,
// que este repo no usa). La capa de I/O de versiones se reescribirá como repo
// (drizzle); mientras, este tipo estructural mínimo cubre exactamente las
// operaciones que hace snapshotPlanVersion y mantiene la lógica intacta.
export interface VersionStoreClient {
  from(table: string): {
    insert(row: Record<string, unknown>): PromiseLike<{ error: unknown }>;
    select(columns: string): {
      eq(
        column: string,
        value: unknown
      ): {
        eq(column: string, value: unknown): PromiseLike<{ data: PlanVersionRow[] | null }>;
      };
    };
    delete(): { in(column: string, ids: number[]): PromiseLike<unknown> };
  };
}

const KEEP_VERSIONS = 20;

export async function snapshotPlanVersion(
  supabase: VersionStoreClient,
  planId: number,
  clerkId: string,
  planJson: unknown,
  label: string
): Promise<void> {
  const { error } = await supabase.from("training_plan_versions").insert({
    plan_id: planId,
    clerk_id: clerkId,
    plan_json: planJson,
    label: label.slice(0, 80),
  });
  if (error) {
    console.error("[plan-version-store] snapshot failed:", error);
    return;
  }
  const { data } = await supabase
    .from("training_plan_versions")
    .select("id, created_at")
    .eq("plan_id", planId)
    .eq("clerk_id", clerkId);
  const toPrune = versionsToPrune(data ?? [], KEEP_VERSIONS);
  if (toPrune.length > 0) {
    await supabase.from("training_plan_versions").delete().in("id", toPrune);
  }
}
