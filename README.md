# Pulso

**Open source, self-hosted health & training intelligence** for endurance
athletes and quantified-self people. Connect any wearable, upload your lab
work, and get dashboards, periodized training plans and an AI coach that knows
ALL your data — running on **your** server, with **your** LLM keys, without
sending health data to a third-party SaaS.

> ⚠️ Pulso is **not** a medical device or a clinical tool. AI-extracted lab
> values can contain errors — always verify against your original PDF. Nothing
> here is medical advice.

## Quick Start

```bash
git clone https://github.com/your-org/pulso && cd pulso
cp .env.example .env          # set AUTH_SECRET (openssl rand -hex 32)
docker compose --profile demo up -d
```

Open http://localhost:3000 — the demo profile seeds a user with synthetic
wearable data, labs and a training plan so you can explore without connecting
anything.

## Features

- **Dashboard** — daily KPIs (steps, sleep, resting HR, stress, HRV, SpO2…),
  intraday curves, activities, body composition; 7/30/90-day trends.
- **Activity detail** — effort, HR zones, laps/splits, route map and elevation
  profile when your provider (or an uploaded FIT file) has them.
- **Biomarkers** — lab PDF → structured extraction with a vision LLM →
  sessions, flags, per-analyte trends across labs with unit normalization.
- **AI Coach** — persistent multi-conversation chats with your full health
  context (configurable window, default 90 days).
- **Training** — AI-generated periodized plans (plus a deterministic generator
  that needs **no** LLM key), weekly drag&drop editor, automatic km carryover,
  watch-run assignment, rebalancing, versions/undo, multi-race seasons.
- **Exercises** — per-user catalog (bodyweight + weighted), sets/reps logging,
  weekly goals.
- **Sharing** — explicit, scoped, revocable athlete↔coach read-only access.
- **Your data is yours** — full export in one click; deleting your account
  hard-deletes everything (enforced by the database, not by code).

## Multi-wearable via Open Wearables

Ingestion goes through [Open Wearables](https://github.com/the-momentum/open-wearables)
(self-hosted, MIT), which unifies Garmin, Whoop, Oura, Polar, Suunto, Fitbit,
Strava, Ultrahuman, Apple Health, Samsung Health and Google Health Connect.
Provider coverage varies (e.g. Whoop has no steps; Oura has no in-workout HR)
— the UI degrades gracefully and never shows broken/empty states.

## Graceful degradation

| You have | You get |
|---|---|
| No LLM key | Full tracking + **deterministic** plan generation (no coach/chat) |
| No wearable | Manual logging + labs |
| Wearable without laps/GPS | Activity cards show what exists; upload a FIT file for full detail |
| Ollama / any OpenAI-compatible endpoint | 100% local, fully private AI |

## FAQ

- **Do I need LLM keys?** No. Tracking, dashboards and deterministic training
  plans work without any. Chats and PDF extraction need a key (or a local
  Ollama).
- **Is this HIPAA-certified?** No. Pulso is a personal self-hosted tool, not a
  clinical product.
- **Does my data leave my server?** Only to the LLM providers **you**
  configure, and only when you use AI features.

## Development

```bash
npm install
cp .env.example .env
docker compose up -d postgres redis    # local services
npm run db:migrate
npm run dev
npm test
```

See [CONTRIBUTING.md](CONTRIBUTING.md). Policy: **every change ships with a
test** (see docs/testing.md).

## License

[AGPL-3.0](LICENSE). Open Wearables runs as a separate MIT-licensed service —
neither license contaminates the other.
