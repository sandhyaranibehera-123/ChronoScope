import type { IChaosEngine } from '../../types.js';

export interface MongoUnavailableScenarioDeps {
  readonly executeWriteCommand: (
    commandName: string,
  ) => Promise<{ success: boolean; sequence: number }>;
  readonly executeReadQuery: () => Promise<{ ok: boolean; status?: string; error?: string }>;
  readonly flushProjectionBacklog: () => Promise<number>;
  readonly verifyProjectionConsistency: () => Promise<{
    matched: boolean;
    appliedSequence: number;
  }>;
}

/**
 * Phase 11 signature scenario: MongoDB Unavailable (Dependency Layer Fault).
 *
 * Demonstrates decoupled failure domains in the polyglot persistence architecture:
 * 1. Write path (MySQL) continues uninterrupted while MongoDB is down.
 * 2. Kafka buffers the event stream.
 * 3. Read queries against MongoDB degrade cleanly.
 * 4. Once MongoDB recovers, projection worker drains backlog with zero data loss or duplicate application.
 */
export async function executeMongoUnavailableScenario(
  chaosEngine: IChaosEngine,
  recordInvariant: (
    name: string,
    expected: unknown,
    measured: unknown,
    passed: boolean,
    details?: string,
  ) => Promise<void>,
  deps: MongoUnavailableScenarioDeps,
): Promise<Record<string, unknown>> {
  // Step 1: Pre-chaos baseline verification
  const preChaosWrite = await deps.executeWriteCommand('CreateOrder');
  await recordInvariant(
    'baseline_write_ok',
    { success: true },
    { success: preChaosWrite.success },
    preChaosWrite.success,
    'Baseline order creation on MySQL succeeded',
  );

  // Step 2: Inject MONGODB_UNAVAILABLE fault
  const activeFault = await chaosEngine.inject(
    {
      layer: 'DEPENDENCY',
      type: 'MONGODB_UNAVAILABLE',
      target: 'mongodb',
      ttlSeconds: 60,
    },
    'admin',
  );

  // Step 3: Verify write-path continuity under MongoDB outage
  const chaosWrite = await deps.executeWriteCommand('AddOrderItem');
  const writePathSucceeded = chaosWrite.success && chaosWrite.sequence > preChaosWrite.sequence;
  await recordInvariant(
    'write_path_uninterrupted_during_mongo_outage',
    { success: true },
    { success: writePathSucceeded, sequence: chaosWrite.sequence },
    writePathSucceeded,
    'MySQL transactions, events, and outbox proceed normally despite read store failure',
  );

  // Step 4: Verify read-path graceful degradation
  const degradedRead = await deps.executeReadQuery();
  const readPathDegraded = !degradedRead.ok;
  await recordInvariant(
    'read_path_degraded_cleanly',
    { ok: false },
    { ok: degradedRead.ok, error: degradedRead.error },
    readPathDegraded,
    'MongoDB query degraded gracefully returning 503 / read failure',
  );

  // Step 5: Disarm MONGODB_UNAVAILABLE fault
  await chaosEngine.disarm(activeFault.faultId, 'admin');

  // Step 6: Trigger projection backlog catch-up
  const caughtUpEventsCount = await deps.flushProjectionBacklog();
  const catchupPassed = caughtUpEventsCount > 0;
  await recordInvariant(
    'post_recovery_backlog_drain',
    { caughtUpAtLeast: 1 },
    { caughtUpEventsCount },
    catchupPassed,
    'Projection worker drained Kafka backlog after MongoDB reconnected',
  );

  // Step 7: Verify final read-model consistency and hash parity
  const consistency = await deps.verifyProjectionConsistency();
  await recordInvariant(
    'read_model_hash_parity_and_sequence_convergence',
    { matched: true, appliedSequence: chaosWrite.sequence },
    { matched: consistency.matched, appliedSequence: consistency.appliedSequence },
    consistency.matched && consistency.appliedSequence === chaosWrite.sequence,
    'MongoDB projection converged to latest MySQL sequence with matching state hash',
  );

  return {
    preChaosSequence: preChaosWrite.sequence,
    chaosSequence: chaosWrite.sequence,
    drainedBacklogEvents: caughtUpEventsCount,
    convergedSequence: consistency.appliedSequence,
    consistencyMatched: consistency.matched,
  };
}
