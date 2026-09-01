#!/bin/sh
# One Postgres instance, two databases: `pulso` and `open_wearables`
# (spec doc 01 — shared instance, separate DBs keep the API-only contract).
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE DATABASE open_wearables;
EOSQL
