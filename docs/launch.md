# Launch post draft (Show HN / r/selfhosted / r/QuantifiedSelf)

> Publish when the doc-14 "ready to announce" gate passes: external Quick
> Start verification, two weeks of green nightly E2E, provider docs with
> screenshots, security self-audit clean.

---

**Title (HN):** Show HN: Pulso – self-hosted health & training intelligence
for any wearable

**Body:**

I built Pulso because my training data was scattered across vendor apps and
every "AI coach" product wanted my health data on their servers.

Pulso is an AGPL self-hosted app that:

- Ingests from any wearable (Garmin, Whoop, Oura, Polar, Suunto, Fitbit,
  Strava, Apple Health…) through Open Wearables
- Turns lab PDFs into structured, trend-able biomarkers with a vision LLM
- Generates periodized training plans — with an LLM or with a fully
  deterministic engine that needs **zero** API keys
- Has an AI coach that sees your complete health context (sleep, HRV,
  workouts, labs, strength) — bring your own key, or run it 100% local
  with Ollama
- Treats your data as yours: full ZIP export, hard-delete with DB-enforced
  cascade, zero telemetry

`docker compose --profile demo up` gives you a demo user with synthetic data
so you can click around before connecting anything.

Stack: Next.js + Postgres + Redis + BullMQ, AI SDK with pluggable providers.
~1000 unit tests, real-Postgres authz suite, Playwright E2E.

Not a medical device; AI extraction is always marked as verify-against-PDF.

Repo: https://github.com/RicardoDD3/pulso

---

**Checklist before posting**

- [ ] Replace `RicardoDD3` everywhere (README, compose, docs)
- [ ] Dashboard GIF recorded from the demo profile
- [ ] Provider screenshots in docs/providers.md
- [ ] `v1.0.0` tag + GHCR images published
- [ ] Post to awesome-selfhosted / awesome-quantified-self after launch
