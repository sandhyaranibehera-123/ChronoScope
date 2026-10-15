import type { IChaosEngine } from '../../types.js';

export interface SnapshotLossScenarioDeps {
  readonly corruptSnapshotObject: () => Promise<void>;
  readonly executeReplayWithFallback: () => Promise<{
    success: boolean;
    hashParityMatched: boolean;
    fallbackTriggered: boolean;
  }>;
}

/**
 * Phase 11 scenario: Snapshot Object Loss in MinIO (Rule 14 & ADR-009).
 *
 * Verifies that when a snapshot object is corrupted or lost in storage:
 * 1. Replay engine detects content_hash mismatch.
 * 2. Replay transparently falls back to genesis event history on MySQL.
 * 3. Exact live/replay hash parity is maintained without data loss.
 */
export async function executeSnapshotLossScenario(
  chaosEngine: IChaosEngine,
  recordInvariant: (
    name: string,
    expected: unknown,
    measured: unknown,
    passed: boolean,
    details?: string,
  ) => Promise<void>,
  deps: SnapshotLossScenarioDeps,
): Promise<Record<string, unknown>> {
  // 1. Inject CORRUPT_PAYLOAD fault targeting snapshots
  const activeFault = await chaosEngine.inject(
    {
      layer: 'APPLICATION',
      type: 'CORRUPT_PAYLOAD',
      target: 'minio-snapshots',
      ttlSeconds: 60,
    },
    'admin',
  );

  // 2. Corrupt the snapshot payload in storage
  await deps.corruptSnapshotObject();

  // 3. Execute replay and observe transparent fallback to genesis events
  const replayResult = await deps.executeReplayWithFallback();

  await recordInvariant(
    'replay_detected_snapshot_corruption_and_fell_back',
    { fallbackTriggered: true },
    { fallbackTriggered: replayResult.fallbackTriggered },
    replayResult.fallbackTriggered,
    'Replay engine safely detected content_hash mismatch and bypassed snapshot',
  );

  await recordInvariant(
    'hash_parity_preserved_via_genesis_event_fallback',
    { success: true, hashParityMatched: true },
    { success: replayResult.success, hashParityMatched: replayResult.hashParityMatched },
    replayResult.success && replayResult.hashParityMatched,
    'Genesis replay preserved exact hash parity against live aggregate state',
  );

  // 4. Disarm fault
  await chaosEngine.disarm(activeFault.faultId, 'admin');

  return {
    fallbackTriggered: replayResult.fallbackTriggered,
    hashParityMatched: replayResult.hashParityMatched,
  };
}
