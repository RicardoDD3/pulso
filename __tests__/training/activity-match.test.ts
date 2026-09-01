import {
  aggregateRunningDay,
  needsMatchUpdate,
  formatPaceMinKm,
  runningActivitiesByDate,
  type MatchableActivity,
} from "@/lib/training/activity-match";

// ---------------------------------------------------------------------------
// Helpers — números reales del caso Jorge Combe 2026-07-20 (doble sesión)
// ---------------------------------------------------------------------------

function act(overrides: Partial<MatchableActivity>): MatchableActivity {
  return {
    activity_id: 1,
    date: "2026-07-20",
    activity_type: "running",
    distance_meters: 10000,
    duration_seconds: 3600,
    ...overrides,
  };
}

const MORNING_RUN = act({
  activity_id: 23665246537,
  distance_meters: 10009.3,
  duration_seconds: 4256.54,
});

const EVENING_RUN = act({
  activity_id: 23671935238,
  distance_meters: 11245.2,
  duration_seconds: 5138.11,
});

// ---------------------------------------------------------------------------
// aggregateRunningDay
// ---------------------------------------------------------------------------

describe("aggregateRunningDay", () => {
  test("suma las dos carreras de un día doble (regresión Jorge 2026-07-20)", () => {
    const agg = aggregateRunningDay([MORNING_RUN, EVENING_RUN], "2026-07-20");

    expect(agg).not.toBeNull();
    // 10009.3 m + 11245.2 m = 21254.5 m
    expect(agg!.actualDistanceKm).toBeCloseTo(21.2545, 4);
    // Ritmo ponderado: (4256.54 + 5138.11) s / 21254.5 m → min/km
    const expectedPace = ((4256.54 + 5138.11) / 21254.5) * 1000 / 60;
    expect(agg!.actualPace).toBeCloseTo(expectedPace, 4);
    // La actividad principal es la más larga (la de la tarde)
    expect(agg!.matchedActivityId).toBe(23671935238);
  });

  test("suma tres sesiones del mismo día", () => {
    const MIDDAY_RUN = act({
      activity_id: 111,
      distance_meters: 5000,
      duration_seconds: 1800,
    });
    const agg = aggregateRunningDay([MORNING_RUN, MIDDAY_RUN, EVENING_RUN], "2026-07-20");

    // 10009.3 + 5000 + 11245.2 = 26254.5 m
    expect(agg!.actualDistanceKm).toBeCloseTo(26.2545, 4);
    const expectedPace = ((4256.54 + 1800 + 5138.11) / 26254.5) * 1000 / 60;
    expect(agg!.actualPace).toBeCloseTo(expectedPace, 4);
    // La principal sigue siendo la más larga (11.2 km)
    expect(agg!.matchedActivityId).toBe(23671935238);
    expect(agg!.activityIds).toHaveLength(3);
  });

  test("suma cuatro sesiones, ignorando en la mezcla las que no son running", () => {
    const runs = [
      act({ activity_id: 1, distance_meters: 4000, duration_seconds: 1500 }),
      act({ activity_id: 2, distance_meters: 6000, duration_seconds: 2100 }),
      act({ activity_id: 3, distance_meters: 12000, duration_seconds: 4000 }),
      act({ activity_id: 4, distance_meters: 3000, duration_seconds: 1200 }),
      act({ activity_id: 5, activity_type: "strength_training", distance_meters: 500 }),
    ];
    const agg = aggregateRunningDay(runs, "2026-07-20");

    // 4 + 6 + 12 + 3 = 25 km (la de fuerza no cuenta)
    expect(agg!.actualDistanceKm).toBeCloseTo(25, 4);
    expect(agg!.matchedActivityId).toBe(3);
    expect(agg!.activityIds).toEqual([1, 2, 3, 4]);
  });

  test("una tercera carrera subida después dispara re-sync del día ya matcheado", () => {
    const twoRunAgg = aggregateRunningDay([MORNING_RUN, EVENING_RUN], "2026-07-20")!;
    const LATE_RUN = act({ activity_id: 999, distance_meters: 3000, duration_seconds: 1100 });
    const threeRunAgg = aggregateRunningDay([MORNING_RUN, EVENING_RUN, LATE_RUN], "2026-07-20")!;

    // El workout quedó guardado con el total de 2 sesiones; llega la 3ª
    expect(
      needsMatchUpdate(
        {
          matched_activity_id: twoRunAgg.matchedActivityId,
          actual_distance_km: twoRunAgg.actualDistanceKm,
        },
        threeRunAgg
      )
    ).toBe(true);
    expect(threeRunAgg.actualDistanceKm).toBeCloseTo(24.2545, 4);
  });

  test("una sola carrera devuelve sus propios valores", () => {
    const agg = aggregateRunningDay([MORNING_RUN], "2026-07-20");

    expect(agg!.matchedActivityId).toBe(23665246537);
    expect(agg!.actualDistanceKm).toBeCloseTo(10.0093, 4);
    expect(agg!.actualPace).toBeCloseTo((4256.54 / 10009.3) * 1000 / 60, 4);
  });

  test("ignora actividades de otras fechas", () => {
    const otherDay = act({ activity_id: 99, date: "2026-07-19" });
    const agg = aggregateRunningDay([otherDay, MORNING_RUN], "2026-07-20");

    expect(agg!.matchedActivityId).toBe(23665246537);
    expect(agg!.actualDistanceKm).toBeCloseTo(10.0093, 4);
  });

  test("ignora actividades que no son running", () => {
    const strength = act({ activity_id: 77, activity_type: "strength_training" });
    const agg = aggregateRunningDay([strength, MORNING_RUN], "2026-07-20");

    expect(agg!.matchedActivityId).toBe(23665246537);
  });

  test("acepta subtipos de running (trail_running, case-insensitive)", () => {
    const trail = act({ activity_id: 88, activity_type: "Trail_Running" });
    const agg = aggregateRunningDay([trail], "2026-07-20");

    expect(agg!.matchedActivityId).toBe(88);
  });

  test("sin carreras ese día devuelve null", () => {
    expect(aggregateRunningDay([], "2026-07-20")).toBeNull();
    expect(aggregateRunningDay([MORNING_RUN], "2026-07-21")).toBeNull();
  });

  test("distancia total 0 → pace null, sin dividir entre cero", () => {
    const treadmill = act({ activity_id: 5, distance_meters: 0 });
    const agg = aggregateRunningDay([treadmill], "2026-07-20");

    expect(agg!.actualDistanceKm).toBe(0);
    expect(agg!.actualPace).toBeNull();
  });

  test("tolera distance/duration null", () => {
    const noData = act({ activity_id: 6, distance_meters: null, duration_seconds: null });
    const agg = aggregateRunningDay([noData, MORNING_RUN], "2026-07-20");

    expect(agg!.actualDistanceKm).toBeCloseTo(10.0093, 4);
    expect(agg!.matchedActivityId).toBe(23665246537);
  });
});

// ---------------------------------------------------------------------------
// formatPaceMinKm — ritmo "m:ss" para el cuadrito de actividad Garmin
// ---------------------------------------------------------------------------

describe("formatPaceMinKm", () => {
  test("calcula el ritmo min/km como m:ss", () => {
    // 10 km en 70 min → 7:00 /km
    expect(formatPaceMinKm(10000, 4200)).toBe("7:00");
    // Carrera matutina de Jorge: 10009.3 m en 4256.54 s → 7:05 /km
    expect(formatPaceMinKm(10009.3, 4256.54)).toBe("7:05");
  });

  test("los segundos redondeados a 60 suben el minuto (nunca 6:60)", () => {
    // 5.98 min/km → 5:59; 5.999 → 6:00
    expect(formatPaceMinKm(1000, 359.9)).toBe("6:00");
  });

  test("distancia 0 o datos faltantes devuelven null", () => {
    expect(formatPaceMinKm(0, 3600)).toBeNull();
    expect(formatPaceMinKm(null, 3600)).toBeNull();
    expect(formatPaceMinKm(10000, null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// runningActivitiesByDate — agrupa las carreras del rango por fecha
// ---------------------------------------------------------------------------

describe("runningActivitiesByDate", () => {
  test("agrupa solo running por fecha, en orden cronológico (activity_id)", () => {
    const strength = act({ activity_id: 3, activity_type: "strength_training" });
    const grouped = runningActivitiesByDate([EVENING_RUN, strength, MORNING_RUN]);

    expect(Object.keys(grouped)).toEqual(["2026-07-20"]);
    // La matutina (id menor) va primero aunque llegó después en el array
    expect(grouped["2026-07-20"].map((a) => a.activity_id)).toEqual([
      23665246537, 23671935238,
    ]);
  });

  test("fechas distintas quedan en llaves distintas", () => {
    const other = act({ activity_id: 9, date: "2026-07-19" });
    const grouped = runningActivitiesByDate([MORNING_RUN, other]);
    expect(grouped["2026-07-19"]).toHaveLength(1);
    expect(grouped["2026-07-20"]).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// needsMatchUpdate — el sync debe RE-actualizar un día ya matcheado cuando
// llega una segunda actividad después (el bug: guard !matched_activity_id)
// ---------------------------------------------------------------------------

describe("needsMatchUpdate", () => {
  const doubleAgg = aggregateRunningDay([MORNING_RUN, EVENING_RUN], "2026-07-20")!;

  test("workout sin match → true", () => {
    expect(
      needsMatchUpdate({ matched_activity_id: null, actual_distance_km: null }, doubleAgg)
    ).toBe(true);
  });

  test("ya matcheado solo con la primera carrera y total desactualizado → true (regresión)", () => {
    expect(
      needsMatchUpdate(
        { matched_activity_id: 23665246537, actual_distance_km: 10.0093 },
        doubleAgg
      )
    ).toBe(true);
  });

  test("match al día con los mismos valores → false (sin writes redundantes)", () => {
    expect(
      needsMatchUpdate(
        {
          matched_activity_id: doubleAgg.matchedActivityId,
          actual_distance_km: doubleAgg.actualDistanceKm,
        },
        doubleAgg
      )
    ).toBe(false);
  });

  test("diferencias de redondeo minúsculas no disparan update", () => {
    expect(
      needsMatchUpdate(
        {
          matched_activity_id: doubleAgg.matchedActivityId,
          actual_distance_km: doubleAgg.actualDistanceKm + 0.0001,
        },
        doubleAgg
      )
    ).toBe(false);
  });
});
