#!/usr/bin/env bash
set -euo pipefail

# Decode and source environment (base64 avoids shell injection through SSH command line)
eval "$(printf '%s' "$ENV_PAYLOAD" | base64 -d)"

cd "$VPS_DEPLOY_DIR"

# Operator-managed runtime secrets (OPENROUTER_*, LANGFUSE_*, optional POSTGRES_*)
# live in a persistent .env on the server, NOT in GitHub secrets. Sourced here so
# docker compose can interpolate ${OPENROUTER_*} / ${LANGFUSE_*} from the environment.
# This file is NOT shipped by the deploy workflow and survives across deploys.
#
# PRECEDENCE: the deploy-managed vars from the ENV_PAYLOAD (image ref, OAuth, API base)
# are authoritative for THIS release. We snapshot them before sourcing .env and restore
# them after, so a stale value accidentally left in the operator .env (e.g. a hardcoded
# IMAGE_TAG/GHCR_IMAGE copied from .env.deploy) can NEVER override the image the workflow
# just built and pushed. Without this, a green deploy could silently run an old image.
if [ -f .env ]; then
  __payload_ghcr_image="$GHCR_IMAGE"
  __payload_image_tag="$IMAGE_TAG"
  __payload_google_client_id="${GOOGLE_CLIENT_ID:-}"
  __payload_google_client_secret="${GOOGLE_CLIENT_SECRET:-}"
  __payload_google_redirect_uri="${GOOGLE_REDIRECT_URI:-}"
  __payload_oidc_redirect_uri="${OIDC_REDIRECT_URI:-}"
  __payload_api_base_url="${API_BASE_URL:-}"
  __payload_web_public_origin="${WEB_PUBLIC_ORIGIN:-}"

  if grep -qE '^[[:space:]]*(GHCR_IMAGE|IMAGE_TAG|GOOGLE_|OIDC_REDIRECT_URI|API_BASE_URL|WEB_PUBLIC_ORIGIN)=' .env; then
    echo "WARNING: operator .env defines deploy-managed vars (IMAGE_TAG/GHCR_IMAGE/GOOGLE_*/API_BASE_URL/WEB_PUBLIC_ORIGIN)." >&2
    echo "         These are ignored — the release payload is authoritative. Keep only OPENROUTER_*/LANGFUSE_*/POSTGRES_* in .env." >&2
  fi

  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a

  # Restore deploy-managed vars — the release payload always wins over .env.
  GHCR_IMAGE="$__payload_ghcr_image"
  IMAGE_TAG="$__payload_image_tag"
  GOOGLE_CLIENT_ID="$__payload_google_client_id"
  GOOGLE_CLIENT_SECRET="$__payload_google_client_secret"
  GOOGLE_REDIRECT_URI="$__payload_google_redirect_uri"
  OIDC_REDIRECT_URI="$__payload_oidc_redirect_uri"
  API_BASE_URL="$__payload_api_base_url"
  WEB_PUBLIC_ORIGIN="$__payload_web_public_origin"
fi

# Persist deploy-managed vars (image ref, Google OAuth, API base URL) for SSH
# restarts without GitHub secrets. Operator secrets (OPENROUTER_*, LANGFUSE_*)
# come from the persistent .env above — they are NOT written to .env.deploy.
printf 'GHCR_IMAGE=%s\nIMAGE_TAG=%s\nGOOGLE_CLIENT_ID=%s\nGOOGLE_CLIENT_SECRET=%s\nGOOGLE_REDIRECT_URI=%s\nOIDC_REDIRECT_URI=%s\nAPI_BASE_URL=%s\n' \
  "$GHCR_IMAGE" "$IMAGE_TAG" \
  "${GOOGLE_CLIENT_ID:-}" "${GOOGLE_CLIENT_SECRET:-}" \
  "${GOOGLE_REDIRECT_URI:-}" "${OIDC_REDIRECT_URI:-}" \
  "${API_BASE_URL:-}" > .env.deploy

# Stop and remove any previous containers before deploying
docker compose down --remove-orphans 2>/dev/null || true

# Compose command with optional override file
COMPOSE_CMD="docker compose --env-file .env.deploy -f docker-compose.yml"
if [ -f docker-compose.override.yml ]; then
  echo "Found docker-compose.override.yml, applying..."
  COMPOSE_CMD="docker compose --env-file .env.deploy -f docker-compose.yml -f docker-compose.override.yml"
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

# Reclaim disk from superseded images now that the new deploy is verified healthy.
# Each deploy pulls a fresh GHCR_IMAGE tag but the previous tagged images were
# never removed, so old layers accumulated until the VPS ran out of disk (the
# postgres "No space left on device" boot failure). Prune unused images (-a keeps
# only those referenced by the running containers). Runs AFTER the health check so
# the just-deployed image is protected and a mid-deploy failure never prunes.
# Non-fatal: a prune hiccup must not fail an otherwise-successful deploy.
docker image prune -af >/dev/null 2>&1 || true

echo "Deploy complete."
