#!/usr/bin/env bash
set -euo pipefail

# Decode and source environment (base64 avoids shell injection through SSH command line)
eval "$(printf '%s' "$ENV_PAYLOAD" | base64 -d)"

cd "$VPS_DEPLOY_DIR"

# Stop and remove any previous containers before deploying
docker compose down --remove-orphans 2>/dev/null || true

# Compose command with optional override file
COMPOSE_CMD="docker compose -f docker-compose.yml"
if [ -f docker-compose.override.yml ]; then
  echo "Found docker-compose.override.yml, applying..."
  COMPOSE_CMD="docker compose -f docker-compose.yml -f docker-compose.override.yml"
fi

printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin
docker pull "$GHCR_IMAGE:$IMAGE_TAG"

export GHCR_IMAGE IMAGE_TAG
$COMPOSE_CMD up -d postgres

echo "Waiting for PostgreSQL to be ready..."
POSTGRES_USER="${POSTGRES_USER:-kinora}"
POSTGRES_DB="${POSTGRES_DB:-kinora}"
for i in $(seq 1 30); do
  if $COMPOSE_CMD exec -T postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; then
    echo "PostgreSQL is ready after ${i} attempt(s)."
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "ERROR: PostgreSQL did not become ready within 30 attempts."
    $COMPOSE_CMD logs --tail=20 postgres
    exit 1
  fi
  sleep 2
done

$COMPOSE_CMD run --rm --no-deps \
  api pnpm --filter api db:migrate

$COMPOSE_CMD up -d api web

# Verify health via internal compose network (API already passed Docker healthcheck)
$COMPOSE_CMD exec api node -e "fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

echo "Deploy complete."
