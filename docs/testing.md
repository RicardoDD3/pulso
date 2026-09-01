# Testing policy

**Every change ships with a test that covers it. Not optional.**

- Bug fix → first the failing test that reproduces it (red), then the fix
  (green). Never a fix without a regression test.
- Feature → tests that pin the behavior (pure functions, error branches, edge
  cases) before or together with the implementation.
- Nothing is "done" with a red suite. CI enforces it.
- Test counts only go up. Never down.

## Pyramid

1. **Unit (Jest + jsdom)** — the bulk. `__tests__/` mirrors `lib/` and
   `components/`. Business logic lives as pure functions in `lib/` precisely
   so it's cheap to test.
2. **Repo/authz tests** — for each repo: a foreign viewer without a grant
   reads nothing (404); with a grant only its scopes; no write repo accepts a
   grant viewer; user-deletion cascade leaves zero orphans.
3. **Ingestion contract tests** — recorded OW response fixtures
   (`__tests__/fixtures/ow/`) validated against the Zod ingestion schemas: if
   OW changes shape on a version bump, it breaks HERE, not in production.
   Same for FIT: small real files as parser fixtures.
4. **E2E (Playwright)** — few and fat, over `docker compose` with the demo
   seed. Nightly and on release.

## Commands

```bash
npm test                 # unit suite
npm run test:coverage    # with coverage (80% threshold on lib/)
npm run typecheck        # tsc --noEmit — jest uses SWC and does NOT type-check
npm run lint
```

## LLM mocking

`LLM_MOCK=1` activates the fixture provider in `lib/llm/mock.ts` — CI never
hits real providers. Live cache-hit probes (scripts/) are manual verification.
