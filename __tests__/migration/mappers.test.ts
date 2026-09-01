/**
 * Unit tests for the el-consejo → Pulso migration mappers (spec doc 13).
 * Fixtures are built from the origin DDL doc (el-consejo
 * biohacking-spec/02-database.md), never from real data — the driver returns
 * numeric/bigint columns as strings, so fixtures use strings on purpose.
 */
import {
  compassToDeg,
  DEFAULT_CHAT_LLM_SWITCHED_AT,
  deterministicUuid,
  extractHrZones,
  fToC,
  gramsToKg,
  mapActivity,
  mapActivityLap,
  mapActivitySplit,
  mapActivityWeather,
  mapBodyComposition,
  mapChatMessage,
  mapConversation,
  mapDailySummary,
  mapExerciseLog,
  mapExerciseSet,
  mapLabResult,
  mapLabSession,
  mapMetricSample,
  mapPlanWorkout,
  mapSleep,
  mapTrainingPlan,
  mphToMs,
  resolveHistoricalModel,
  toDateStr,
  type SrcActivity,
  type SrcActivityLap,
  type SrcActivitySplit,
} from "@/lib/migration/mappers";

const USER = "11111111-2222-4333-8444-555555555555";

describe("coercions", () => {
  it("converts grams to kg exactly", () => {
    expect(gramsToKg("72500")).toBe(72.5);
    expect(gramsToKg(33100)).toBe(33.1);
    expect(gramsToKg(null)).toBeNull();
    expect(gramsToKg("")).toBeNull();
  });

  it("converts °F to °C exactly", () => {
    expect(fToC(32)).toBe(0);
    expect(fToC("68")).toBe(20);
    expect(fToC(212)).toBe(100);
    expect(fToC(null)).toBeNull();
  });

  it("converts mph to m/s", () => {
    expect(mphToMs("10")).toBeCloseTo(4.4704, 10);
    expect(mphToMs(0)).toBe(0);
    expect(mphToMs(null)).toBeNull();
  });

  it("maps 16-point compass bearings to degrees", () => {
    expect(compassToDeg("N")).toBe(0);
    expect(compassToDeg("NNE")).toBe(22.5);
    expect(compassToDeg("w")).toBe(270);
    expect(compassToDeg("WNW")).toBe(292.5);
    expect(compassToDeg("nope")).toBeNull();
    expect(compassToDeg(null)).toBeNull();
  });

  it("normalizes date values from strings and Date objects", () => {
    expect(toDateStr("2026-05-10")).toBe("2026-05-10");
    expect(toDateStr("2026-05-10T07:00:00")).toBe("2026-05-10");
    expect(toDateStr(new Date("2026-05-10T00:00:00Z"))).toBe("2026-05-10");
    expect(toDateStr(null)).toBeNull();
    expect(toDateStr("not-a-date")).toBeNull();
  });
});

describe("deterministicUuid", () => {
  it("is stable, well-formed and namespaced", () => {
    const a = deterministicUuid("activities", "19583274650");
    expect(a).toBe(deterministicUuid("activities", "19583274650"));
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a).not.toBe(deterministicUuid("activities", "19583274651"));
    expect(a).not.toBe(deterministicUuid("lab_sessions", "19583274650"));
  });
});

describe("resolveHistoricalModel (ported resolveChatLlm cutoff)", () => {
  it("drops the default in force at the creation date", () => {
    // gemini was the default before the switch — not a user choice.
    expect(resolveHistoricalModel("gemini", "2026-08-07")).toBeNull();
    expect(resolveHistoricalModel("gemini", "2026-07-01T10:00:00Z")).toBeNull();
    // deepseek is the default on/after the switch — not a choice either.
    expect(resolveHistoricalModel("deepseek", DEFAULT_CHAT_LLM_SWITCHED_AT)).toBeNull();
    expect(resolveHistoricalModel("deepseek", "2026-08-20")).toBeNull();
  });

  it("preserves explicit choices on either side of the cutoff", () => {
    expect(resolveHistoricalModel("deepseek", "2026-08-07")).toBe("deepseek");
    expect(resolveHistoricalModel("gemini", "2026-08-08")).toBe("gemini");
    expect(resolveHistoricalModel("claude", "2026-08-07")).toBe("claude");
    expect(resolveHistoricalModel("claude", "2026-08-20")).toBe("claude");
  });

  it("respects the stored value when the row cannot be dated, and nulls empties", () => {
    expect(resolveHistoricalModel("gemini", null)).toBe("gemini");
    expect(resolveHistoricalModel(null, "2026-08-01")).toBeNull();
    expect(resolveHistoricalModel("", "2026-08-01")).toBeNull();
  });
});

describe("mapDailySummary", () => {
  const row = {
    clerk_id: "user_abc",
    date: "2026-08-15",
    steps: "12345",
    distance_meters: "9260.4",
    resting_hr: "48",
    min_hr: "44",
    max_hr: "162",
    avg_stress: "31.6",
    body_battery_high: "88",
    body_battery_low: "21",
    total_calories: "2650",
    active_calories: "820",
    avg_respiration: "14.2",
    hrv_weekly_avg: "61",
    hrv_status: "BALANCED",
    floors_climbed: "12.0",
    floors_descended: "11.0",
    moderate_intensity_min: "30",
    vigorous_intensity_min: "20",
    avg_spo2: null,
    lowest_spo2: null,
    hydration_ml: null,
  };

  it("maps to health_days with provider garmin and combined intensity minutes", () => {
    const out = mapDailySummary(row, USER);
    expect(out).toMatchObject({
      userId: USER,
      date: "2026-08-15",
      provider: "garmin",
      steps: 12345,
      floors: 12,
      intensityMinutes: 70, // moderate + 2×vigorous (Garmin convention)
      distanceM: 9260,
      caloriesTotal: 2650,
      caloriesActive: 820,
      restingHr: 48,
      hrMin: 44,
      hrMax: 162,
      stressAvg: 32,
      stressMax: null,
      respirationAvg: 14.2,
      hrvMs: 61,
      hrvStatus: "BALANCED",
    });
    // Always-NULL origin columns are not migrated (doc 13).
    expect(out.spo2Avg).toBeNull();
    expect(out.hydrationMl).toBeNull();
    // The raw copy keeps the row but drops the origin identity.
    expect((out.raw as Record<string, unknown>).clerk_id).toBeUndefined();
    expect((out.raw as Record<string, unknown>).floors_descended).toBe("11.0");
  });
});

describe("mapSleep", () => {
  it("converts second totals to minutes and anchors the session at local midnight", () => {
    const out = mapSleep(
      {
        clerk_id: "user_abc",
        date: "2026-08-15",
        sleep_seconds: "25200",
        deep_sleep_seconds: "4500",
        light_sleep_seconds: "14700",
        rem_sleep_seconds: "6000",
        awake_seconds: "1800",
        sleep_score: "82",
      },
      USER,
    );
    expect(out.totalMin).toBe(420);
    expect(out.deepMin).toBe(75);
    expect(out.lightMin).toBe(245);
    expect(out.remMin).toBe(100);
    expect(out.awakeMin).toBe(30);
    expect(out.inBedMin).toBe(450);
    expect(out.efficiency).toBe(93);
    expect(out.score).toBe(82);
    expect(out.externalId).toBe("2026-08-15");
    expect(out.startAt.getTime()).toBe(new Date("2026-08-15T00:00:00-06:00").getTime());
    expect(out.endAt.getTime()).toBe(out.startAt.getTime() + 450 * 60_000);
    expect(out.isNap).toBe(false);
  });
});

describe("mapBodyComposition", () => {
  it("converts the gram-based masses to kg", () => {
    const out = mapBodyComposition(
      {
        clerk_id: "user_abc",
        date: "2026-08-10",
        weight_grams: "72500",
        body_fat_pct: "16.8",
        muscle_mass_grams: "33100",
        bmi: "22.4",
        body_water_pct: "57.2",
        bone_mass_grams: "3200",
      },
      USER,
    );
    expect(out.weightKg).toBe(72.5);
    expect(out.muscleMassKg).toBe(33.1);
    expect(out.boneMassKg).toBe(3.2);
    expect(out.bodyFatPct).toBe(16.8);
    expect(out.bmi).toBe(22.4);
    expect(out.bodyWaterPct).toBe(57.2);
    expect(out.measuredAt.toISOString()).toBe("2026-08-10T12:00:00.000Z");
    expect(out.provider).toBe("garmin");
  });
});

describe("mapActivity", () => {
  const fixture: SrcActivity = {
    activity_id: "19583274650",
    clerk_id: "user_abc",
    date: "2026-05-10",
    calendar_date: "2026-05-10",
    activity_type: "running",
    activity_name: "Carrera matutina",
    distance_meters: "12030.5",
    duration_seconds: "3725.4",
    avg_hr: "148",
    max_hr: "176",
    avg_speed: "3.23",
    max_speed: "4.51",
    calories: "780",
    steps: "11800",
    vo2max_value: "52",
    training_effect: "3.5",
    avg_cadence: "172.5",
    elevation_gain: "145",
    elevation_loss: "140",
    aerobic_training_effect: "3.4",
    anaerobic_training_effect: "0.6",
    training_load: "182.3",
    avg_grade_adjusted_speed_mps: "3.31",
    moving_duration_seconds: "3600",
    elapsed_duration_seconds: "3800",
    start_time_local: "2026-05-10T07:12:33",
    start_time_gmt: null,
    raw_summary: {
      activityTrainingLoad: "185.7",
      trainingEffectLabel: "TEMPO",
      hrTimeInZone_1: "120.2",
      hrTimeInZone_2: "900",
      hrTimeInZone_3: "1500.7",
      hrTimeInZone_4: "800",
      hrTimeInZone_5: "60",
    },
  };

  it("maps every workout field from the DDL columns", () => {
    const out = mapActivity(fixture, USER);
    expect(out.id).toBe(deterministicUuid("activities", "19583274650"));
    expect(out.userId).toBe(USER);
    expect(out.provider).toBe("garmin");
    expect(out.externalId).toBe("19583274650");
    expect(out.sport).toBe("running");
    expect(out.name).toBe("Carrera matutina");
    // start_time_local has no offset: pinned to CDMX (-06:00).
    expect(out.startAt.getTime()).toBe(new Date("2026-05-10T07:12:33-06:00").getTime());
    expect(out.durationS).toBe(3725);
    expect(out.movingS).toBe(3600);
    expect(out.distanceM).toBe(12030.5);
    expect(out.calories).toBe(780);
    expect(out.hrAvg).toBe(148);
    expect(out.hrMax).toBe(176);
    expect(out.hrMin).toBeNull();
    expect(out.elevationGainM).toBe(145);
    expect(out.elevationLossM).toBe(140);
    expect(out.cadenceAvg).toBe(172.5);
    expect(out.speedAvgMps).toBe(3.23);
    expect(out.speedMaxMps).toBe(4.51);
    expect(out.powerAvgW).toBeNull();
    expect(out.aerobicTe).toBe(3.4);
    expect(out.anaerobicTe).toBe(0.6);
    // raw_summary.activityTrainingLoad wins over the column (extractEffortMetrics precedence).
    expect(out.trainingLoad).toBe(185.7);
    expect(out.teLabel).toBe("TEMPO");
    expect(out.gapMps).toBe(3.31);
    expect(out.vo2max).toBe(52);
    expect((out.raw as Record<string, unknown>).clerk_id).toBeUndefined();
  });

  it("falls back to the training_load column and start_time_gmt when present", () => {
    const out = mapActivity(
      {
        ...fixture,
        raw_summary: null,
        start_time_gmt: "2026-05-10T13:12:33Z",
      },
      USER,
    );
    expect(out.trainingLoad).toBe(182.3);
    expect(out.teLabel).toBeNull();
    expect(out.startAt.toISOString()).toBe("2026-05-10T13:12:33.000Z");
  });

  it("extracts hr zones (seconds, rounded) from raw_summary", () => {
    expect(extractHrZones(fixture.raw_summary)).toEqual([
      { zone: 1, seconds: 120 },
      { zone: 2, seconds: 900 },
      { zone: 3, seconds: 1501 },
      { zone: 4, seconds: 800 },
      { zone: 5, seconds: 60 },
    ]);
    expect(extractHrZones(null)).toEqual([]);
    expect(extractHrZones({ hrTimeInZone_2: "42" })).toEqual([{ zone: 2, seconds: 42 }]);
  });
});

describe("laps vs splits", () => {
  const lap: SrcActivityLap = {
    clerk_id: "user_abc",
    activity_id: "19583274650",
    lap_index: "3",
    intensity_type: "INTERVAL",
    distance_meters: "1000",
    duration_seconds: "285.2",
    avg_hr: "158",
    max_hr: "171",
    avg_run_cadence_spm: "178",
    avg_power_w: "0",
    stride_length_cm: "112.4",
    vertical_oscillation_cm: "8.1",
    vertical_ratio: "7.2",
    ground_contact_time_ms: "244",
    elevation_gain_m: "6",
    elevation_loss_m: "4",
    min_elevation_m: "2210",
    max_elevation_m: "2216",
    start_latitude: "19.41",
    start_longitude: "-99.16",
    end_latitude: "0",
    end_longitude: "0",
  };

  it("maps activity_laps with kind 'lap' and treats (0,0) as null coordinates", () => {
    const out = mapActivityLap(lap);
    expect(out.kind).toBe("lap");
    expect(out.lapIndex).toBe(3);
    expect(out.intensityType).toBe("INTERVAL");
    expect(out.distanceM).toBe(1000);
    expect(out.durationS).toBe(285.2);
    expect(out.hrAvg).toBe(158);
    expect(out.hrMax).toBe(171);
    expect(out.cadenceAvg).toBe(178);
    expect(out.powerAvgW).toBe(0);
    expect(out.strideLengthCm).toBe(112.4);
    expect(out.groundContactTimeMs).toBe(244);
    expect(out.startLat).toBe(19.41);
    expect(out.startLng).toBe(-99.16);
    expect(out.endLat).toBeNull();
    expect(out.endLng).toBeNull();
  });

  it("maps activity_typed_splits with kind 'split' and split_type as intensityType", () => {
    const split: SrcActivitySplit = {
      clerk_id: "user_abc",
      activity_id: "19583274650",
      split_index: "1",
      split_type: "RWD_RUN",
      distance_meters: "9800",
      duration_seconds: "3100",
      avg_hr: "150",
    };
    const out = mapActivitySplit(split);
    expect(out.kind).toBe("split");
    expect(out.lapIndex).toBe(1);
    expect(out.intensityType).toBe("RWD_RUN");
    expect(out.distanceM).toBe(9800);
    expect(out.durationS).toBe(3100);
    expect(out.hrAvg).toBe(150);
    expect(out.hrMax).toBeNull();
  });
});

describe("mapActivityWeather", () => {
  it("converts °F→°C, mph→m/s, compass→degrees and weather_type→WMO", () => {
    const out = mapActivityWeather({
      clerk_id: "user_abc",
      activity_id: "19583274650",
      temp: "68",
      apparent_temp: "66.2",
      dew_point: "50",
      relative_humidity: "55",
      wind_speed: "10",
      wind_direction_compass: "WNW",
      weather_type: "LIGHT RAIN",
      weather_station: "MMMX",
    });
    expect(out.tempC).toBe(20);
    expect(out.apparentTempC).toBeCloseTo(19, 10);
    expect(out.dewPointC).toBe(10);
    expect(out.relativeHumidity).toBe(55);
    expect(out.windSpeedMs).toBeCloseTo(4.4704, 10);
    expect(out.windDirectionDeg).toBe(292.5);
    expect(out.weatherCode).toBe(61);
    expect(out.source).toBe("garmin");
  });

  it("keeps unknowns null", () => {
    const out = mapActivityWeather({
      clerk_id: "u",
      activity_id: "1",
      temp: null,
      apparent_temp: null,
      dew_point: null,
      relative_humidity: null,
      wind_speed: null,
      wind_direction_compass: null,
      weather_type: "SOMETHING NEW",
      weather_station: null,
    });
    expect(out.tempC).toBeNull();
    expect(out.windSpeedMs).toBeNull();
    expect(out.windDirectionDeg).toBeNull();
    expect(out.weatherCode).toBeNull();
  });
});

describe("mapMetricSample", () => {
  it("converts timestamp_ms to a Date and keeps the metric name", () => {
    const out = mapMetricSample("hr", { timestamp_ms: "1767225600000", value: "63" }, USER);
    expect(out).not.toBeNull();
    expect(out!.recordedAt.getTime()).toBe(1767225600000);
    expect(out!.metric).toBe("hr");
    expect(out!.value).toBe(63);
    expect(out!.provider).toBe("garmin");
    expect(mapMetricSample("stress", { timestamp_ms: 1767225600000, value: 12 }, USER)!.metric).toBe(
      "stress",
    );
    expect(
      mapMetricSample("body_battery", { timestamp_ms: 1767225600000, value: 80 }, USER)!.metric,
    ).toBe("body_battery");
  });

  it("drops rows without a value or timestamp", () => {
    expect(mapMetricSample("hr", { timestamp_ms: "1767225600000", value: null }, USER)).toBeNull();
    expect(mapMetricSample("hr", { timestamp_ms: "", value: "60" }, USER)).toBeNull();
  });
});

describe("labs", () => {
  it("links lab_results to their session through the deterministic uuid", () => {
    const session = mapLabSession(
      {
        id: "7",
        clerk_id: "user_abc",
        sample_date: "2026-06-01",
        patient_name: "P",
        patient_dob: "1990-01-01",
        patient_sex: "M",
        patient_age: "36",
        lab_name: "Lab X",
        lab_location: "CDMX",
        doctor_name: "Dr. Y",
      },
      USER,
    );
    const result = mapLabResult(
      {
        id: "91",
        session_id: "7",
        category: "Glucosa y Metabolismo",
        test_name: "Glucosa",
        test_name_normalized: "glucose",
        result: "92.4",
        result_text: null,
        unit: "mg/dL",
        reference_min: "70",
        reference_max: "100",
        reference_text: null,
        is_flagged: null,
      },
      USER,
    );
    expect(session.id).toBe(deterministicUuid("lab_sessions", "7"));
    expect(result.sessionId).toBe(session.id);
    expect(result.id).toBe(deterministicUuid("lab_results", "91"));
    expect(result.valueNum).toBe(92.4);
    expect(result.refLow).toBe(70);
    expect(result.refHigh).toBe(100);
    expect(result.isFlagged).toBe(false);
    expect(session.sampleDate).toBe("2026-06-01");
    expect(session.status).toBe("completed");
  });
});

describe("conversations and messages", () => {
  it("maps coach conversations with the historical-model rule", () => {
    const frozen = mapConversation(
      "coach",
      { id: "3", clerk_id: "u", title: "Chat", llm_id: "gemini", created_at: "2026-07-01T00:00:00Z", updated_at: "2026-07-02T00:00:00Z" },
      USER,
    );
    expect(frozen.kind).toBe("coach");
    expect(frozen.model).toBeNull(); // gemini before the switch = frozen default, not a choice
    expect(frozen.id).toBe(deterministicUuid("coach_conversations", "3"));
    expect((frozen.createdAt as Date).toISOString()).toBe("2026-07-01T00:00:00.000Z");

    const chosen = mapConversation(
      "coach",
      { id: "4", clerk_id: "u", title: null, llm_id: "claude", created_at: "2026-07-01T00:00:00Z", updated_at: null },
      USER,
    );
    expect(chosen.model).toBe("claude");
  });

  it("keeps coach and planner id spaces separate and routes messages to their conversation", () => {
    const coach = mapConversation(
      "coach",
      { id: "5", title: null, llm_id: null, created_at: null, updated_at: null },
      USER,
    );
    const planner = mapConversation(
      "planner",
      { id: "5", title: null, llm_id: null, created_at: null, updated_at: null },
      USER,
    );
    expect(coach.id).not.toBe(planner.id);
    expect(planner.kind).toBe("planner");

    const msg = mapChatMessage("planner", {
      conversation_id: "5",
      role: "assistant",
      content: "Listo",
      action: "set_steps_goal",
      created_at: "2026-08-01T12:00:00Z",
    });
    expect(msg.conversationId).toBe(planner.id);
    expect(msg.role).toBe("assistant");
    expect(msg.content).toBe("Listo");
    expect(msg.action).toBe("set_steps_goal");

    const coachMsg = mapChatMessage("coach", {
      conversation_id: "5",
      role: "user",
      content: "Hola",
      created_at: null,
    });
    expect(coachMsg.conversationId).toBe(coach.id);
    expect(coachMsg.action).toBeNull();
  });
});

describe("training plans", () => {
  it("migrates plan_json intact and keys the plan on a deterministic uuid", () => {
    const planJson = { raceDistanceKm: 483, weeks: [{ weekNumber: 1 }] };
    const out = mapTrainingPlan(
      {
        id: "10",
        clerk_id: "u",
        name: "Ultra Season",
        goal_type: "ultra",
        goal_date: "2026-10-09",
        goal_time: null,
        goal_distance_km: "483",
        available_days: "6",
        terrain: "trail",
        plan_json: planJson,
        llm_used: "deterministic",
        status: "active",
        created_at: "2026-03-01T00:00:00Z",
        updated_at: "2026-08-01T00:00:00Z",
      },
      USER,
    );
    expect(out.id).toBe(deterministicUuid("training_plans", "10"));
    expect(out.planJson).toBe(planJson); // intact, same reference
    expect(out.goalDate).toBe("2026-10-09");
    expect(out.goalDistanceKm).toBe(483);
    expect(out.availableDays).toBe(6);
    expect(out.llmUsed).toBe("deterministic");
  });

  it("maps plan workouts: planned→pending and matched activity → workout uuid", () => {
    const workoutUuid = deterministicUuid("activities", "19583274650");
    const known = new Map([["19583274650", workoutUuid]]);
    const base = {
      id: "77",
      plan_id: "10",
      week_number: "2",
      day_of_week: "5",
      date: "2026-03-14",
      workout_type: "long_run",
      title: "Z2",
      target_distance_km: "28",
      target_pace_range: "6:30-7:00",
      target_hr_zone: "Z2",
      matched_activity_id: "19583274650",
      status: "completed",
      actual_distance_km: "27.6",
      actual_pace: "6.62",
    };
    const done = mapPlanWorkout(base, USER, known);
    expect(done.id).toBe(deterministicUuid("training_plan_workouts", "77"));
    expect(done.planId).toBe(deterministicUuid("training_plans", "10"));
    expect(done.status).toBe("completed");
    expect(done.matchedWorkoutId).toBe(workoutUuid);
    expect(done.actualDistanceKm).toBe(27.6);
    expect(done.actualPace).toBe("6.62");

    const planned = mapPlanWorkout(
      { ...base, id: "78", status: "planned", matched_activity_id: null, actual_pace: null },
      USER,
      known,
    );
    expect(planned.status).toBe("pending");
    expect(planned.matchedWorkoutId).toBeNull();
    expect(planned.actualPace).toBeNull();

    // A matched activity that never made it into workouts must not dangle.
    const orphan = mapPlanWorkout({ ...base, id: "79", matched_activity_id: "999" }, USER, known);
    expect(orphan.matchedWorkoutId).toBeNull();
  });
});

describe("exercises", () => {
  it("renames the origin `exercise` column to exerciseKey", () => {
    const logRow = mapExerciseLog(
      { clerk_id: "u", date: "2026-08-20", exercise: "sentadillas", reps: "80" },
      USER,
    );
    expect(logRow.exerciseKey).toBe("sentadillas");
    expect(logRow.reps).toBe(80);
    expect(logRow.date).toBe("2026-08-20");

    const setRow = mapExerciseSet(
      {
        clerk_id: "u",
        date: "2026-08-20",
        exercise: "press_banca",
        set_number: "3",
        weight_kg: "57.5",
        reps: "8",
      },
      USER,
    );
    expect(setRow.exerciseKey).toBe("press_banca");
    expect(setRow.setNumber).toBe(3);
    expect(setRow.weightKg).toBe(57.5);
    expect(setRow.reps).toBe(8);
  });
});
