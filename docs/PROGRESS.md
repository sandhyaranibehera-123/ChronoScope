# Progress

Updated at the end of every session so a fresh session can resume without re-deriving context. See the project plan (linked from the session that created this repo) for the full 26-session schedule.

## Session 1 — Phase 1: Foundation ✅

**Landed:**
- Repo scaffold: npm workspaces (`apps/*`, `packages/*`), TypeScript project references, ESLint flat config, Prettier.
- `packages/contracts` — Zod env schema + health-response schemas.
- `packages/database` — MySQL connection pool (`pool.ts`), transaction helper (`transaction.ts`), typed duplicate-key error inspection (`errors.ts`), checksummed + `GET_LOCK`-guarded migration runner (`migrations.ts`), first migration `0001_databases.sql` (creates `chronoscope_core`/`chronoscope_ops`, nothing else — event/timeline tables are Phase 3's migration).
- `packages/observability` — Pino structured logger. OpenTelemetry deliberately not wired (Phase 4).
- `packages/testing` — MySQL Testcontainers helper. MongoDB module deferred to Phase 4.
- `apps/api` — Fastify server with split health endpoints (`/health/live`, `/health/version`, `/health/ready/write` — MySQL+Redis only, no single global `/health/ready`), dev-mode JWT verification plugin (never a token-issuing endpoint), CORS/Helmet/Sensible plugins.
- `apps/web` — Vite + React skeleton, one page (`HealthPage`) polling `/health/ready/write`.
- `apps/worker` — generic stub, no real logic yet (lands Phase 3).
- `apps/cli` — `chronoscope doctor` (mode-aware: MySQL+Redis only right now) and `chronoscope token --role <role>` (the only place a dev JWT is ever minted).
- `docker-compose.yml` — MySQL 8.4 (`innodb_autoinc_lock_mode=2` pinned via `infrastructure/docker/mysql/my.cnf` — the single most load-bearing MySQL setting in this architecture, see system-guarantees rule 6) + Redis in the default profile; Mongo/Kafka/RabbitMQ/NATS/MinIO profile-gated for their respective phases.
- Full `docs/` tree: `spec/system-guarantees.md` (the 25 frozen rules), `architecture/*` (ownership, ID semantics, timeline semantics, invariant enforcement, data classification), `reliability/failure-matrix.md`, 16 ADRs.
- `git init` + first commit.

**Explicitly NOT built yet** (don't scaffold ahead of need): `packages/domain`, `packages/events`, `packages/messaging`, `packages/read-store` — these are created in Phases 2, 3, 4, and 4 respectively, when they first get a real responsibility.

**Known gaps / follow-ups for whoever picks this up next:**
- Docker Desktop's CLI isn't linked on this machine yet (`Docker.app` exists in `/Applications` but `docker` isn't on `PATH`) — infra couldn't be started or migrations run against a live database in this session. **Next step**: launch Docker Desktop once manually (first-run needs GUI permission), confirm `docker --version` works, then `make infra && npm run migrate --workspace=packages/database`.
- MySQL role separation (`chronoscope_migrator`/`chronoscope_app`/`chronoscope_projection_worker`/`chronoscope_rebuild_controller`/`chronoscope_owner`) is deliberately simplified in Phase 1 — migrations run as `root`, the app uses one `chronoscope_app` user. Full role matrix enforcement is Phase 14, per the plan.
- `make bootstrap && make test` verified locally (see session notes) — `make test` is infra-free by design.

**Next session (Session 2)**: Phase 1 auth/logging skeleton polish + Phase 2 domain (Order state machine, repository interfaces, compensation map) + architecture-fitness v1 (forbidding `domain` from importing `database`/`read-store`/`messaging`/`web`/`api`).
