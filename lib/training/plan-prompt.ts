import { computeStatsWithDates, formatStatsLine, formatMinSec } from "@/lib/health/stats";
import { classifyRun, personalHrMax } from "@/lib/training/run-intensity";

/** Valor numérico positivo o null (mismo filtro >0 que los promedios originales). */
function posNum(v: unknown): number | null {
  const n = Number(v);
  return isNaN(n) || n <= 0 ? null : n;
}

/** Lunes de la semana de dateStr (YYYY-MM-DD, aritmética UTC). */
function mondayOf(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().split("T")[0];
}

/** Filas ya leídas de la DB con las que se arma el contexto de 90 días. */
export interface TrainingContextRows {
  /** Actividades de los últimos 90 días, orden ascendente por fecha. */
  activities: Array<Record<string, unknown>> | null;
  /** Resúmenes diarios de los últimos 90 días, orden ascendente por fecha. */
  summaries: Array<Record<string, unknown>> | null;
  /** Sueño de los últimos 90 días, orden ascendente por fecha. */
  sleepData: Array<Record<string, unknown>> | null;
  /** Composición corporal más reciente primero (se usa solo la primera fila). */
  bodyCompRows: Array<Record<string, unknown>> | null;
  /** Sesión de laboratorio más reciente primero (se usa solo la primera fila). */
  labSessionRows: Array<{ sample_date?: string | null } & Record<string, unknown>> | null;
  /** Resultados de la sesión de laboratorio más reciente, orden categoría/test. */
  labResults: Array<Record<string, unknown>> | null;
  /** Texto ya formateado del detalle de actividades (buildRecentActivitiesDetailText). */
  recentActivitiesDetail: string;
}

// Convertida de I/O a pura: la versión original (fetchTrainingContext) leía
// Supabase (activities, daily_summary, sleep, body_composition,
// lab_sessions/lab_results) y llamaba fetchRecentActivitiesDetailText. Aquí
// queda solo el ensamblado; el mismo shape de retorno que consumían los
// formateadores de abajo.
// TODO(repo-wiring): la ruta de generación inyectará aquí las filas leídas por
// los repos canónicos (ventana de 90 días) y el detalle de actividades.
export function buildTrainingContext(rows: TrainingContextRows) {
  return {
    activities: rows.activities || [],
    summaries: rows.summaries || [],
    sleepData: rows.sleepData || [],
    bodyComp: rows.bodyCompRows?.[0] || null,
    labResults: rows.labResults || [],
    labDate: rows.labSessionRows?.[0]?.sample_date || null,
    recentActivitiesDetail: rows.recentActivitiesDetail,
  };
}

export function formatRunningProfile(activities: Array<Record<string, unknown>>): string {
  const runs = activities.filter(
    (a) => String(a.activity_type || "").toLowerCase().includes("running") && Number(a.distance_meters || 0) > 0
  );
  if (!runs.length) return "Sin datos de running.";

  const distances = runs.map((r) => Number(r.distance_meters || 0) / 1000);
  const totalKm = distances.reduce((a, b) => a + b, 0);
  const avgKm = totalKm / runs.length;
  const maxKm = Math.max(...distances);

  const weeks = 90 / 7;
  const weeklyAvg = totalKm / weeks;

  const paces = runs
    .map((r) => {
      const dur = Number(r.duration_seconds || 0);
      const dist = Number(r.distance_meters || 0);
      return dist > 0 ? (dur / dist) * 1000 / 60 : 0;
    })
    .filter((p) => p > 0);

  // Derive min/sec from total seconds so 59.6s rolls over to the next minute
  // ("6:00") instead of the invalid "5:60".
  const formatPace = (p: number) => {
    const totalSec = Math.round(p * 60);
    return `${Math.floor(totalSec / 60)}:${String(totalSec % 60).padStart(2, "0")}`;
  };

  const lines = [
    `Carreras ultimos 90 dias: ${runs.length}`,
    `Distancia total: ${totalKm.toFixed(1)} km`,
    `Distancia promedio: ${avgKm.toFixed(1)} km`,
    `Carrera mas larga: ${maxKm.toFixed(1)} km`,
    `Volumen semanal promedio: ${weeklyAvg.toFixed(1)} km/semana`,
  ];

  // Only emit the pace range when at least one run has a valid (positive) pace;
  // otherwise Math.min(...[])/Math.max(...[]) would render "Infinity:NaN".
  if (paces.length) {
    const minPace = Math.min(...paces);
    const maxPace = Math.max(...paces);
    lines.push(`Rango de ritmo: ${formatPace(minPace)} - ${formatPace(maxPace)} min/km`);
  }

  // Distribuciones completas (percentiles, picos con fecha, σ) para que el
  // plan se base en toda la forma de la serie, no solo en promedio/extremos.
  const runRows = runs.map((r) => {
    const km = Number(r.distance_meters || 0) / 1000;
    const dur = Number(r.duration_seconds || 0);
    return {
      date: String(r.date || ""),
      km,
      pace: km > 0 && dur > 0 ? dur / 60 / km : null,
    };
  });
  const distStats = computeStatsWithDates(runRows, (r) => r.km, (r) => r.date);
  if (distStats) lines.push(`Distribución de distancia (km): ${formatStatsLine(distStats, { decimals: 1 })}`);

  const paceStats = computeStatsWithDates(runRows, (r) => r.pace, (r) => r.date);
  if (paceStats) {
    lines.push(
      `Distribución de ritmo (min/km): ${formatStatsLine(paceStats, { fmt: formatMinSec, minLabel: "mejor", maxLabel: "peor" })}`
    );
  }

  const weeklyKm = new Map<string, number>();
  for (const r of runRows) {
    if (!/^\d{4}-\d{2}-\d{2}/.test(r.date)) continue;
    const monday = mondayOf(r.date);
    weeklyKm.set(monday, (weeklyKm.get(monday) || 0) + r.km);
  }
  const weekRows = [...weeklyKm.entries()].map(([monday, km]) => ({ date: `semana del ${monday}`, km }));
  const weekStats = computeStatsWithDates(weekRows, (r) => r.km, (r) => r.date);
  if (weekStats) lines.push(`Distribución volumen semanal (km): ${formatStatsLine(weekStats, { decimals: 1 })}`);

  // Split real fácil/calidad por FC (insumo directo de la regla 80/20).
  const hrMax = personalHrMax(runs as Array<{ max_hr?: number | null }>);
  const counts = { z2: 0, tempo: 0, hiit: 0, sin_fc: 0 };
  for (const r of runs) {
    counts[classifyRun({ avg_hr: posNum(r.avg_hr), max_hr: posNum(r.max_hr) }, { hrMaxPersonal: hrMax })]++;
  }
  const classified = counts.z2 + counts.tempo + counts.hiit;
  if (classified > 0) {
    const pct = (n: number) => Math.round((n / classified) * 100);
    const parts: string[] = [];
    if (counts.z2) parts.push(`Z2 ${counts.z2} (${pct(counts.z2)}%)`);
    if (counts.tempo) parts.push(`tempo ${counts.tempo} (${pct(counts.tempo)}%)`);
    if (counts.hiit) parts.push(`HIIT ${counts.hiit} (${pct(counts.hiit)}%)`);
    if (counts.sin_fc) parts.push(`sin FC ${counts.sin_fc}`);
    lines.push(
      `Distribución de intensidad (por FC): ${parts.join(" | ")} — fácil/calidad: ${pct(counts.z2)}/${100 - pct(counts.z2)}`
    );
  }

  const latestWithHr = [...runs].reverse().find((r) => Number(r.max_hr || 0) > 0);
  if (latestWithHr) {
    lines.push(`FC maxima registrada: ${latestWithHr.max_hr} bpm`);
    if (latestWithHr.avg_hr) lines.push(`FC promedio ultima carrera: ${latestWithHr.avg_hr} bpm`);
  }

  const latestWithVo2 = [...runs].reverse().find((r) => Number(r.vo2max_value || 0) > 0);
  if (latestWithVo2) {
    lines.push(`VO2max: ${latestWithVo2.vo2max_value}`);
  }

  return lines.join("\n");
}

export function formatRecoveryProfile(
  summaries: Array<Record<string, unknown>>,
  sleepData: Array<Record<string, unknown>>
): string {
  const lines: string[] = [];

  // Estadísticas completas por métrica (media, percentiles, picos con fecha,
  // σ, n) sobre la ventana recibida — un promedio no distingue una racha mala
  // de una métrica estable.
  const getDate = (s: Record<string, unknown>) => String(s.date);
  const pushLine = (
    label: string,
    rows: Array<Record<string, unknown>>,
    getValue: (s: Record<string, unknown>) => number | null,
    opts: { decimals?: number; unit?: string } = {}
  ) => {
    const stats = computeStatsWithDates(rows, getValue, getDate);
    if (stats) lines.push(`${label}: ${formatStatsLine(stats, opts)}`);
  };

  if (summaries.length) {
    pushLine("FC Reposo (bpm)", summaries, (s) => posNum(s.resting_hr));
    pushLine("HRV (ms)", summaries, (s) => posNum(s.hrv_weekly_avg));
    pushLine("Estrés (0-100)", summaries, (s) => posNum(s.avg_stress));
    pushLine("Body Battery máx", summaries, (s) => posNum(s.body_battery_high));
  }

  if (sleepData.length) {
    pushLine(
      "Sueño (h)",
      sleepData,
      (s) => {
        const sec = posNum(s.sleep_seconds);
        return sec == null ? null : sec / 3600;
      },
      { decimals: 1, unit: "h" }
    );
    pushLine("Sueño score", sleepData, (s) => posNum(s.sleep_score));
  }

  return lines.length ? lines.join("\n") : "Sin datos de recuperacion.";
}

export function formatEnduranceBiomarkers(labResults: Array<Record<string, unknown>>, labDate: string | null): string {
  if (!labResults.length || !labDate) return "Sin datos de laboratorio.";

  const enduranceTests = [
    "hemoglobina", "ferritina", "hierro", "vitamina d", "b12",
    "testosterona", "tsh", "glucosa",
  ];

  const relevant = labResults.filter((r) => {
    const name = String(r.test_name_normalized || r.test_name || "").toLowerCase();
    return enduranceTests.some((t) => name.includes(t));
  });

  if (!relevant.length) return `Laboratorio (${labDate}): Sin biomarcadores relevantes para entrenamiento.`;

  const lines = [`Laboratorio (${labDate}):`];
  for (const r of relevant) {
    const val = r.result != null ? r.result : r.result_text || "—";
    const ref = r.reference_min != null && r.reference_max != null
      ? ` (ref: ${r.reference_min}-${r.reference_max})`
      : "";
    const flag = r.is_flagged ? " FUERA DE RANGO" : "";
    lines.push(`  ${r.test_name}: ${val} ${r.unit || ""}${ref}${flag}`);
  }

  return lines.join("\n");
}

export function buildTrainingPlanPrompt(
  runningProfile: string,
  recoveryProfile: string,
  biomarkers: string,
  goal: {
    goal_type: string;
    goal_date: string;
    goal_time?: string;
    goal_distance_km?: number;
    available_days: number;
    terrain: string;
  },
  recentActivitiesDetail?: string
): string {
  const today = new Date().toISOString().split("T")[0];
  const goalDate = new Date(goal.goal_date);
  const diffMs = goalDate.getTime() - new Date().getTime();
  const weeksAvailable = Math.max(1, Math.round(diffMs / (7 * 24 * 60 * 60 * 1000)));

  return `Eres un entrenador experto en running y ultras. Genera un plan de entrenamiento estructurado basado en los datos reales del atleta.

=== PERFIL DEL ATLETA ===
${runningProfile}
${recentActivitiesDetail ? `\n=== DETALLE DE ACTIVIDADES (últimos 15 días: laps, esfuerzo, zonas FC, elevación, clima, GPS) ===\n${recentActivitiesDetail}\n` : ""}
=== RECUPERACION ===
${recoveryProfile}

=== BIOMARCADORES RELEVANTES ===
${biomarkers}

=== OBJETIVO ===
- Tipo: ${goal.goal_type}
- Fecha objetivo: ${goal.goal_date} (${weeksAvailable} semanas desde hoy ${today})
${goal.goal_time ? `- Tiempo objetivo: ${goal.goal_time}` : ""}
${goal.goal_distance_km ? `- Distancia: ${goal.goal_distance_km} km` : ""}
- Dias disponibles por semana: ${goal.available_days}
- Terreno: ${goal.terrain}

=== REGLAS DE PERIODIZACION ===
1. Fases: Base (30-40%) → Build (25-30%) → Peak (15-20%) → Taper (10-15%) → Race
2. Maximo +10% volumen semanal. Descarga cada 4ta semana (-25%)
3. Long run <= 35% del volumen semanal
4. 80% corrida facil (zona 1-2), 20% trabajo de calidad
5. Para ultras: fines de semana back-to-back largos, pico al 50-60% de la distancia de carrera
6. Si hay hierro/B12/VitD bajo → intensidad conservadora
7. Si sueno/HRV pobres → mas recuperacion

=== FORMATO DE RESPUESTA ===
Responde UNICAMENTE con un JSON valido (sin markdown, sin comentarios) con esta estructura exacta:

{
  "summary": {
    "total_weeks": number,
    "peak_weekly_km": number,
    "phases": [{ "name": "string", "weeks": [start, end], "focus": "string" }]
  },
  "pace_targets": {
    "easy": "min:ss/km", "tempo": "min:ss/km", "interval": "min:ss/km",
    "long_run": "min:ss/km", "race": "min:ss/km"
  },
  "hr_zones": [{ "zone": "Z1", "bpm_range": [low, high] }, ...],
  "nutrition_flags": [{ "biomarker": "string", "status": "low|normal|high", "recommendation": "string" }],
  "weeks": [{
    "week_number": 1,
    "phase": "string",
    "target_km": number,
    "notes": "string",
    "workouts": [{
      "day_of_week": 0,
      "date": "YYYY-MM-DD",
      "workout_type": "easy_run|long_run|tempo|intervals|strength|rest|recovery_run",
      "title": "string",
      "description": "string",
      "target_distance_km": number|null,
      "target_duration_min": number|null,
      "target_pace_range": "min:ss-min:ss"|null,
      "target_hr_zone": "Z1"|null,
      "intervals_detail": [{"reps":n,"distance_m":n,"pace":"min:ss","rest":"time"}]|null,
      "strength_exercises": [{"name":"string","sets":n,"reps":n}]|null
    }]
  }]
}

Genera workouts para CADA dia de CADA semana (${goal.available_days} dias de entrenamiento + dias de descanso hasta completar 7). Las fechas deben empezar el proximo lunes despues de hoy y ser consecutivas.`;
}
