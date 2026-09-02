/**
 * Live contract validation against a real Open Wearables instance
 * (spec doc 03: the client's Zod schemas are the ingestion contract — this
 * probe exercises every endpoint Pulso consumes and reports OK/contract-drift
 * per call).
 *
 * Usage:
 *   OW_URL=http://localhost:8000 OW_ADMIN_EMAIL=admin@admin.com \
 *   OW_ADMIN_PASSWORD=... npx tsx scripts/validate-ow.ts [--record]
 *
 * Bootstrap: logs in as the OW admin developer, creates (or reuses) an API
 * key, then drives lib/ow/client. --record dumps raw responses to
 * __tests__/fixtures/ow/recorded/ for refreshing the checked-in fixtures.
 */
try {
  process.loadEnvFile(".env");
} catch {
  /* env from shell */
}

import { mkdir, writeFile } from "node:fs/promises";

const OW_URL = (process.env.OW_URL ?? "http://localhost:8000").replace(/\/+$/, "");
const ADMIN_EMAIL = process.env.OW_ADMIN_EMAIL ?? "admin@admin.com";
const ADMIN_PASSWORD = process.env.OW_ADMIN_PASSWORD ?? "ow-admin-dev-1234";
const RECORD = process.argv.includes("--record");

async function bootstrapApiKey(): Promise<string> {
  const login = await fetch(`${OW_URL}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  if (!login.ok) {
    // Some builds accept JSON body instead of form data.
    const jsonLogin = await fetch(`${OW_URL}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    });
    if (!jsonLogin.ok) {
      throw new Error(`admin login failed: ${login.status}/${jsonLogin.status}`);
    }
    return extractKey(jsonLogin);
  }
  return extractKey(login);

  async function extractKey(res: Response): Promise<string> {
    const auth = (await res.json()) as { access_token?: string; token?: string };
    const jwt = auth.access_token ?? auth.token;
    if (!jwt) throw new Error("login response had no access_token");
    const headers = { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" };

    const listed = await fetch(`${OW_URL}/api/v1/api-keys`, { headers });
    if (listed.ok) {
      const keys = (await listed.json()) as Array<{ id?: string; name?: string }>;
      const existing = keys.find((k) => k.name === "pulso-validate");
      if (existing?.id) return existing.id;
    }
    const created = await fetch(`${OW_URL}/api/v1/api-keys`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "pulso-validate" }),
    });
    if (!created.ok) throw new Error(`api-key create failed: ${created.status} ${await created.text()}`);
    const key = (await created.json()) as { id?: string; key?: string; value?: string };
    const value = key.id ?? key.key ?? key.value;
    if (!value) throw new Error("api-key response had no id/key");
    return value;
  }
}

type Result = { step: string; ok: boolean; note: string };

async function main() {
  const results: Result[] = [];
  const record: Record<string, unknown> = {};

  const step = async (name: string, fn: () => Promise<unknown>) => {
    try {
      const value = await fn();
      record[name] = value;
      results.push({ step: name, ok: true, note: summarize(value) });
    } catch (err) {
      results.push({ step: name, ok: false, note: err instanceof Error ? err.message.slice(0, 200) : "unknown" });
    }
  };

  const apiKey = await bootstrapApiKey();
  // eslint-disable-next-line no-console
  console.log(`bootstrapped API key against ${OW_URL}`);

  process.env.OW_API_URL = OW_URL;
  process.env.OW_API_KEY = apiKey;
  const { OwClient } = await import("@/lib/ow/client");
  const ow = new OwClient({ baseUrl: OW_URL, apiKey });

  const externalId = `validate-${process.pid}`;
  let owUserId = "";
  const window = { start: new Date(Date.now() - 7 * 86_400_000), end: new Date() };

  await step("ensureUser", async () => {
    const user = await ow.ensureUser(externalId);
    owUserId = user.id;
    return user;
  });
  await step("ensureUser (idempotent)", async () => {
    const again = await ow.ensureUser(externalId);
    if (again.id !== owUserId) throw new Error("returned a different user on second call");
    return again;
  });
  await step("listConnections", () => ow.listConnections(owUserId));
  await step("getAuthorizationUrl(garmin)", () =>
    ow.getAuthorizationUrl(owUserId, "garmin", "http://localhost:3000/settings/wearables"),
  );
  await step("listWorkouts", () => ow.listWorkouts(owUserId, window));
  await step("listSleepSessions", () => ow.listSleepSessions(owUserId, window));
  await step("getDailySummaries(activity)", () => ow.getDailySummaries(owUserId, "activity", window));
  await step("getDailySummaries(sleep)", () => ow.getDailySummaries(owUserId, "sleep", window));
  await step("getDailySummaries(recovery)", () => ow.getDailySummaries(owUserId, "recovery", window));
  await step("getBodySummary", () => ow.getBodySummary(owUserId));
  await step("getTimeseries(heart_rate)", () => ow.getTimeseries(owUserId, ["heart_rate"], window, "raw"));
  await step("getHealthScores", () => ow.getHealthScores(owUserId, { window }));
  await step("listWebhookEndpoints", () => ow.listWebhookEndpoints());
  await step("registerWebhookEndpoint", () =>
    ow.registerWebhookEndpoint("http://host.docker.internal:3000/api/wearables/webhook"),
  );
  await step("deleteUser (cleanup)", async () => {
    await ow.deleteUser(owUserId);
    return { deleted: true };
  });

  if (RECORD) {
    await mkdir("__tests__/fixtures/ow/recorded", { recursive: true });
    await writeFile(
      "__tests__/fixtures/ow/recorded/live-responses.json",
      JSON.stringify(record, null, 2),
    );
    // eslint-disable-next-line no-console
    console.log("recorded → __tests__/fixtures/ow/recorded/live-responses.json");
  }

  // eslint-disable-next-line no-console
  console.table(results);
  const failed = results.filter((r) => !r.ok);
  // eslint-disable-next-line no-console
  console.log(failed.length === 0 ? "✅ all contract calls OK" : `❌ ${failed.length} contract drift(s)`);
  process.exit(failed.length === 0 ? 0 : 1);
}

function summarize(value: unknown): string {
  if (Array.isArray(value)) return `${value.length} items`;
  if (value && typeof value === "object") return Object.keys(value).slice(0, 4).join(",");
  return String(value).slice(0, 60);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("validate-ow failed:", err);
  process.exit(1);
});
