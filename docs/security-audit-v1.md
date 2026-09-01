# Security self-audit — v1.0 checklist

Standing checklist derived from the design-time audit of the original app
(spec doc 11). Each item lists its enforcement point and evidence. Re-run
before every minor release; findings enter with a regression test.

## High

| # | Requirement | Enforcement | Evidence |
|---|---|---|---|
| A1 | User isolation without a safety net | Repo layer requires `Viewer`; `user_id` applied in ONE place per repo; DB unreachable from outside the compose network; no publishable keys exist | `lib/db/repos/*` (grep: every function takes Viewer); E2E: foreign `viewAs` without grant → 404 |
| A2 | Authorization in handlers, not middleware | Every route starts with `resolveViewer()`; middleware only redirects | `middleware.ts` comment + route files; unauthenticated API → 401 JSON (verified E2E) |
| A3 | No session forwarding to Host-derived URLs | No internal HTTP between features — LLM calls are function calls; absolute URLs only from `APP_URL` | `lib/llm/index.ts`; grep `request.url` used only for query parsing |
| A4 | No path injection | Zod on every body/query/param; ids validated as UUID | route files (`z.uuid()`) |

## Medium

| # | Requirement | Enforcement |
|---|---|---|
| M1 | No mass assignment | All updates use Zod allowlist schemas (`.partial()` of explicit fields) |
| M2 | No health data in logs | pino redaction + logging policy; log ids/counts only |
| M3 | Error envelope | `withApi` catches → `{error:{code,message}}` catalog; detail server-side only |
| M4 | Transactions on multi-table writes | labs completeSession, saveExchange, deleteProviderRows use `db.transaction` |
| M5 | LLM output validated before DB | `generateJson` + Zod schemas with element caps (labs ≤300) |
| M6 | Size limits before writes | chat 32KB, labs 15MB + magic bytes, FIT 25MB |
| M7 | Prompt injection containment | Planner actions = Zod discriminated-union allowlist; unknown → answer; chats owner-only; grants read-only |

## New-surface threats

| Threat | Mitigation | Evidence |
|---|---|---|
| Forged OW webhook | Signature verification + job re-pulls from API | `lib/ow/webhook.ts` tests (tampered payload fails) |
| Malicious FIT | 25MB cap, defensive per-record parsing | `lib/fit/parse.ts` tests |
| Malicious PDF | Magic bytes + size cap; PDF only goes to the LLM provider | `app/api/labs/upload/route.ts` |
| LLM cost abuse | Per-user daily token quota (429) + per-endpoint rate limits | `lib/llm/usage.ts`, `lib/authz/rate-limit.ts` |
| Open registration | `SIGNUPS_DISABLED`, email verification flag, 2FA plugin | `lib/auth.ts` |
| TLS misconfig by self-hosters | Reverse-proxy docs with Caddy example | `docs/deploy-vps.md` |

## Process

- Private vulnerability reporting via GitHub advisories (SECURITY.md), 72h SLA.
- CI: CodeQL + npm audit (high) + gitleaks on every PR.
- Every security fix lands with its regression test.

## Open items for the v1.0 gate

- [ ] External Quick Start verification on a clean machine
- [ ] Repo/authz test suite against a throwaway Postgres in CI (testcontainers job)
- [ ] Rate limits verified under load (k6 or similar, manual)
- [ ] Dependency review of the OW image digests pinned in compose
