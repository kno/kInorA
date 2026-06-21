#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "Stopping existing services..."
docker compose down --remove-orphans 2>/dev/null

echo "Pulling latest images..."
docker compose pull

echo "Starting services..."
docker compose up -d

echo "Waiting for services to be healthy..."
sleep 5

echo "Services:"
docker compose ps

echo ""
echo "Restart complete. Check logs with: docker compose logs -f"
