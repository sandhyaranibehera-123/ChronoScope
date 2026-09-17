# ADR-012: OpenTelemetry from Phase 4, Pino-only before that

**Status**: Accepted

**Context**: Distributed tracing is only meaningful once there's an actual cross-service event flow to trace (Kafka → projection worker). Wiring OTel in Phase 1, before any domain event exists, would add debugging surface with nothing to observe.

**Decision**: Phase 1–3 use structured Pino JSON logging to stdout only. OpenTelemetry (→ Prometheus/Grafana/Jaeger) goes live starting Phase 4. Loki is deliberately excluded — Pino JSON + `docker compose logs | jq` is enough for a solo lab, and it's one fewer container on an 8 GB host.

**Consequences**: `packages/observability` ships with just a logger in Phase 1; OTel bootstrap is added, not retrofitted, in Phase 4.
