# Deploy on a VPS with Docker Compose (primary path)

Requirements: a VPS with Docker ≥24 and 2 GB RAM, a domain (optional but
recommended), and 10 minutes.

## 1. Get the code and configure

```bash
git clone https://github.com/RicardoDD3/pulso && cd pulso
cp .env.example .env
```

Edit `.env` — the minimum:

- `AUTH_SECRET` — `openssl rand -hex 32`
- `APP_URL` — the public URL (e.g. `https://pulso.example.com`)
- LLM keys only if you want the coach/labs features (the app runs without them)

## 2. Start

```bash
docker compose up -d          # full stack
docker compose --profile demo up -d   # + demo user with synthetic data
```

Migrations run automatically on `pulso-web` startup. Check health:

```bash
curl -s localhost:3000/api/system/healthz
```

## 3. TLS reverse proxy (Caddy example)

Never expose port 3000 directly on the internet without TLS. With Caddy:

```
pulso.example.com {
    reverse_proxy localhost:3000
}
```

Caddy handles certificates automatically. Set `APP_URL=https://pulso.example.com`
and restart `pulso-web`. Cookies are `secure` behind the proxy.

## 4. Wearables (Open Wearables)

The compose stack includes OW (`ow-api`, `ow-worker`, `ow-portal`).

1. Open the OW portal (port 5173) → create an application → copy the API key
   into `OW_API_KEY`.
2. Configure the OAuth credentials of each provider you want in OW (see
   [providers.md](providers.md) — each vendor requires a developer account).
3. Set `OW_WEBHOOK_SECRET` from the OW webhook endpoint config.
4. `docker compose restart pulso-web pulso-worker`.

## 5. Updates

```bash
git pull && docker compose build && docker compose up -d
```

Migrations are forward-compatible within a minor version.

## Backups

Everything lives in two named volumes: `pgdata` (Postgres) and `uploads`
(lab PDFs). Back those up and you can restore the instance completely.
