#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .env.deploy ]; then
  echo "ERROR: .env.deploy is missing. Run the GitHub deploy once before restarting from SSH."
  exit 1
fi

COMPOSE_CMD="docker compose --env-file .env.deploy -f docker-compose.yml"
if [ -f docker-compose.override.yml ]; then
  echo "Found docker-compose.override.yml, applying..."
  COMPOSE_CMD="docker compose --env-file .env.deploy -f docker-compose.yml -f docker-compose.override.yml"
fi

echo "Stopping existing services..."
$COMPOSE_CMD down --remove-orphans 2>/dev/null

if [ "${1:-}" = "--pull" ]; then
  echo "Pulling latest images..."
  $COMPOSE_CMD pull
else
  echo "Skipping pull; using locally cached images. Pass --pull to fetch latest images."
fi

echo "Starting services..."
$COMPOSE_CMD up -d

echo "Waiting for services to be healthy..."
sleep 5

echo "Services:"
$COMPOSE_CMD ps

echo ""
echo "Restart complete. Check logs with: $COMPOSE_CMD logs -f"
