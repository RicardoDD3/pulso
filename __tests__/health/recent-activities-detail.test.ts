import { formatRecentActivitiesDetail } from "@/lib/health/recent-activities-detail";

const ACTIVITY = {
  activity_id: 111,
  date: "2026-07-21",
  activity_type: "running",
  activity_name: "Miguel Hidalgo Carrera",
  distance_meters: 7400,
  duration_seconds: 2535, // 42:15
  avg_hr: 137,
  max_hr: 177,
  max_speed: 4.0,
  elevation_gain: 166,
  elevation_loss: 295,
  vo2max_value: 46,
  aerobic_training_effect: 3,
  anaerobic_training_effect: 0.5,
  avg_grade_adjusted_speed_mps: 2.9,
  moving_duration_seconds: 2510,
  elapsed_duration_seconds: 2535,
  raw_summary: {
    activityTrainingLoad: 88,
    trainingEffectLabel: "AEROBIC_BASE",
    hrTimeInZone_1: 720,
    hrTimeInZone_2: 480,
    hrTimeInZone_3: 180,
    hrTimeInZone_4: 0,
    hrTimeInZone_5: 0,
    splitSummaries: [
      { splitType: "RWD_RUN", distance: 6200, duration: 2100 },
      { splitType: "RWD_WALK", distance: 1200, duration: 435 },
    ],
  },
};

const LAPS = [
  { lap_index: 1, intensity_type: "INTERVAL", distance_meters: 974, duration_seconds: 277, avg_hr: 122, max_hr: 156, avg_run_cadence_spm: 159, min_elevation_m: 2391, max_elevation_m: 2425, start_latitude: 19.3975, start_longitude: -99.2418, end_latitude: 19.3998, end_longitude: -99.2422 },
  { lap_index: 2, intensity_type: "ACTIVE", distance_meters: 1000, duration_seconds: 292, avg_hr: 156, max_hr: 167, avg_run_cadence_spm: 168, min_elevation_m: 2404, max_elevation_m: 2419, start_latitude: 19.3998, start_longitude: -99.2423, end_latitude: 19.3999, end_longitude: -99.2438 },
];

describe("formatRecentActivitiesDetail", () => {
  it("returns empty string with no activities", () => {
    expect(formatRecentActivitiesDetail([])).toBe("");
  });

  it("renders a rich per-activity block with laps", () => {
    const text = formatRecentActivitiesDetail(
      [ACTIVITY],
      { "111": LAPS },
      { "111": { temp: 57, relative_humidity: 77, wind_direction_compass: "e", weather_type: "Cloudy" } }
    );
    // Cabecera
    expect(text).toContain("[2026-07-21] Miguel Hidalgo Carrera (running)");
    expect(text).toContain("7.40km");
    expect(text).toContain("ritmo 5:43/km"); // 2535s / 7.4km
    expect(text).toContain("FC 137/177");
    expect(text).toContain("VO2 46");
    // Esfuerzo
    expect(text).toContain("TE 3/0.5 (aer/anaer)");
    expect(text).toContain("Load 88 (Base aeróbica)");
    expect(text).toContain("GAP");
    // Zonas
    expect(text).toContain("Zonas FC (min): Z1 12 Z2 8 Z3 3");
    // Elevación + clima + GPS
    expect(text).toContain("Elev +166/-295m");
    expect(text).toContain("Clima 14°C 77% viento E Nublado");
    expect(text).toContain("Inicio 19.398,-99.242");
    // Parciales
    expect(text).toContain("Corriendo 6.2km");
    expect(text).toContain("Caminando 1.2km");
    // Vueltas
    expect(text).toContain("Vueltas (2):");
    expect(text).toContain("L1 Intervalo 0.97km");
    expect(text).toContain("122/156♥");
  });

  it("caps the number of laps listed and notes the remainder", () => {
    const manyLaps = Array.from({ length: 70 }, (_, i) => ({
      lap_index: i + 1,
      distance_meters: 1000,
      duration_seconds: 300,
      avg_hr: 140,
    }));
    const text = formatRecentActivitiesDetail([ACTIVITY], { "111": manyLaps }, {}, { maxLaps: 60 });
    expect(text).toContain("Vueltas (70):");
    expect(text).toContain("(+10 vueltas más)");
  });

  it("handles an old activity without new data (no effort/laps lines)", () => {
    const text = formatRecentActivitiesDetail([
      { activity_id: 9, date: "2026-01-01", activity_type: "running", activity_name: "Vieja", distance_meters: 5000, duration_seconds: 1500 },
    ]);
    expect(text).toContain("[2026-01-01] Vieja (running)");
    expect(text).not.toContain("Esfuerzo:");
    expect(text).not.toContain("Vueltas (");
  });
});
