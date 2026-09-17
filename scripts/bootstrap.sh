#!/usr/bin/env bash
# Convenience wrapper mirroring `make bootstrap` for anyone not using make.
# Installs dependencies; migrates only if MySQL is already reachable on the
# configured host/port (never hard-fails Phase 1 just because Docker hasn't
# been started yet — `make test` must stay infra-free regardless).
set -euo pipefail

cd "$(dirname "$0")/.."

npm install

# Deliberately checks the docker-compose-managed MySQL container specifically
# (never a raw TCP port probe) — a raw "is something listening on 3306" check
# can false-positive against an unrelated MySQL instance already running on
# the host (e.g. a Homebrew-installed local server) and would otherwise risk
# running this project's migrations against a completely unrelated database.
if command -v docker >/dev/null 2>&1 && \
   docker compose ps mysql --format '{{.Health}}' 2>/dev/null | grep -q '^healthy$'; then
  echo "chronoscope-mysql container is healthy — running migrations..."
  npm run migrate --workspace=packages/database
else
  echo "chronoscope-mysql container is not running (or Docker isn't available) — skipping migrations."
  echo "Run 'make infra' (starts the project's own MySQL+Redis containers) then"
  echo "'npm run migrate --workspace=packages/database' when ready."
fi

echo "Bootstrap complete."
