#!/usr/bin/env bash
# Destructive: tears down all Docker volumes, recreates infra, migrates, seeds.
# Interactive confirmation locally; CI/non-interactive requires RESET_CONFIRM=1.
set -euo pipefail

cd "$(dirname "$0")/.."

if [ "${RESET_CONFIRM:-}" != "1" ]; then
  read -r -p "This will DESTROY all local data (MySQL, Redis, Mongo volumes). Continue? [y/N] " confirm
  if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
    echo "Aborted."
    exit 1
  fi
fi

docker compose --profile mongo down -v
docker compose up -d
bash scripts/wait-for-healthy.sh mysql redis
npm run migrate --workspace=packages/database
npx tsx scripts/seed.ts

echo "Reset complete."
