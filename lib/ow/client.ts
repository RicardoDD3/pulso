/**
 * Typed Open Wearables API client (spec doc 03).
 *
 * The isolation contract: this module is the ONLY place Pulso talks to OW.
 * Features never import lib/ow — only ingestion workers do. Rules enforced
 * here:
 *
 * - every list endpoint paginates to exhaustion (never assume one page —
 *   the original's Gotcha #17);
 * - every response is parsed with the Zod contract schemas; a mismatch throws
 *   OwContractError naming the endpoint, never echoing the body (health data);
 * - every request times out via AbortSignal.timeout (30s default).
 *
 * Endpoint paths are grounded in the OW backend routers
 * (backend/app/api/routes/v1/*.py, mounted under /api/v1). Authentication is
 * the `X-Open-Wearables-API-Key` header (backend/app/services/api_key_service.py).
 */
import { z } from "zod";

import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import {
  owActivitySummariesPageSchema,
  owAuthorizationUrlSchema,
  owBodySummarySchema,
  owConnectionListSchema,
  owHealthScoresPageSchema,
  owRecoverySummariesPageSchema,
  owSleepSessionsPageSchema,
  owSleepSummariesPageSchema,
  owTimeseriesPageSchema,
  owUserListSchema,
  owUserSchema,
  owWebhookEndpointListSchema,
  owWebhookEndpointSchema,
  owWebhookEndpointSecretSchema,
  owWorkoutsPageSchema,
  type OwActivitySummary,
  type OwAuthorizationUrl,
  type OwBodySummary,
  type OwConnection,
  type OwHealthScore,
  type OwRecoverySummary,
  type OwSleepSession,
  type OwSleepSummary,
  type OwTimeSeriesSample,
  type OwUser,
  type OwWebhookEndpoint,
  type OwWorkout,
} from "@/lib/ow/schemas";

const DEFAULT_TIMEOUT_MS = 30_000;
/** Hard cap so a buggy cursor can never loop forever. */
const MAX_PAGES = 10_000;

export class OwError extends Error {}

/** OW answered with a non-2xx status. Carries status + endpoint, never the body. */
export class OwHttpError extends OwError {
  constructor(
    readonly endpoint: string,
    readonly status: number,
  ) {
    super(`OW request failed: ${endpoint} returned HTTP ${status}`);
    this.name = "OwHttpError";
  }
}

/**
 * OW answered 2xx but the body does not match the ingestion contract.
 * The message lists issue paths only — never raw body content (health data).
 */
export class OwContractError extends OwError {
  constructor(
    readonly endpoint: string,
    issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; code: string }>,
  ) {
    const paths = issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".") || "(root)"} [${i.code}]`)
      .join(", ");
    super(`OW contract violation on ${endpoint}: ${paths || "unknown issue"}`);
    this.name = "OwContractError";
  }
}

export type OwTimeWindow = { start: Date | string; end: Date | string };

export type OwResolution = "raw" | "1min" | "5min" | "15min" | "1hour";

type QueryValue = string | number | boolean | undefined | null | ReadonlyArray<string>;

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  query?: Record<string, QueryValue>;
  body?: unknown;
};

/** Minimal page shape the cursor paginator needs (structural subset). */
type OwPage<T> = {
  data: T[];
  pagination: { next_cursor?: string | null; has_more: boolean };
};

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

export interface OwClientOptions {
  baseUrl: string;
  apiKey: string;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class OwClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: OwClientOptions) {
    this.baseUrl = `${options.baseUrl.replace(/\/+$/, "")}/api/v1`;
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  // -------------------------------------------------------------------------
  // Users
  // -------------------------------------------------------------------------

  /**
   * Find the OW user for a Pulso user id, creating it if missing.
   * `external_user_id` carries the Pulso user id (doc 03: one OW user per
   * Pulso user, created lazily).
   */
  async ensureUser(externalUserId: string): Promise<OwUser> {
    const listed = this.parse(
      "GET /users",
      owUserListSchema,
      await this.request("GET /users", "/users", {
        query: { external_user_id: externalUserId, limit: 100 },
      }),
    );
    const existing = listed.items.find((u) => u.external_user_id === externalUserId);
    if (existing) return existing;
    return this.parse(
      "POST /users",
      owUserSchema,
      await this.request("POST /users", "/users", {
        method: "POST",
        body: { external_user_id: externalUserId },
      }),
    );
  }

  // -------------------------------------------------------------------------
  // Connections / OAuth
  // -------------------------------------------------------------------------

  /** GET /oauth/{provider}/authorize — URL to redirect the user to. */
  async getAuthorizationUrl(
    owUserId: string,
    provider: string,
    redirectUri?: string,
  ): Promise<OwAuthorizationUrl> {
    const endpoint = "GET /oauth/{provider}/authorize";
    return this.parse(
      endpoint,
      owAuthorizationUrlSchema,
      await this.request(endpoint, `/oauth/${encodeURIComponent(provider)}/authorize`, {
        query: { user_id: owUserId, redirect_uri: redirectUri },
      }),
    );
  }

  /** GET /users/{id}/connections — plain array, not paginated upstream. */
  async listConnections(owUserId: string): Promise<OwConnection[]> {
    const endpoint = "GET /users/{id}/connections";
    return this.parse(
      endpoint,
      owConnectionListSchema,
      await this.request(endpoint, `/users/${owUserId}/connections`),
    );
  }

  /** DELETE /users/{id}/connections/{provider} — revoke, keep data. */
  async disconnect(owUserId: string, provider: string): Promise<void> {
    await this.request(
      "DELETE /users/{id}/connections/{provider}",
      `/users/${owUserId}/connections/${encodeURIComponent(provider)}`,
      { method: "DELETE" },
    );
  }

  /** DELETE /users/{id}/connections/{provider}/data — purge data + revoke. */
  async deleteProviderData(owUserId: string, provider: string): Promise<void> {
    await this.request(
      "DELETE /users/{id}/connections/{provider}/data",
      `/users/${owUserId}/connections/${encodeURIComponent(provider)}/data`,
      { method: "DELETE" },
    );
  }

  // -------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------

  /** GET /users/{id}/events/workouts over a time window, all pages. */
  async listWorkouts(owUserId: string, window: OwTimeWindow): Promise<OwWorkout[]> {
    return this.paginateCursor(
      "GET /users/{id}/events/workouts",
      `/users/${owUserId}/events/workouts`,
      { start_date: toIso(window.start), end_date: toIso(window.end), limit: 100 },
      owWorkoutsPageSchema,
    );
  }

  /** GET /users/{id}/events/sleep over a time window, all pages. */
  async listSleepSessions(owUserId: string, window: OwTimeWindow): Promise<OwSleepSession[]> {
    return this.paginateCursor(
      "GET /users/{id}/events/sleep",
      `/users/${owUserId}/events/sleep`,
      { start_date: toIso(window.start), end_date: toIso(window.end), limit: 100 },
      owSleepSessionsPageSchema,
    );
  }

  // -------------------------------------------------------------------------
  // Timeseries
  // -------------------------------------------------------------------------

  /** GET /users/{id}/timeseries for one or more SeriesType slugs, all pages. */
  async getTimeseries(
    owUserId: string,
    seriesTypes: ReadonlyArray<string>,
    window: OwTimeWindow,
    resolution: OwResolution = "raw",
  ): Promise<OwTimeSeriesSample[]> {
    return this.paginateCursor(
      "GET /users/{id}/timeseries",
      `/users/${owUserId}/timeseries`,
      {
        start_time: toIso(window.start),
        end_time: toIso(window.end),
        types: seriesTypes,
        resolution,
        limit: 100,
      },
      owTimeseriesPageSchema,
    );
  }

  // -------------------------------------------------------------------------
  // Daily summaries
  // -------------------------------------------------------------------------

  async getDailySummaries(
    owUserId: string,
    kind: "activity",
    window: OwTimeWindow,
  ): Promise<OwActivitySummary[]>;
  async getDailySummaries(
    owUserId: string,
    kind: "sleep",
    window: OwTimeWindow,
  ): Promise<OwSleepSummary[]>;
  async getDailySummaries(
    owUserId: string,
    kind: "recovery",
    window: OwTimeWindow,
  ): Promise<OwRecoverySummary[]>;
  async getDailySummaries(
    owUserId: string,
    kind: "activity" | "sleep" | "recovery",
    window: OwTimeWindow,
  ): Promise<OwActivitySummary[] | OwSleepSummary[] | OwRecoverySummary[]> {
    const endpoint = `GET /users/{id}/summaries/${kind}`;
    const path = `/users/${owUserId}/summaries/${kind}`;
    const query = { start_date: toIso(window.start), end_date: toIso(window.end), limit: 100 };
    switch (kind) {
      case "activity":
        return this.paginateCursor(endpoint, path, query, owActivitySummariesPageSchema);
      case "sleep":
        return this.paginateCursor(endpoint, path, query, owSleepSummariesPageSchema);
      case "recovery":
        return this.paginateCursor(endpoint, path, query, owRecoverySummariesPageSchema);
    }
  }

  /** GET /users/{id}/summaries/body — single snapshot object, null when empty. */
  async getBodySummary(owUserId: string): Promise<OwBodySummary | null> {
    const endpoint = "GET /users/{id}/summaries/body";
    const raw = await this.request(endpoint, `/users/${owUserId}/summaries/body`);
    if (raw === null || raw === undefined) return null;
    return this.parse(endpoint, owBodySummarySchema, raw);
  }

  // -------------------------------------------------------------------------
  // Health scores
  // -------------------------------------------------------------------------

  /** GET /users/{id}/health-scores — offset-paginated upstream; fetches all pages. */
  async getHealthScores(
    owUserId: string,
    options: { window?: OwTimeWindow; category?: string; provider?: string } = {},
  ): Promise<OwHealthScore[]> {
    const endpoint = "GET /users/{id}/health-scores";
    const out: OwHealthScore[] = [];
    let offset = 0;
    for (let page = 0; page < MAX_PAGES; page++) {
      const parsed = this.parse(
        endpoint,
        owHealthScoresPageSchema,
        await this.request(endpoint, `/users/${owUserId}/health-scores`, {
          query: {
            start_date: options.window ? toIso(options.window.start) : undefined,
            end_date: options.window ? toIso(options.window.end) : undefined,
            category: options.category,
            provider: options.provider,
            limit: 1000,
            offset,
          },
        }),
      );
      out.push(...parsed.data);
      if (!parsed.pagination.has_more || parsed.data.length === 0) return out;
      offset += parsed.data.length;
    }
    throw new OwError(`${endpoint}: pagination exceeded ${MAX_PAGES} pages`);
  }

  // -------------------------------------------------------------------------
  // Outgoing webhooks
  // -------------------------------------------------------------------------

  /** GET /webhooks/endpoints — all endpoints registered by this API key's developer. */
  async listWebhookEndpoints(): Promise<OwWebhookEndpoint[]> {
    const endpoint = "GET /webhooks/endpoints";
    return this.parse(
      endpoint,
      owWebhookEndpointListSchema,
      await this.request(endpoint, "/webhooks/endpoints"),
    );
  }

  /**
   * Idempotently register `url` as a webhook endpoint: returns the existing
   * endpoint when one with the same URL is already registered (pulso-web calls
   * this on every boot — doc 03).
   */
  async registerWebhookEndpoint(
    url: string,
    options: { description?: string; filterTypes?: ReadonlyArray<string> } = {},
  ): Promise<OwWebhookEndpoint> {
    const existing = (await this.listWebhookEndpoints()).find((ep) => ep.url === url);
    if (existing) return existing;
    const endpoint = "POST /webhooks/endpoints";
    return this.parse(
      endpoint,
      owWebhookEndpointSchema,
      await this.request(endpoint, "/webhooks/endpoints", {
        method: "POST",
        body: {
          url,
          description: options.description,
          filter_types: options.filterTypes ? [...options.filterTypes] : undefined,
        },
      }),
    );
  }

  /** GET /webhooks/endpoints/{id}/secret — the signing secret (whsec_…). */
  async getWebhookEndpointSecret(endpointId: string): Promise<string> {
    const endpoint = "GET /webhooks/endpoints/{id}/secret";
    const parsed = this.parse(
      endpoint,
      owWebhookEndpointSecretSchema,
      await this.request(endpoint, `/webhooks/endpoints/${encodeURIComponent(endpointId)}/secret`),
    );
    return parsed.key;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async paginateCursor<T>(
    endpoint: string,
    path: string,
    query: Record<string, QueryValue>,
    pageSchema: z.ZodType<OwPage<T>>,
  ): Promise<T[]> {
    const out: T[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const parsed = this.parse(
        endpoint,
        pageSchema,
        await this.request(endpoint, path, { query: { ...query, cursor } }),
      );
      out.push(...parsed.data);
      const next = parsed.pagination.next_cursor;
      if (!parsed.pagination.has_more || !next) return out;
      cursor = next;
    }
    throw new OwError(`${endpoint}: pagination exceeded ${MAX_PAGES} pages`);
  }

  private parse<T>(endpoint: string, schema: z.ZodType<T>, raw: unknown): T {
    const result = schema.safeParse(raw);
    if (!result.success) {
      logger.warn({ endpoint, issueCount: result.error.issues.length }, "ow contract violation");
      throw new OwContractError(endpoint, result.error.issues);
    }
    return result.data;
  }

  private async request(
    endpoint: string,
    path: string,
    options: RequestOptions = {},
  ): Promise<unknown> {
    const url = new URL(this.baseUrl + path);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) {
        for (const v of value) url.searchParams.append(key, v);
      } else {
        url.searchParams.set(key, String(value));
      }
    }
    const method = options.method ?? "GET";
    let res: Response;
    try {
      res = await this.fetchImpl(url.toString(), {
        method,
        headers: {
          "X-Open-Wearables-API-Key": this.apiKey,
          Accept: "application/json",
          ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      logger.warn({ endpoint }, "ow request failed before response");
      throw new OwError(
        `OW request failed: ${endpoint} (${err instanceof Error ? err.name : "unknown error"})`,
      );
    }
    if (!res.ok) {
      logger.warn({ endpoint, status: res.status }, "ow request returned error status");
      throw new OwHttpError(endpoint, res.status);
    }
    if (res.status === 204) return null;
    return res.json();
  }
}

let cached: OwClient | null = null;

/**
 * The app-wide OW client, built from env (OW_API_URL + OW_API_KEY).
 * Throws when OW is not configured — callers gate on the wearables feature
 * flag before reaching here.
 */
export function getOwClient(): OwClient {
  if (cached) return cached;
  const env = getEnv();
  if (!env.OW_API_URL || !env.OW_API_KEY) {
    throw new OwError("Open Wearables is not configured (OW_API_URL / OW_API_KEY missing)");
  }
  cached = new OwClient({ baseUrl: env.OW_API_URL, apiKey: env.OW_API_KEY });
  return cached;
}

/** Test-only escape hatch. */
export function __resetOwClientCache(): void {
  cached = null;
}
