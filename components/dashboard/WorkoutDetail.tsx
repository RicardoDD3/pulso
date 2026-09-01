"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useViewAs } from "@/lib/hooks/use-view-as";

type Lap = {
  id: string;
  kind: string;
  lapIndex: number;
  durationS: number | null;
  distanceM: number | null;
  hrAvg: number | null;
  hrMax: number | null;
  cadenceAvg: number | null;
  powerAvgW: number | null;
  speedAvgMps: number | null;
  elevationGainM: number | null;
};

type Zone = { zone: number; seconds: number };
type RoutePoint = { seq: number; lat: number; lng: number; elevationM: number | null };
type Weather = {
  tempC: number | null;
  apparentTempC: number | null;
  relativeHumidity: number | null;
  windSpeedMs: number | null;
} | null;

type Detail = {
  workout: {
    id: string;
    aerobicTe: number | null;
    anaerobicTe: number | null;
    trainingLoad: number | null;
    teLabel: string | null;
    gapMps: number | null;
    movingS: number | null;
    detailSource: string | null;
  };
  laps: Lap[];
  zones: Zone[];
  route: RoutePoint[];
  weather: Weather;
};

function fmtPace(mps: number | null): string {
  if (!mps || mps <= 0) return "—";
  const secPerKm = 1000 / mps;
  const mm = Math.floor(secPerKm / 60);
  const ss = Math.round(secPerKm % 60);
  return `${mm}:${String(ss).padStart(2, "0")}`;
}

function fmtDur(s: number | null): string {
  if (s == null) return "—";
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.round(s % 60)).padStart(2, "0")}`;
}

const ZONE_COLORS = ["#71717a", "#60a5fa", "#4ade80", "#fbbf24", "#f87171"];

export function WorkoutDetail({ workoutId }: { workoutId: string }) {
  const t = useTranslations("workout");
  const tCommon = useTranslations("common");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { viewAs, qs } = useViewAs();

  const load = () =>
    fetch(qs(`/api/health/workouts/${workoutId}`))
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setDetail)
      .catch(() => setError(true));

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workoutId]);

  if (error) return <p className="text-sm text-red-400">{tCommon("error")}</p>;
  if (!detail) return <p className="text-sm text-zinc-500">{tCommon("loading")}</p>;

  const { workout, laps, zones, route, weather } = detail;
  const hasEffort =
    workout.aerobicTe != null || workout.trainingLoad != null || workout.gapMps != null;
  const totalZoneSeconds = zones.reduce((sum, z) => sum + z.seconds, 0);
  const realLaps = laps.filter((l) => l.kind === "lap");

  async function uploadFit(file: File) {
    setUploading(true);
    const form = new FormData();
    form.append("file", file);
    await fetch(`/api/health/workouts/${workoutId}/fit`, { method: "POST", body: form });
    setUploading(false);
    await load();
  }

  return (
    <div className="space-y-4 border-t border-zinc-800 pt-3">
      {/* Effort (FIT only) */}
      {hasEffort ? (
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-zinc-300 tabular-nums">
          {workout.aerobicTe != null ? <span>aTE {workout.aerobicTe}</span> : null}
          {workout.anaerobicTe != null ? <span>anTE {workout.anaerobicTe}</span> : null}
          {workout.trainingLoad != null ? <span>{t("load")} {Math.round(workout.trainingLoad)}</span> : null}
          {workout.teLabel ? <span className="text-emerald-400">{workout.teLabel}</span> : null}
          {workout.gapMps != null ? <span>GAP {fmtPace(workout.gapMps)} /km</span> : null}
          {workout.movingS != null ? <span>{t("moving")} {fmtDur(workout.movingS)}</span> : null}
        </div>
      ) : null}

      {/* Route map (SVG polyline, Web Mercator-ish equirect for small extents) */}
      {route.length > 1 ? <RouteMap route={route} /> : null}

      {/* Elevation profile */}
      {route.some((p) => p.elevationM != null) ? <ElevationProfile route={route} /> : null}

      {/* HR zones */}
      {zones.length > 0 && totalZoneSeconds > 0 ? (
        <div>
          <p className="mb-1 text-[11px] font-medium tracking-wide text-zinc-500 uppercase">{t("hrZones")}</p>
          <div className="flex h-4 w-full overflow-hidden rounded-md">
            {zones.map((z) => (
              <div
                key={z.zone}
                title={`Z${z.zone}: ${fmtDur(z.seconds)}`}
                style={{
                  width: `${(z.seconds / totalZoneSeconds) * 100}%`,
                  background: ZONE_COLORS[z.zone - 1] ?? "#3f3f46",
                }}
              />
            ))}
          </div>
        </div>
      ) : null}

      {/* Laps */}
      {realLaps.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-xs tabular-nums">
            <thead className="text-zinc-500">
              <tr className="text-left">
                <th className="py-1 pr-3">#</th>
                <th className="py-1 pr-3">{t("distance")}</th>
                <th className="py-1 pr-3">{t("time")}</th>
                <th className="py-1 pr-3">{t("pace")}</th>
                <th className="py-1 pr-3">HR</th>
                {realLaps.some((l) => l.cadenceAvg != null) ? <th className="py-1 pr-3">{t("cadence")}</th> : null}
                {realLaps.some((l) => l.powerAvgW != null) ? <th className="py-1 pr-3">W</th> : null}
              </tr>
            </thead>
            <tbody className="text-zinc-300">
              {realLaps.map((lap) => (
                <tr key={lap.id} className="border-t border-zinc-800/60">
                  <td className="py-1 pr-3">{lap.lapIndex}</td>
                  <td className="py-1 pr-3">{lap.distanceM != null ? `${(lap.distanceM / 1000).toFixed(2)} km` : "—"}</td>
                  <td className="py-1 pr-3">{fmtDur(lap.durationS)}</td>
                  <td className="py-1 pr-3">{fmtPace(lap.speedAvgMps)}</td>
                  <td className="py-1 pr-3">{lap.hrAvg ?? "—"}{lap.hrMax != null ? `/${lap.hrMax}` : ""}</td>
                  {realLaps.some((l) => l.cadenceAvg != null) ? <td className="py-1 pr-3">{lap.cadenceAvg ?? "—"}</td> : null}
                  {realLaps.some((l) => l.powerAvgW != null) ? <td className="py-1 pr-3">{lap.powerAvgW ?? "—"}</td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {/* Weather */}
      {weather?.tempC != null ? (
        <p className="text-xs text-zinc-500">
          {t("weather")}: {weather.tempC}°C
          {weather.apparentTempC != null ? ` (${t("feelsLike")} ${weather.apparentTempC}°C)` : ""}
          {weather.relativeHumidity != null ? ` · ${weather.relativeHumidity}%` : ""}
          {weather.windSpeedMs != null ? ` · ${weather.windSpeedMs} m/s` : ""}
        </p>
      ) : null}

      {/* FIT upload hint — only when no fine detail yet */}
      {workout.detailSource == null && !viewAs ? (
        <div>
          <input
            ref={fileRef}
            type="file"
            accept=".fit"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void uploadFit(f);
              e.target.value = "";
            }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="rounded-md border border-dashed border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800 disabled:opacity-40"
          >
            {uploading ? tCommon("loading") : t("uploadFitHint")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function RouteMap({ route }: { route: RoutePoint[] }) {
  const lats = route.map((p) => p.lat);
  const lngs = route.map((p) => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const W = 600;
  const H = 240;
  const pad = 12;
  // Simple equirectangular projection with latitude correction — fine for
  // activity-sized extents.
  const latScale = (H - 2 * pad) / Math.max(maxLat - minLat, 1e-6);
  const lngScale =
    ((W - 2 * pad) / Math.max(maxLng - minLng, 1e-6)) *
    Math.cos(((minLat + maxLat) / 2) * (Math.PI / 180));
  const scale = Math.min(latScale, lngScale);
  const points = route
    .map((p) => {
      const x = pad + (p.lng - minLng) * scale;
      const y = H - pad - (p.lat - minLat) * scale;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full">
        <polyline points={points} fill="none" stroke="#34d399" strokeWidth={2} />
        <circle
          cx={points.split(" ")[0]?.split(",")[0]}
          cy={points.split(" ")[0]?.split(",")[1]}
          r={4}
          fill="#4ade80"
        />
      </svg>
      <p className="px-2 pb-1 text-[10px] text-zinc-600">© OpenStreetMap contributors</p>
    </div>
  );
}

function ElevationProfile({ route }: { route: RoutePoint[] }) {
  const points = route.filter((p) => p.elevationM != null);
  if (points.length < 2) return null;
  const elevations = points.map((p) => p.elevationM!);
  const min = Math.min(...elevations);
  const max = Math.max(...elevations);
  const W = 600;
  const H = 90;
  const path = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * W;
      const y = H - 6 - ((p.elevationM! - min) / Math.max(max - min, 1)) * (H - 14);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full rounded-lg border border-zinc-800 bg-zinc-950">
      <path d={`${path} L${W},${H} L0,${H} Z`} fill="#34d39922" stroke="none" />
      <path d={path} fill="none" stroke="#34d399" strokeWidth={1.5} />
      <text x={4} y={12} fontSize={10} fill="#71717a">{Math.round(max)} m</text>
      <text x={4} y={H - 8} fontSize={10} fill="#71717a">{Math.round(min)} m</text>
    </svg>
  );
}
