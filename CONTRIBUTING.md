# Contributing to Pulso

Thanks for helping! Goal: a contributor goes from clone to running app in
**under 10 minutes**.

## Dev setup

```bash
git clone https://github.com/RicardoDD3/pulso && cd pulso
npm install
cp .env.example .env                    # set AUTH_SECRET
docker compose up -d postgres redis     # only the data services
npm run db:migrate
npm run dev                             # http://localhost:3000
```

Run the full stack (incl. Open Wearables) with `docker compose up -d`, or the
demo with `docker compose --profile demo up -d`.

## Tests — the non-negotiable policy

**Every change ships with a test that covers it.**

- Bug fix → first the failing test that reproduces it, then the fix.
- Feature → tests that pin the behavior (pure functions, error branches, edge
  cases) before or together with the implementation.
- Nothing is "done" with a red suite. CI enforces this.

```bash
npm test                # unit (Jest + jsdom)
npm run test:coverage   # coverage (80% threshold on lib/)
npm run typecheck       # tsc --noEmit (jest uses SWC and does NOT type-check)
npm run lint
```

Business logic lives as **pure functions in `lib/`** with unit tests in
`__tests__/` mirroring the source tree. `lib/` never imports from `app/` or
`components/`.

## Architecture ground rules

- All data access goes through `lib/db/repos/*` and requires a `Viewer`
  (`lib/authz/viewer.ts`). Route handlers never query the ORM directly.
- Zod validation at EVERY boundary: API input, webhooks, env, LLM output.
- Never build absolute URLs from the request Host — use `APP_URL`.
- Canonical units everywhere: meters, seconds, °C, kg, ml, ms. Convert on
  ingestion, format on render.
- UI strings go through next-intl (`en` is the source of truth, `es` complete).

## Good first contributions

- **Add an LLM provider**: register it in `lib/llm/registry.ts` and
  `lib/llm/providers.ts` — no new routes needed.
- **Verify a wearable**: connect a provider through Open Wearables, compare
  the dashboard against the vendor app, and report/fix mapping gaps.

## Commits

Conventional Commits (`feat:`, `fix:`, `docs:`…) — releases and CHANGELOG are
automated from them.
