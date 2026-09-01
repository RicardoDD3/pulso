# Deploy without your own server: Vercel + Railway

The "no VPS" path: `pulso-web` on Vercel, the Open Wearables stack on Railway,
and managed Postgres + Redis.

## 1. Databases

- Postgres: any managed provider (Neon, Railway Postgres, Supabase…). Create
  TWO databases: `pulso` and `open_wearables`.
- Redis: Upstash or Railway Redis.

## 2. Open Wearables on Railway

OW has one-click Railway deploys. Point it at the `open_wearables` database
and the Redis instance. Note the public API URL.

## 3. pulso-web on Vercel

Import the repo, framework Next.js. Environment variables: everything from
`.env.example` with `DATABASE_URL`, `REDIS_URL`, `OW_API_URL` (the Railway
URL), `APP_URL` (your Vercel domain), `AUTH_SECRET` and your LLM keys.

Run migrations once from your machine:

```bash
DATABASE_URL=postgres://… npx drizzle-kit migrate
```

## 4. The worker

`pulso-worker` needs a long-lived process. Options:

- A Railway service running `npm run worker` from this repo (recommended).
- Degraded mode: skip the worker; labs extraction and wearable sync jobs stay
  queued until a worker runs. Webhook ingestion requires the worker.

## Notes

- SSE chat streaming works on Vercel's default Node runtime (Fluid Compute).
- Uploaded lab PDFs need a persistent disk: on Vercel use `UPLOADS_DIR`
  pointed at a mounted store, or run web on Railway too if you prefer
  filesystem simplicity.
