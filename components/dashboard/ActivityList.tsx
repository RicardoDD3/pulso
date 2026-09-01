"use client";

import { useEffect, useState } from "react";
import { WorkoutDetail } from "./WorkoutDetail";

type Workout = {
  id: string;
  sport: string;
  name: string | null;
  provider: string;
  startAt: string;
  durationS: number;
  distanceM: number | null;
  hrAvg: number | null;
  hrMax: number | null;
  calories: number | null;
  elevationGainM: number | null;
};

function fmtDuration(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m ${Math.round(s % 60)}s`;
}

function fmtPace(distanceM: number | null, durationS: number): string | null {
  if (!distanceM || distanceM < 100) return null;
  const minPerKm = durationS / 60 / (distanceM / 1000);
  const mm = Math.floor(minPerKm);
  const ss = Math.round((minPerKm - mm) * 60);
  return `${mm}:${String(ss).padStart(2, "0")} /km`;
}

export function ActivityList({ date }: { date: string }) {
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/health/workouts?from=${date}&to=${date}`)
      .then((r) => (r.ok ? r.json() : { workouts: [] }))
      .then((json) => {
        if (!cancelled) setWorkouts(json.workouts ?? []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [date]);

  if (workouts.length === 0) return null;

  return (
    <div className="space-y-2">
      {workouts.map((w) => {
        const pace = fmtPace(w.distanceM, w.durationS);
        return (
          <div key={w.id} className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
            <div
              className="flex cursor-pointer items-center justify-between"
              onClick={() => setExpanded((prev) => (prev === w.id ? null : w.id))}
            >
              <span className="text-sm font-semibold">
                {w.name ?? w.sport}
                <span className="ml-2 text-xs font-normal text-zinc-500">{w.provider}</span>
              </span>
              <span className="text-xs text-zinc-500">
                {new Date(w.startAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-zinc-300 tabular-nums">
              {w.distanceM != null ? <span>{(w.distanceM / 1000).toFixed(2)} km</span> : null}
              <span>{fmtDuration(w.durationS)}</span>
              {pace ? <span>{pace}</span> : null}
              {w.hrAvg != null ? <span>♥ {w.hrAvg}{w.hrMax != null ? `/${w.hrMax}` : ""}</span> : null}
              {w.calories != null ? <span>{w.calories} kcal</span> : null}
              {w.elevationGainM != null ? <span>↗ {Math.round(w.elevationGainM)} m</span> : null}
            </div>
            {expanded === w.id ? <div className="mt-3"><WorkoutDetail workoutId={w.id} /></div> : null}
          </div>
        );
      })}
    </div>
  );
}
