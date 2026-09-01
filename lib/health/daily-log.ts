/**
 * Bloques CRUDOS de Garmin para los prompts de los 3 chats (Coach de
 * Biomarcadores, Coach de Tracking y chat "Planes").
 *
 * `coach-prompt.ts` ya manda el agregado (baseline, promedios 7/30/90,
 * percentiles, tendencia semanal), pero sin el día a día los chats no podían
 * responder "¿cuántos pasos di el martes?" y varias columnas con dato
 * (distancia diaria, FC mín/máx, hrv_status, fases y horario de sueño) no
 * llegaban a ningún bloque.
 */

type Row = Record<string, unknown>;

export interface StepsGoalInput {
  min: number;
  max: number;
}

/** Número positivo o null (mismo criterio que el resto de los formatters). */
function num(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return isNaN(n) || n <= 0 ? null : n;
}

/** Segundos → "38m" (minutos redondeados). */
function mins(seconds: unknown): string | null {
  const s = num(seconds);
  return s == null ? null : `${Math.round(s / 60)}m`;
}

/** Hora local ("01:12") de un timestamp ISO con offset, en la tz indicada. */
function localTime(iso: unknown, timeZone: string): string | null {
  if (typeof iso !== "string" || !iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleTimeString("es-MX", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** Miles con separador ("150,000"). */
function thousands(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/** 24100 → "24.1k" (mismo formato compacto que la vista de semana). */
function compactSteps(steps: number): string {
  return `${(steps / 1000).toFixed(1)}k`;
}

/** Lunes (YYYY-MM-DD) de la semana de dateStr. */
function mondayOf(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().split("T")[0];
}

/**
 * Registro día a día: una línea por fecha con TODO lo que el reloj guardó ese
 * día (resumen diario + noche de sueño). Las métricas sin dato se omiten.
 */
export function formatDailyLog(
  summaries: Array<Row>,
  sleepData: Array<Row>,
  timeZone = "America/Mexico_City"
): string {
  const byDate = new Map<string, { summary?: Row; sleep?: Row }>();
  for (const s of summaries || []) {
    const date = String(s.date ?? "");
    if (!date) continue;
    (byDate.get(date) ?? byDate.set(date, {}).get(date)!).summary = s;
  }
  for (const s of sleepData || []) {
    const date = String(s.date ?? "");
    if (!date) continue;
    (byDate.get(date) ?? byDate.set(date, {}).get(date)!).sleep = s;
  }
  if (!byDate.size) return "";

  const lines: string[] = [];
  for (const date of [...byDate.keys()].sort()) {
    const { summary: s, sleep } = byDate.get(date)!;
    const parts: string[] = [];

    if (s) {
      const steps = num(s.steps);
      if (steps != null) parts.push(`pasos ${steps}`);

      const dist = num(s.distance_meters);
      if (dist != null) parts.push(`dist ${(dist / 1000).toFixed(1)} km`);

      const cal = num(s.total_calories);
      const act = num(s.active_calories);
      if (cal != null) parts.push(`cal ${cal}${act != null ? ` (act ${act})` : ""}`);

      const rest = num(s.resting_hr);
      const minHr = num(s.min_hr);
      const maxHr = num(s.max_hr);
      if (rest != null || minHr != null || maxHr != null) {
        const extra = [
          minHr != null ? `mín ${minHr}` : null,
          maxHr != null ? `máx ${maxHr}` : null,
        ].filter(Boolean);
        const head = rest != null ? `FC rep ${rest}` : "FC";
        parts.push(extra.length ? `${head} (${extra.join(", ")})` : head);
      }

      const stress = num(s.avg_stress);
      if (stress != null) parts.push(`estrés ${stress}`);

      const bbHigh = num(s.body_battery_high);
      const bbLow = num(s.body_battery_low);
      if (bbHigh != null || bbLow != null) parts.push(`BB ${bbHigh ?? "?"}→${bbLow ?? "?"}`);

      const resp = num(s.avg_respiration);
      if (resp != null) parts.push(`resp ${resp}`);

      const hrv = num(s.hrv_weekly_avg);
      const hrvStatus = typeof s.hrv_status === "string" ? s.hrv_status : null;
      if (hrv != null) parts.push(`HRV ${hrv}${hrvStatus ? ` (${hrvStatus})` : ""}`);
      else if (hrvStatus) parts.push(`HRV ${hrvStatus}`);

      const up = num(s.floors_climbed);
      const down = num(s.floors_descended);
      if (up != null || down != null) {
        parts.push(`pisos ${Math.round(up ?? 0)}↑/${Math.round(down ?? 0)}↓`);
      }

      const mod = Number(s.moderate_intensity_min ?? 0);
      const vig = Number(s.vigorous_intensity_min ?? 0);
      if (s.moderate_intensity_min != null || s.vigorous_intensity_min != null) {
        parts.push(`intensidad ${mod + vig} min (mod ${mod} + vig ${vig})`);
      }
    }

    if (sleep) {
      const total = num(sleep.sleep_seconds);
      const stages = [
        mins(sleep.deep_sleep_seconds) && `prof ${mins(sleep.deep_sleep_seconds)}`,
        mins(sleep.light_sleep_seconds) && `ligero ${mins(sleep.light_sleep_seconds)}`,
        mins(sleep.rem_sleep_seconds) && `REM ${mins(sleep.rem_sleep_seconds)}`,
        mins(sleep.awake_seconds) && `desp ${mins(sleep.awake_seconds)}`,
      ].filter(Boolean);
      const score = num(sleep.sleep_score);
      const start = localTime(sleep.sleep_start, timeZone);
      const end = localTime(sleep.sleep_end, timeZone);

      if (total != null || score != null || stages.length) {
        let text = total != null ? `sueño ${(total / 3600).toFixed(1)} h` : "sueño";
        if (score != null) text += ` score ${score}`;
        if (stages.length) text += ` (${stages.join(", ")})`;
        if (start && end) text += ` ${start}→${end}`;
        parts.push(text);
      }
    }

    if (parts.length) lines.push(`  ${date}: ${parts.join(" | ")}`);
  }

  if (!lines.length) return "";
  return [
    "REGISTRO DIARIO COMPLETO (una línea por día, dato crudo del reloj):",
    ...lines,
  ].join("\n");
}

/**
 * Pasos contra la meta semanal del usuario (`training_settings`, editable desde
 * la vista de semana). Sin este bloque los chats veían promedios de pasos pero
 * no sabían cuál es su meta ni si la semana va bien.
 */
export function formatStepsBlock(
  summaries: Array<Row>,
  goal: StepsGoalInput,
  today: string
): string {
  const days = (summaries || [])
    .map((s) => ({ date: String(s.date ?? ""), steps: num(s.steps) }))
    .filter((d): d is { date: string; steps: number } => !!d.date && d.steps != null)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!days.length) return "";

  const dailyGoal = goal.min / 7;
  const total = days.reduce((sum, d) => sum + d.steps, 0);
  const hit = days.filter((d) => d.steps >= dailyGoal).length;

  const lines = [
    `PASOS (meta semanal del usuario: ${thousands(goal.min)}–${thousands(goal.max)}; meta diaria ≈ ${thousands(dailyGoal)}):`,
    `  Total del periodo: ${thousands(total)} en ${days.length} días | promedio diario ${thousands(total / days.length)} | días que alcanzaron la meta diaria: ${hit}/${days.length}`,
  ];

  const currentMonday = mondayOf(today);
  const weeks = new Map<string, { total: number; days: number; best: { date: string; steps: number } }>();
  for (const d of days) {
    const monday = mondayOf(d.date);
    const week = weeks.get(monday);
    if (!week) {
      weeks.set(monday, { total: d.steps, days: 1, best: { date: d.date, steps: d.steps } });
      continue;
    }
    week.total += d.steps;
    week.days += 1;
    if (d.steps > week.best.steps) week.best = { date: d.date, steps: d.steps };
  }

  lines.push(`  Por semana (del lunes indicado, vs. meta mínima ${thousands(goal.min)}):`);
  for (const [monday, week] of [...weeks.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const pct = goal.min > 0 ? Math.round((week.total / goal.min) * 100) : 0;
    const partial = monday === currentMonday ? ` — en curso, ${week.days} días` : "";
    lines.push(
      `    ${monday}: ${compactSteps(week.total)} (${pct}% de la meta) | mejor día ${week.best.date} (${compactSteps(week.best.steps)})${partial}`
    );
  }

  return lines.join("\n");
}
