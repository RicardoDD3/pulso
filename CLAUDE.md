# Pulso — agent instructions

## Non-negotiable policy

**Every change ships with a test that covers it.**

- Bug fix → FIRST the failing regression test, THEN the fix.
- Feature → tests pinning behavior (pure functions, error branches, edges).
- Nothing is done with a red suite. Test counts only go up, never down.
- `npm run typecheck` must pass — jest uses SWC and does NOT check types.

## Architecture rules

- All business logic = pure functions in `lib/` with unit tests in
  `__tests__/` (mirrored tree). `lib/` never imports from `app/` or
  `components/`.
- ALL data access goes through `lib/db/repos/*` and requires a `Viewer`
  (`lib/authz/viewer.ts`). Write repos require an `OwnerViewer`. Route
  handlers never touch Drizzle directly.
- Zod at EVERY boundary: API input, webhooks, env, LLM output. LLM JSON is
  validated (with element caps) BEFORE touching the DB.
- Authorization lives in handlers (`resolveViewer()`), middleware is UX only.
- Never build absolute URLs from the request Host — use `APP_URL`.
- Canonical units: meters, seconds, °C, kg, ml, ms. Convert at ingestion,
  format at render.
- Nothing request-variable (timestamps with time, UUIDs, randoms) goes into
  LLM system prompts — they must be byte-identical within a (user, feature,
  day) memo window.
- Never log chat content, lab values or health metrics — ids and counts only.
- UI strings via next-intl (`messages/en.json` is source of truth; keep
  `es.json` complete).
- Features check `lib/system/features.ts`, never `process.env`.
- Open Wearables is consumed ONLY via `lib/ow/` (typed client). Features read
  canonical tables, never `lib/ow`.

## Commands

```bash
npm run dev            # needs: docker compose up -d postgres redis
npm test               # unit suite
npm run typecheck && npm run lint
npm run db:generate    # after editing lib/db/schema.ts
npx tsx scripts/seed-demo.ts   # demo user: demo@pulso.local / demo-pulso-1234
```
