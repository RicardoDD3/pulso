#!/bin/sh
# Runs idempotent Drizzle migrations before starting the server (spec doc 01).
set -e
echo "[pulso] applying database migrations…"
npx drizzle-kit migrate
echo "[pulso] migrations applied. starting…"
exec "$@"
