## What

<!-- One-paragraph summary of the change. -->

## Checklist

- [ ] **Tests**: every change ships with a test that covers it (TDD policy).
- [ ] **Types**: `npm run typecheck` passes.
- [ ] **i18n**: no hardcoded UI strings — new strings added to `messages/en.json` (+ `es.json`).
- [ ] **Migration**: schema changes include a Drizzle migration and are forward-compatible within the minor.
- [ ] **No health data in logs**: log ids/counts only, never message content or lab/metric values.
- [ ] **Authz**: new data access goes through a Viewer-scoped repo.
