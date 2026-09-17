.PHONY: bootstrap dev infra infra-down infra-mongo infra-mongo-down test integration unit e2e e2e-observability benchmark experiment chaos recovery doctor audit audit-deep seed reset down ps logs help

COMPOSE=docker compose
COMPOSE_E2E=docker compose -f docker-compose.yml -f docker-compose.e2e.yml

help: ## Show available targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

bootstrap: ## Install deps; migrate if MySQL is already reachable (never blocks on Docker)
	@bash scripts/bootstrap.sh

dev: infra ## Start infra then run API in dev mode
	npm run dev --workspace=apps/api

infra: ## Start MySQL + Redis (default profile)
	$(COMPOSE) up -d
	@bash scripts/wait-for-healthy.sh mysql redis

infra-down: ## Stop MySQL + Redis
	$(COMPOSE) down

infra-mongo: ## Start MySQL + Redis + MongoDB
	$(COMPOSE) --profile mongo up -d
	@bash scripts/wait-for-healthy.sh mysql redis mongo

infra-mongo-down: ## Stop all including MongoDB
	$(COMPOSE) --profile mongo down

test: ## Run all unit tests (no Docker needed)
	npm test

integration: ## Run integration tests (Testcontainers -- self-starting)
	npm run test:integration --workspace=packages/database --if-present

unit: ## Alias for test
	npm test

e2e: infra ## Run end-to-end tests against live infra
	$(COMPOSE_E2E) up -d
	npm run test:e2e --workspace=apps/api --if-present

e2e-observability: ## Run e2e tests with observability stack
	$(COMPOSE) --profile observability up -d
	npm run test:e2e --workspace=apps/api --if-present

doctor: ## Check all service health
	npx tsx apps/cli/src/index.ts doctor

audit: ## Run quick audit (live-tolerant checks)
	npx tsx apps/cli/src/index.ts audit --quick

audit-deep: ## Run deep audit (quiesced, strict checks)
	npx tsx apps/cli/src/index.ts audit --deep

seed: ## Seed baseline data
	npx tsx scripts/seed.ts

reset: ## Tear down volumes and restart infra (destructive!)
	@echo "WARNING: This will destroy all data. Ctrl+C to abort..."
	@sleep 3
	$(COMPOSE) --profile mongo down -v
	@bash scripts/reset.sh

down: ## Stop all services
	$(COMPOSE) --profile mongo down

ps: ## Show running services
	$(COMPOSE) ps

logs: ## Tail logs for all services
	$(COMPOSE) logs -f

benchmark: ## Run performance benchmarks (Phase 13)
	@echo "Benchmarks available from Phase 13"

experiment: ## Run an experiment (Phase 11)
	@echo "Experiments available from Phase 11"

chaos: ## Run chaos scenarios (Phase 11)
	@echo "Chaos scenarios available from Phase 11"

recovery: ## Run recovery test suite (Phase 12)
	@echo "Recovery tests available from Phase 12"
