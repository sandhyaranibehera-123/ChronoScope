# ADR-013: Docker Compose as the only local orchestrator

**Status**: Accepted

**Context**: The project runs on a single 8 GB development machine. It needs a way to run multiple infrastructure dependencies (MySQL, Redis, and — profile-gated — Kafka, RabbitMQ, NATS, MinIO, MongoDB, observability) without the operational overhead of a cluster orchestrator.

**Decision**: `docker-compose.yml` (infra only, lean default of MySQL+Redis, everything else profile-gated behind `--profile <name>`, introduced only in the phase that first needs it) + `docker-compose.e2e.yml` (an overlay adding application services as they're built). See ADR-014 for why this stops at Compose rather than Kubernetes.

**Consequences**: `--profile full` is an occasional integration check, never the daily-driver state, keeping the machine's RAM budget intact.
