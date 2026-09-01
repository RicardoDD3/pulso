/**
 * Tiempo relativo compacto en español para la UI del chat/planner:
 * "ahora", "5m", "2h", "3d", "2sem", o una fecha corta si es más viejo.
 * Pensado para etiquetas pequeñas (updated_at de conversaciones, created_at
 * de versiones del plan). Client-side only.
 */
export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffSec = Math.floor((Date.now() - then) / 1000);
  if (diffSec < 60) return "ahora";
  const min = Math.floor(diffSec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  const wk = Math.floor(day / 7);
  if (wk < 5) return `${wk}sem`;
  return new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "short" });
}
