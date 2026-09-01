/**
 * OW ingestion contract tests (spec doc 03): the recorded fixtures must parse
 * against the Zod schemas in lib/ow/schemas. When OW's image digest is bumped,
 * these fixtures are re-recorded and this suite is the gate.
 */
import {
  owActivitySummariesPageSchema,
  owBodySummarySchema,
  owConnectionListSchema,
  owHealthScoresPageSchema,
  owRecoverySummariesPageSchema,
  owSleepSessionsPageSchema,
  owSleepSummariesPageSchema,
  owTimeseriesPageSchema,
  owUserListSchema,
  owUserSchema,
  owWebhookConnectionDataSchema,
  owWebhookEnvelopeSchema,
  owWebhookSleepDataSchema,
  owWebhookSyncDataSchema,
  owWebhookTimeseriesDataSchema,
  owWebhookWorkoutDataSchema,
  owWorkoutsPageSchema,
} from "@/lib/ow/schemas";

import connectionsFixture from "../fixtures/ow/connections.json";
import summariesFixture from "../fixtures/ow/daily-summaries.json";
import sleepFixture from "../fixtures/ow/events-sleep.json";
import workoutsFixture from "../fixtures/ow/events-workout.json";
import scoresFixture from "../fixtures/ow/health-scores.json";
import timeseriesFixture from "../fixtures/ow/timeseries.json";
import userFixture from "../fixtures/ow/user.json";
import webhookFixture from "../fixtures/ow/webhook-event.json";

function expectParses(schema: { safeParse: (v: unknown) => { success: boolean; error?: unknown } }, value: unknown) {
  const result = schema.safeParse(value);
  if (!result.success) {
    // Surface the zod issues in the test failure output.
    expect(result.error).toBeUndefined();
  }
  expect(result.success).toBe(true);
}

describe("OW fixtures parse against the contract schemas", () => {
  it("users (list + created)", () => {
    expectParses(owUserListSchema, userFixture.list);
    expectParses(owUserSchema, userFixture.created);
  });

  it("connections", () => {
    expectParses(owConnectionListSchema, connectionsFixture);
  });

  it("workout events page", () => {
    expectParses(owWorkoutsPageSchema, workoutsFixture);
  });

  it("sleep events page", () => {
    expectParses(owSleepSessionsPageSchema, sleepFixture);
  });

  it("timeseries page", () => {
    expectParses(owTimeseriesPageSchema, timeseriesFixture);
  });

  it("daily summaries (activity, sleep, recovery, body)", () => {
    expectParses(owActivitySummariesPageSchema, summariesFixture.activity);
    expectParses(owSleepSummariesPageSchema, summariesFixture.sleep);
    expectParses(owRecoverySummariesPageSchema, summariesFixture.recovery);
    expectParses(owBodySummarySchema, summariesFixture.body);
  });

  it("health scores page", () => {
    expectParses(owHealthScoresPageSchema, scoresFixture);
  });

  it("webhook envelopes and typed payloads", () => {
    for (const envelope of Object.values(webhookFixture)) {
      expectParses(owWebhookEnvelopeSchema, envelope);
    }
    expectParses(owWebhookWorkoutDataSchema, webhookFixture.workout.data);
    expectParses(owWebhookSleepDataSchema, webhookFixture.sleep.data);
    expectParses(owWebhookConnectionDataSchema, webhookFixture.connection.data);
    expectParses(owWebhookTimeseriesDataSchema, webhookFixture.timeseries.data);
    expectParses(owWebhookSyncDataSchema, webhookFixture.sync.data);
  });

  it("rejects a workout page whose shape drifted", () => {
    const drifted = JSON.parse(JSON.stringify(workoutsFixture)) as {
      data: Array<Record<string, unknown>>;
    };
    drifted.data[0].start_time = 1756449000; // epoch instead of ISO string
    expect(owWorkoutsPageSchema.safeParse(drifted).success).toBe(false);
  });

  it("tolerates unknown extra fields (OW is pre-1.0)", () => {
    const extended = JSON.parse(JSON.stringify(workoutsFixture)) as {
      data: Array<Record<string, unknown>>;
    };
    extended.data[0].brand_new_field = { anything: true };
    expect(owWorkoutsPageSchema.safeParse(extended).success).toBe(true);
  });
});
