# CHRONOSCOPE

A deterministic distributed-systems laboratory: event sourcing, CQRS, deterministic replay, timeline branching with counterfactual execution, a causal graph, chaos engineering, recovery verification, and performance benchmarking — built to demonstrate, not just implement, specific distributed-systems properties.

> Every component in this stack exists to demonstrate a specific consistency, reliability, causality, execution, or recovery property that can be measured and verified. See `docs/spec/system-guarantees.md`.

## Architecture at a glance

- **MySQL 8.4** — the write side / sole source of truth (event sourcing, OCC, transactions).
- **MongoDB 7** — the read side (CQRS projections, disposable, rebuildable from MySQL).
- **Kafka** — durable event distribution. **RabbitMQ** — work delivery. **NATS** — control plane.
- **Redis** — rate limiting / cache / heartbeat only, never correctness. **MinIO** — artifact storage.
- **No Kubernetes** — Docker Compose is sufficient; see `docs/adr/014-why-not-kubernetes.md`.

Full rationale: `docs/spec/system-guarantees.md`, `docs/architecture/`, `docs/adr/`.

## Getting started

```bash
npm install
make infra          # starts MySQL + Redis
npm run migrate --workspace=packages/database
npm run dev --workspace=apps/api
```

```bash
make test           # unit tests — no Docker required
make doctor          # mode-aware infrastructure health check
chronoscope token --role researcher   # mint a local dev JWT (apps/cli)
```

## Project status

See `docs/PROGRESS.md` for what's landed and what's next, session by session.
