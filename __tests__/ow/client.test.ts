import { OwClient, OwContractError, OwHttpError } from "@/lib/ow/client";

// jsdom's AbortSignal may lack the static timeout() the client uses.
if (typeof AbortSignal.timeout !== "function") {
  (AbortSignal as unknown as { timeout: (ms: number) => AbortSignal }).timeout = () =>
    new AbortController().signal;
}

type RecordedCall = { url: URL; init: RequestInit };

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

/** Fetch stub that pops queued responses and records every call. */
function stubFetch(responses: ReturnType<typeof jsonResponse>[]) {
  const calls: RecordedCall[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: new URL(String(input)), init: init ?? {} });
    const next = responses.shift();
    if (!next) throw new Error("stubFetch: no response queued");
    return next;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

function makeClient(responses: ReturnType<typeof jsonResponse>[]) {
  const { impl, calls } = stubFetch(responses);
  const client = new OwClient({ baseUrl: "http://ow.test/", apiKey: "test-key", fetchImpl: impl });
  return { client, calls };
}

const OW_USER = "8b1f0f5e-3c2a-4b7d-9e1f-2a3b4c5d6e7f";

const emptyMeta = { resolution: null, sample_count: 0, start_time: null, end_time: null };

function workout(id: string) {
  return {
    id,
    type: "running",
    name: null,
    start_time: "2026-08-29T06:30:00Z",
    end_time: "2026-08-29T07:20:00Z",
    zone_offset: null,
    duration_seconds: 3000,
    source: { provider: "garmin", source: "garmin", device: null, device_type: null, device_name: null },
    calories_kcal: null,
    distance_meters: null,
    avg_heart_rate_bpm: null,
    max_heart_rate_bpm: null,
    avg_pace_sec_per_km: null,
    elevation_gain_meters: null,
  };
}

describe("OwClient", () => {
  it("sends the API key header and hits /api/v1 under the base URL", async () => {
    const { client, calls } = makeClient([jsonResponse([])]);
    await client.listConnections(OW_USER);
    expect(calls).toHaveLength(1);
    expect(calls[0].url.toString()).toBe(`http://ow.test/api/v1/users/${OW_USER}/connections`);
    expect((calls[0].init.headers as Record<string, string>)["X-Open-Wearables-API-Key"]).toBe(
      "test-key",
    );
  });

  it("paginates cursor-style list endpoints to exhaustion (Gotcha #17)", async () => {
    const page1 = {
      data: [workout("0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d")],
      pagination: { next_cursor: "cursor-2", previous_cursor: null, has_more: true, total_count: 2 },
      metadata: emptyMeta,
    };
    const page2 = {
      data: [workout("1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e")],
      pagination: { next_cursor: null, previous_cursor: "cursor-1", has_more: false, total_count: 2 },
      metadata: emptyMeta,
    };
    const { client, calls } = makeClient([jsonResponse(page1), jsonResponse(page2)]);

    const all = await client.listWorkouts(OW_USER, {
      start: "2026-08-01T00:00:00Z",
      end: "2026-08-31T00:00:00Z",
    });

    expect(all.map((w) => w.id)).toEqual([
      "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
      "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e",
    ]);
    expect(calls).toHaveLength(2);
    expect(calls[0].url.searchParams.get("cursor")).toBeNull();
    expect(calls[0].url.searchParams.get("start_date")).toBe("2026-08-01T00:00:00Z");
    expect(calls[1].url.searchParams.get("cursor")).toBe("cursor-2");
  });

  it("paginates health scores by offset to exhaustion", async () => {
    const score = {
      id: "4e5f6a7b-8c9d-4e0f-9a1b-2c3d4e5f6a7b",
      category: "sleep",
      value: 84,
      qualifier: null,
      recorded_at: "2026-08-29T06:15:00Z",
      zone_offset: null,
      components: null,
      data_source_id: null,
      provider: null,
      event_record_id: null,
    };
    const page = (hasMore: boolean) => ({
      data: [score],
      pagination: { next_cursor: null, previous_cursor: null, has_more: hasMore, total_count: 2 },
      metadata: emptyMeta,
    });
    const { client, calls } = makeClient([jsonResponse(page(true)), jsonResponse(page(false))]);

    const scores = await client.getHealthScores(OW_USER);
    expect(scores).toHaveLength(2);
    expect(calls[0].url.searchParams.get("offset")).toBe("0");
    expect(calls[1].url.searchParams.get("offset")).toBe("1");
  });

  it("repeats the types param for multi-series timeseries requests", async () => {
    const page = {
      data: [],
      pagination: { next_cursor: null, previous_cursor: null, has_more: false, total_count: 0 },
      metadata: emptyMeta,
    };
    const { client, calls } = makeClient([jsonResponse(page)]);
    await client.getTimeseries(
      OW_USER,
      ["heart_rate", "garmin_stress_level"],
      { start: "2026-08-29T00:00:00Z", end: "2026-08-30T00:00:00Z" },
      "1min",
    );
    expect(calls[0].url.searchParams.getAll("types")).toEqual(["heart_rate", "garmin_stress_level"]);
    expect(calls[0].url.searchParams.get("resolution")).toBe("1min");
  });

  it("throws OwContractError naming the endpoint — never the body — on drift", async () => {
    const { client } = makeClient([jsonResponse({ data: "SENSITIVE-VALUE", nope: true })]);
    let caught: unknown;
    try {
      await client.listWorkouts(OW_USER, { start: "2026-08-01", end: "2026-08-31" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(OwContractError);
    const message = (caught as Error).message;
    expect(message).toContain("GET /users/{id}/events/workouts");
    expect(message).not.toContain("SENSITIVE-VALUE");
  });

  it("throws OwHttpError with the status on non-2xx responses", async () => {
    const { client } = makeClient([jsonResponse({ detail: "boom" }, 503)]);
    await expect(client.listConnections(OW_USER)).rejects.toMatchObject({
      name: "OwHttpError",
      status: 503,
      endpoint: "GET /users/{id}/connections",
    });
  });

  it("ensureUser returns the existing OW user without creating a new one", async () => {
    const externalId = "1c9e8d7f-6b5a-4c3d-2e1f-0a9b8c7d6e5f";
    const existing = {
      id: OW_USER,
      created_at: "2026-08-01T12:00:00Z",
      external_user_id: externalId,
    };
    const { client, calls } = makeClient([
      jsonResponse({ items: [existing], total: 1, page: 1, limit: 100 }),
    ]);
    const user = await client.ensureUser(externalId);
    expect(user.id).toBe(OW_USER);
    expect(calls).toHaveLength(1);
  });

  it("ensureUser creates the OW user when missing", async () => {
    const externalId = "1c9e8d7f-6b5a-4c3d-2e1f-0a9b8c7d6e5f";
    const created = {
      id: OW_USER,
      created_at: "2026-08-01T12:00:00Z",
      external_user_id: externalId,
    };
    const { client, calls } = makeClient([
      jsonResponse({ items: [], total: 0, page: 1, limit: 100 }),
      jsonResponse(created, 201),
    ]);
    const user = await client.ensureUser(externalId);
    expect(user.id).toBe(OW_USER);
    expect(calls).toHaveLength(2);
    expect(calls[1].init.method).toBe("POST");
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ external_user_id: externalId });
  });

  it("registerWebhookEndpoint is idempotent on the URL", async () => {
    const endpoint = {
      id: "ep_1",
      url: "https://pulso.test/api/wearables/webhook",
      description: null,
      filter_types: null,
      user_id: null,
    };
    const { client, calls } = makeClient([jsonResponse([endpoint])]);
    const result = await client.registerWebhookEndpoint("https://pulso.test/api/wearables/webhook");
    expect(result.id).toBe("ep_1");
    expect(calls).toHaveLength(1); // list only, no POST

    const { client: client2, calls: calls2 } = makeClient([
      jsonResponse([]),
      jsonResponse(endpoint, 201),
    ]);
    const created = await client2.registerWebhookEndpoint("https://pulso.test/api/wearables/webhook");
    expect(created.id).toBe("ep_1");
    expect(calls2).toHaveLength(2);
    expect(calls2[1].init.method).toBe("POST");
  });
});
