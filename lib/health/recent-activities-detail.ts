// Detalle rico de las actividades recientes (últimos N días) para los prompts de
// los LLM: cada carrera con su esfuerzo, zonas FC, elevación, clima, GPS,
// parciales y TODAS sus vueltas (laps). Así el coach puede responder sobre
// carreras específicas ("¿cómo estuvo mi lap 5 del martes?"). El formateador es
// puro (testeable); el orquestador hace el fetch de laps/clima por activity_id.

import {
  extractEffortMetrics,
  parseHrZones,
  normalizeLap,
  summarizeSplits,
  speedMpsToPaceMinKm,
  toNum,
  type RawLap,
} from "./activity-detail";
import { formatWeather } from "./weather";
import { routePoints, buildElevationProfile, type GeoLap } from "./activity-geo";
import { formatPaceMinKm } from "./pace";

/* eslint-disable @typescript-eslint/no-explicit-any */

const ZONE_NAMES = ["Z1", "Z2", "Z3", "Z4", "Z5"];

function fmtDur(sec: number | null): string {
  if (sec == null || sec <= 0) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.round(sec % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Bloque de texto con el detalle de cada actividad (recientes primero). Puro:
 * recibe las actividades + sus laps y clima ya agrupados por activity_id.
 */
export function formatRecentActivitiesDetail(
  activities: any[],
  lapsByActivity: Record<string, RawLap[]> = {},
  weatherByActivity: Record<string, any> = {},
  opts: { maxLaps?: number } = {}
): string {
  if (!activities?.length) return "";
  const maxLaps = opts.maxLaps ?? 60;
  const out: string[] = [];

  const sorted = [...activities].sort((a, b) =>
    String(b.date || "").localeCompare(String(a.date || ""))
  );

  for (const a of sorted) {
    const id = String(toNum(a.activity_id) ?? a.activity_id ?? "");
    const laps = lapsByActivity[id] || [];
    const km = toNum(a.distance_meters);
    const durSec = toNum(a.duration_seconds);
    const eff = extractEffortMetrics(a);
    const avgPace = formatPaceMinKm(a.distance_meters, a.duration_seconds);
    const maxPace = speedMpsToPaceMinKm(a.max_speed);
    const type = String(a.activity_type || "");

    out.push(
      [
        `[${a.date}] ${a.activity_name || type} (${type})`,
        km ? `${(km / 1000).toFixed(2)}km` : null,
        durSec ? fmtDur(durSec) : null,
        avgPace ? `ritmo ${avgPace}/km${maxPace ? ` (máx ${maxPace})` : ""}` : null,
        toNum(a.avg_hr) || toNum(a.max_hr) ? `FC ${toNum(a.avg_hr) ?? "?"}/${toNum(a.max_hr) ?? "?"}` : null,
        toNum(a.vo2max_value) ? `VO2 ${toNum(a.vo2max_value)}` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    );

    const effParts: string[] = [];
    if (eff.aerobicTE != null || eff.anaerobicTE != null) {
      effParts.push(`TE ${eff.aerobicTE ?? "?"}/${eff.anaerobicTE ?? "?"} (aer/anaer)`);
    }
    if (eff.trainingLoad != null) {
      effParts.push(`Load ${Math.round(eff.trainingLoad)}${eff.teLabelEs ? ` (${eff.teLabelEs})` : ""}`);
    }
    if (eff.gapPaceMinKm) effParts.push(`GAP ${eff.gapPaceMinKm}/km`);
    if (eff.movingSec != null && eff.movingPct != null && eff.movingPct < 99) {
      effParts.push(`mov ${fmtDur(eff.movingSec)}`);
    }
    if (effParts.length) out.push(`  Esfuerzo: ${effParts.join(" · ")}`);

    const zones = parseHrZones(a);
    if (zones) {
      const zt = zones
        .filter((z) => z.seconds > 0)
        .map((z) => `${ZONE_NAMES[z.zone - 1]} ${Math.round(z.minutes)}`)
        .join(" ");
      if (zt) out.push(`  Zonas FC (min): ${zt}`);
    }

    const gain = toNum(a.elevation_gain);
    const loss = toNum(a.elevation_loss);
    const elevProf = buildElevationProfile(laps as GeoLap[]);
    const wx = formatWeather(weatherByActivity[id]);
    const start = routePoints(laps as GeoLap[])[0];
    const ctxParts: string[] = [];
    if (gain != null || loss != null) {
      ctxParts.push(
        `Elev +${Math.round(gain || 0)}/-${Math.round(loss || 0)}m${elevProf ? ` (${elevProf.minElev}-${elevProf.maxElev}m)` : ""}`
      );
    }
    if (wx && wx.tempC != null) {
      ctxParts.push(
        `Clima ${Math.round(wx.tempC)}°C${wx.humidity != null ? ` ${wx.humidity}%` : ""}${wx.windCompass ? ` viento ${wx.windCompass}` : ""}${wx.typeEs ? ` ${wx.typeEs}` : ""}`
      );
    }
    if (start) ctxParts.push(`Inicio ${start.lat.toFixed(3)},${start.lng.toFixed(3)}`);
    if (ctxParts.length) out.push(`  ${ctxParts.join(" · ")}`);

    const splits = summarizeSplits(a.raw_summary?.splitSummaries);
    if (splits.length) {
      const st = splits
        .map((s) => `${s.label}${s.km != null ? ` ${s.km.toFixed(1)}km` : ""}${s.paceMinKm ? `@${s.paceMinKm}` : ""}`)
        .join(" · ");
      out.push(`  Parciales: ${st}`);
    }

    if (laps.length) {
      const norm = laps.map(normalizeLap);
      const lapStr = norm
        .slice(0, maxLaps)
        .map((l) =>
          [
            `L${l.index}`,
            l.intensity !== "—" ? l.intensity : null,
            l.km != null ? `${l.km.toFixed(2)}km` : null,
            l.paceMinKm,
            l.avgHr || l.maxHr ? `${l.avgHr ?? "?"}/${l.maxHr ?? "?"}♥` : null,
            l.cadence != null ? `${Math.round(l.cadence)}spm` : null,
            l.powerW != null ? `${l.powerW}w` : null,
          ]
            .filter(Boolean)
            .join(" ")
        )
        .join("; ");
      const extra = norm.length > maxLaps ? ` (+${norm.length - maxLaps} vueltas más)` : "";
      out.push(`  Vueltas (${norm.length}): ${lapStr}${extra}`);
    }

    out.push("");
  }

  return out.join("\n").trim();
}

// Convertida de I/O a pura: la versión original (fetchRecentActivitiesDetailText)
// recibía SupabaseClient + clerkId y consultaba activity_laps/activity_weather;
// ahora recibe esas filas ya cargadas y conserva el filtrado/agrupado idéntico.
/**
 * Filtra las actividades a los últimos `days` días, agrupa sus laps y clima por
 * activity_id (las tablas no tienen columna date) y devuelve el bloque de texto.
 */
export function buildRecentActivitiesDetailText(
  activities: any[],
  lapsRows: any[],
  weatherRows: any[],
  days = 15,
  opts?: { maxLaps?: number }
): string {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().split("T")[0];

  const recent = (activities || []).filter((a) => String(a?.date || "") >= cutoffStr);
  if (!recent.length) return "";

  const ids = recent.map((a) => a.activity_id).filter((x) => x != null);
  if (!ids.length) return formatRecentActivitiesDetail(recent, {}, {}, opts);

  const idSet = new Set(ids.map((x) => String(x)));
  const lapsByActivity: Record<string, any[]> = {};
  for (const l of lapsRows || []) {
    if (!idSet.has(String(l.activity_id))) continue;
    (lapsByActivity[String(l.activity_id)] ??= []).push(l);
  }
  // La query original ordenaba por lap_index; aquí se ordena tras agrupar.
  for (const id of Object.keys(lapsByActivity)) {
    lapsByActivity[id].sort((a, b) => Number(a.lap_index ?? 0) - Number(b.lap_index ?? 0));
  }
  const weatherByActivity: Record<string, any> = {};
  for (const w of weatherRows || []) {
    if (!idSet.has(String(w.activity_id))) continue;
    weatherByActivity[String(w.activity_id)] = w;
  }

  return formatRecentActivitiesDetail(recent, lapsByActivity, weatherByActivity, opts);
}
