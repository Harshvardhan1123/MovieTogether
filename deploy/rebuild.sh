#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ ! -f .env.production ]]; then
  echo "Missing .env.production. Create it from deploy/.env.production.example." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
source .env.production
set +a

: "${NEXT_PUBLIC_SUPABASE_URL:?NEXT_PUBLIC_SUPABASE_URL is required}"
: "${NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:?NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is required}"
: "${ACME_EMAIL:?ACME_EMAIL is required}"

docker compose --env-file .env.production build \
  --no-cache \
  --build-arg "NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL}" \
  app
docker compose --env-file .env.production up -d --force-recreate app caddy
docker compose --env-file .env.production ps
