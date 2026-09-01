/**
 * Demo seed (spec doc 00): creates demo@pulso.local with 90 days of synthetic
 * health data, workouts with laps/zones, body composition, intraday samples,
 * lab sessions and exercise logs — so the app is explorable with no wearable
 * and no LLM keys. Deterministic (seeded PRNG): re-running upserts the same
 * data. Run: `npm run seed:demo` (or the compose demo profile).
 */
// Load .env when run outside Next (tsx CLI); no-op if the file is absent.
try {
  process.loadEnvFile(".env");
} catch {
  /* env comes from the environment (compose) */
}

import { getDb, schema } from "@/lib/db";
import { logger } from "@/lib/logger";

const DEMO_EMAIL = "demo@pulso.local";
const DEMO_PASSWORD = "demo-pulso-1234";
const PROVIDER = "demo";
const DAYS = 90;

/** Deterministic LCG so the demo data is stable across runs. */
function makeRng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function ensureDemoUser(): Promise<string> {
  const db = getDb();
  const { eq } = await import("drizzle-orm");
  const [existing] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, DEMO_EMAIL))
    .limit(1);
  if (existing) return existing.id;

  const { auth } = await import("@/lib/auth");
  const result = await auth.api.signUpEmail({
    body: { name: "Demo Athlete", email: DEMO_EMAIL, password: DEMO_PASSWORD },
  });
  const userId = result.user.id;
  await db
    .insert(schema.profiles)
    .values({ userId, displayName: "Demo Athlete", timezone: "America/Mexico_City", maxHr: 190 })
    .onConflictDoUpdate({
      target: [schema.profiles.userId],
      set: { displayName: "Demo Athlete", maxHr: 190 },
    });
  return userId;
}

async function seed() {
  const userId = await ensureDemoUser();
  const db = getDb();
  const rng = makeRng(20260901);
  const today = new Date();
  today.setUTCHours(12, 0, 0, 0);

  let workoutCount = 0;
  for (let i = DAYS - 1; i >= 0; i--) {
    const day = new Date(today.getTime() - i * 86_400_000);
    const date = isoDay(day);
    const fatigue = Math.sin(i / 9) * 0.5 + 0.5; // slow training-cycle wave

    // --- health day ---
    const steps = Math.round(7000 + rng() * 9000);
    await db
      .insert(schema.healthDays)
      .values({
        userId,
        date,
        provider: PROVIDER,
        steps,
        floors: Math.round(rng() * 18),
        intensityMinutes: Math.round(20 + rng() * 90),
        distanceM: Math.round(steps * 0.75),
        caloriesTotal: Math.round(2100 + rng() * 900),
        caloriesActive: Math.round(400 + rng() * 700),
        restingHr: Math.round(46 + fatigue * 8 + rng() * 3),
        hrMin: 42,
        hrMax: Math.round(150 + rng() * 35),
        stressAvg: Math.round(20 + fatigue * 25 + rng() * 10),
        stressMax: Math.round(70 + rng() * 25),
        bodyBatteryHigh: Math.round(75 + (1 - fatigue) * 20 + rng() * 5),
        bodyBatteryLow: Math.round(15 + rng() * 20),
        spo2Avg: Math.round((95 + rng() * 3) * 10) / 10,
        respirationAvg: Math.round((13 + rng() * 3) * 10) / 10,
        hrvMs: Math.round(55 + (1 - fatigue) * 25 + rng() * 8),
        hrvStatus: fatigue > 0.7 ? "UNBALANCED" : "BALANCED",
        hydrationMl: null,
        raw: null,
      })
      .onConflictDoNothing();

    // --- sleep ---
    const totalMin = Math.round(390 + rng() * 120);
    const deep = Math.round(totalMin * (0.15 + rng() * 0.08));
    const rem = Math.round(totalMin * (0.18 + rng() * 0.08));
    const awake = Math.round(rng() * 35);
    const end = new Date(`${date}T06:30:00-06:00`);
    await db
      .insert(schema.sleepSessions)
      .values({
        userId,
        provider: PROVIDER,
        externalId: `sleep-${date}`,
        startAt: new Date(end.getTime() - (totalMin + awake) * 60_000),
        endAt: end,
        totalMin,
        inBedMin: totalMin + awake,
        efficiency: Math.round((totalMin / (totalMin + awake)) * 100),
        deepMin: deep,
        lightMin: totalMin - deep - rem,
        remMin: rem,
        awakeMin: awake,
        score: Math.round(60 + (1 - fatigue) * 30 + rng() * 8),
        isNap: false,
        raw: null,
      })
      .onConflictDoNothing();

    // --- workouts: ~4 runs/week, one long run ---
    const dow = day.getUTCDay();
    if ([1, 3, 5, 6].includes(dow)) {
      const isLong = dow === 6;
      const km = isLong ? 16 + rng() * 12 : 6 + rng() * 6;
      const paceSecPerKm = 315 + fatigue * 40 + rng() * 25;
      const durationS = Math.round(km * paceSecPerKm);
      const hrAvg = Math.round(138 + fatigue * 15 + rng() * 8);
      const startAt = new Date(`${date}T07:00:00-06:00`);
      const [w] = await db
        .insert(schema.workouts)
        .values({
          userId,
          provider: PROVIDER,
          externalId: `run-${date}`,
          sport: "running",
          name: isLong ? "Long Run" : "Morning Run",
          startAt,
          durationS,
          movingS: Math.round(durationS * 0.97),
          distanceM: Math.round(km * 1000),
          calories: Math.round(km * 62),
          hrAvg,
          hrMax: Math.min(hrAvg + 25 + Math.round(rng() * 12), 188),
          hrMin: 95,
          elevationGainM: Math.round(km * (8 + rng() * 18)),
          elevationLossM: Math.round(km * (8 + rng() * 18)),
          cadenceAvg: Math.round(168 + rng() * 12),
          speedAvgMps: 1000 / paceSecPerKm,
          speedMaxMps: 1000 / (paceSecPerKm - 60),
          raw: null,
        })
        .onConflictDoNothing()
        .returning({ id: schema.workouts.id });
      if (w) {
        workoutCount++;
        const lapCount = Math.floor(km);
        for (let lap = 0; lap < lapCount; lap++) {
          await db
            .insert(schema.workoutLaps)
            .values({
              workoutId: w.id,
              kind: "lap",
              lapIndex: lap + 1,
              startAt: new Date(startAt.getTime() + lap * paceSecPerKm * 1000),
              durationS: Math.round(paceSecPerKm * (0.95 + rng() * 0.1)),
              distanceM: 1000,
              hrAvg: Math.round(hrAvg * (0.94 + (lap / lapCount) * 0.1)),
              hrMax: hrAvg + 20,
              cadenceAvg: Math.round(168 + rng() * 10),
              speedAvgMps: 1000 / paceSecPerKm,
            })
            .onConflictDoNothing();
        }
        const zones = [0.05, 0.25, 0.4, 0.25, 0.05];
        for (let z = 0; z < 5; z++) {
          await db
            .insert(schema.workoutHrZones)
            .values({ workoutId: w.id, zone: z + 1, seconds: Math.round(durationS * zones[z]) })
            .onConflictDoNothing();
        }
      }
    }

    // --- body composition: weekly ---
    if (dow === 0) {
      await db
        .insert(schema.bodyMeasurements)
        .values({
          userId,
          provider: PROVIDER,
          measuredAt: new Date(`${date}T07:10:00-06:00`),
          weightKg: Math.round((71 - (DAYS - i) * 0.012 + rng() * 0.6) * 10) / 10,
          bmi: Math.round((22.5 + rng() * 0.4) * 10) / 10,
          bodyFatPct: Math.round((16.5 - (DAYS - i) * 0.008 + rng() * 0.5) * 10) / 10,
          muscleMassKg: Math.round((33 + rng() * 0.5) * 10) / 10,
          bodyWaterPct: Math.round((57 + rng()) * 10) / 10,
          boneMassKg: 3.2,
          raw: null,
        })
        .onConflictDoNothing();
    }

    // --- provider scores (OW-style sleep score) ---
    await db
      .insert(schema.providerScores)
      .values({
        userId,
        date,
        provider: "ow",
        scores: {
          sleep_quality: { value: Math.round(60 + (1 - fatigue) * 30 + rng() * 8), qualifier: null },
        },
      })
      .onConflictDoNothing();

    // --- intraday samples: last 7 days only ---
    if (i < 7) {
      const samples: (typeof schema.metricSamples.$inferInsert)[] = [];
      for (let minute = 0; minute < 24 * 60; minute += 10) {
        const at = new Date(`${date}T00:00:00-06:00`);
        at.setMinutes(at.getMinutes() + minute);
        const hour = minute / 60;
        const awakeFactor = hour > 6.5 && hour < 23 ? 1 : 0.75;
        samples.push({
          userId,
          metric: "hr",
          recordedAt: at,
          value: Math.round((52 + 20 * awakeFactor + rng() * 12) * awakeFactor),
          provider: PROVIDER,
        });
        samples.push({
          userId,
          metric: "stress",
          recordedAt: at,
          value: Math.round(hour > 7 && hour < 22 ? 25 + rng() * 40 : 8 + rng() * 12),
          provider: PROVIDER,
        });
        samples.push({
          userId,
          metric: "body_battery",
          recordedAt: at,
          value: Math.round(
            hour < 7 ? 60 + hour * 5 : Math.max(15, 95 - (hour - 7) * 5 + rng() * 6),
          ),
          provider: PROVIDER,
        });
      }
      await db.insert(schema.metricSamples).values(samples).onConflictDoNothing();
    }
  }

  // --- exercises ---
  const defaults = (await import("@/lib/exercises/defaults")).DEFAULT_EXERCISES;
  await db
    .insert(schema.exerciseDefinitions)
    .values(defaults.map((ex) => ({ userId, ...ex, isActive: true })))
    .onConflictDoNothing();
  for (let i = 0; i < 30; i += 2) {
    const date = isoDay(new Date(today.getTime() - i * 86_400_000));
    await db
      .insert(schema.exerciseLogs)
      .values({ userId, date, exerciseKey: "sentadillas", reps: 40 + Math.round(rng() * 40) })
      .onConflictDoNothing();
    for (let set = 1; set <= 3; set++) {
      await db
        .insert(schema.exerciseSets)
        .values({
          userId,
          date,
          exerciseKey: "press_banca",
          setNumber: set,
          weightKg: 55 + Math.round(rng() * 3) * 2.5,
          reps: 8,
        })
        .onConflictDoNothing();
    }
  }

  // --- labs: two sessions, 3 months apart ---
  const labDates = [isoDay(new Date(today.getTime() - 80 * 86_400_000)), isoDay(new Date(today.getTime() - 10 * 86_400_000))];
  for (const [idx, sampleDate] of labDates.entries()) {
    const [session] = await db
      .insert(schema.labSessions)
      .values({
        userId,
        sampleDate,
        labName: "Demo Lab",
        labLocation: "Demo City",
        status: "completed",
        extractionModel: "seed",
      })
      .returning({ id: schema.labSessions.id });
    const glucose = idx === 0 ? 96 : 89;
    const ldl = idx === 0 ? 138 : 118;
    await db.insert(schema.labResults).values([
      { sessionId: session.id, userId, category: "GM", testName: "Glucosa", testNameNormalized: "glucose", valueNum: glucose, unit: "mg/dL", refLow: 70, refHigh: 100, isFlagged: false },
      { sessionId: session.id, userId, category: "PL", testName: "Colesterol LDL", testNameNormalized: "ldl", valueNum: ldl, unit: "mg/dL", refLow: 0, refHigh: 130, isFlagged: ldl > 130 },
      { sessionId: session.id, userId, category: "PL", testName: "Colesterol HDL", testNameNormalized: "hdl", valueNum: 52 + idx * 4, unit: "mg/dL", refLow: 40, refHigh: 100, isFlagged: false },
      { sessionId: session.id, userId, category: "VIT", testName: "Vitamina D", testNameNormalized: "vitamin_d", valueNum: idx === 0 ? 24 : 33, unit: "ng/mL", refLow: 30, refHigh: 100, isFlagged: idx === 0 },
      { sessionId: session.id, userId, category: "TIR", testName: "TSH", testNameNormalized: "tsh", valueNum: 2.1, unit: "µIU/mL", refLow: 0.4, refHigh: 4.5, isFlagged: false },
    ]);
  }

  logger.info({ workoutCount }, "demo_seed_completed");
  // eslint-disable-next-line no-console
  console.log(`Demo user ready: ${DEMO_EMAIL} / ${DEMO_PASSWORD} (${workoutCount} workouts)`);
  process.exit(0);
}

seed().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("seed failed:", err);
  process.exit(1);
});
