// El peso vive en body_composition (weight_grams); el KPI de "hoy" muestra la
// última medición conocida hasta la fecha, igual que el VO2 max en vo2max.ts.

export interface WeightPoint {
  date: string;
  weightKg: number;
}

export function toWeightPoint(
  row: { date: string; weight_grams?: number | null } | null
): WeightPoint | null {
  if (!row || row.weight_grams == null) return null;
  return { date: row.date, weightKg: Number(row.weight_grams) / 1000 };
}

/**
 * Historial completo de peso (todas las mediciones con báscula), en kg y
 * ordenado ascendente. La gráfica de tendencia lo usa sin filtrar por rango:
 * las mediciones son esporádicas y suelen caer fuera de la ventana de 7/30/90
 * días, así que limitarlas por rango dejaba la gráfica vacía.
 */
export function buildWeightHistory(
  rows: Array<{ date: string; weight_grams?: number | null }> | null | undefined
): WeightPoint[] {
  return (rows ?? [])
    .map(toWeightPoint)
    .filter((p): p is WeightPoint => p != null)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export interface BodyCompositionRow {
  date: string;
  weight_grams?: number | null;
  bmi?: number | null;
  body_fat_pct?: number | null;
  muscle_mass_grams?: number | null;
  body_water_pct?: number | null;
  bone_mass_grams?: number | null;
}

/**
 * Historial de composición corporal para los prompts: de esta tabla solo el
 * peso llegaba a los chats, así que grasa/músculo/agua/hueso/IMC —que sí están
 * en la DB— se daban por inexistentes. Una línea por medición, columnas sin
 * dato omitidas.
 */
export function formatBodyComposition(
  rows: Array<BodyCompositionRow> | null | undefined
): string {
  const positive = (v: unknown): number | null => {
    if (v == null) return null;
    const n = Number(v);
    return isNaN(n) || n <= 0 ? null : n;
  };

  const lines = (rows ?? [])
    .slice()
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .map((r) => {
      const parts: string[] = [];
      const kg = positive(r.weight_grams);
      if (kg != null) parts.push(`${(kg / 1000).toFixed(1)} kg`);
      const bmi = positive(r.bmi);
      if (bmi != null) parts.push(`IMC ${bmi}`);
      const fat = positive(r.body_fat_pct);
      if (fat != null) parts.push(`grasa ${fat}%`);
      const muscle = positive(r.muscle_mass_grams);
      if (muscle != null) parts.push(`músculo ${(muscle / 1000).toFixed(1)} kg`);
      const water = positive(r.body_water_pct);
      if (water != null) parts.push(`agua ${water}%`);
      const bone = positive(r.bone_mass_grams);
      if (bone != null) parts.push(`hueso ${(bone / 1000).toFixed(1)} kg`);
      return parts.length ? `  ${r.date}: ${parts.join(" | ")}` : null;
    })
    .filter((l): l is string => l != null);

  if (!lines.length) return "";
  return ["COMPOSICIÓN CORPORAL (historial completo de báscula):", ...lines].join("\n");
}
