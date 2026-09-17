import { createLogger } from '@chronoscope/observability';

/**
 * Generic background worker stub. This is deliberately the ONLY worker app
 * until Phase 4, when `apps/projection-worker` is created as its own app
 * (not folded into this one) — don't scaffold ahead of need.
 *
 * Real responsibility lands Phase 3 (outbox publisher).
 */
const logger = createLogger({ name: 'chronoscope-worker' });

logger.info('worker stub started — no real work assigned yet (lands Phase 3)');

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
