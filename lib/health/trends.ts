// Transformaciones puras para las gráficas de tendencia (TrendsTab).
// La mayoría de métricas de daily_summary se grafican directo; aquí viven las
// dos que sí tienen lógica: sumar intensidad (moderada + vigorosa) con manejo
// de nulos, y obtener el último valor conocido de una serie para los subtítulos.

/** Minutos de intensidad = moderada + vigorosa. Null solo si faltan ambas. */
export function sumIntensity(
  moderate?: number | null,
  vigorous?: number | null
): number | null {
  if (moderate == null && vigorous == null) return null;
  return Number(moderate ?? 0) + Number(vigorous ?? 0);
}

/** Último valor no nulo de una serie (para los subtítulos "actual: X"). */
export function lastNonNull(
  values: Array<number | null | undefined>
): number | null {
  for (let i = values.length - 1; i >= 0; i--) {
    const v = values[i];
    if (v != null) return Number(v);
  }
  return null;
}
