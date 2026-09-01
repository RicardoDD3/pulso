/**
 * POST /api/training/plans shared by both generator forms.
 * Resolves to null on success, or the error message to display.
 */
export async function postPlan(
  body: Record<string, unknown>,
  fallbackError: string,
): Promise<string | null> {
  try {
    const res = await fetch("/api/training/plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => null);
      return json?.error?.message ?? fallbackError;
    }
    return null;
  } catch {
    return fallbackError;
  }
}

export const fieldClass =
  "w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-emerald-500";
export const labelClass = "block text-xs font-medium text-zinc-400";
