#!/usr/bin/env bash
# Polls `docker compose ps` until every named service reports "healthy",
# or exits non-zero after TIMEOUT_SECONDS. Usage: wait-for-healthy.sh mysql redis [mongo ...]
set -euo pipefail

TIMEOUT_SECONDS="${WAIT_FOR_HEALTHY_TIMEOUT:-90}"
INTERVAL_SECONDS=2
SERVICES=("$@")

if [ ${#SERVICES[@]} -eq 0 ]; then
  echo "usage: wait-for-healthy.sh <service> [<service> ...]" >&2
  exit 1
fi

elapsed=0
while true; do
  all_healthy=true
  for service in "${SERVICES[@]}"; do
    status=$(docker compose ps --format '{{.Health}}' "$service" 2>/dev/null || echo "")
    if [ "$status" != "healthy" ]; then
      all_healthy=false
    fi
  done

  if [ "$all_healthy" = true ]; then
    echo "All services healthy: ${SERVICES[*]}"
    exit 0
  fi

  if [ "$elapsed" -ge "$TIMEOUT_SECONDS" ]; then
    echo "Timed out after ${TIMEOUT_SECONDS}s waiting for: ${SERVICES[*]}" >&2
    docker compose ps
    exit 1
  fi

  sleep "$INTERVAL_SECONDS"
  elapsed=$((elapsed + INTERVAL_SECONDS))
done
