import { describe, expect, it } from 'vitest';
import { InMemorySnapshotMetadataManager } from '../snapshots/snapshot-metadata-manager.js';
import { InMemoryExecutionManager } from '../executions/execution-manager.js';

describe('Database — Snapshot & Execution Managers (Phase 6, Rules 9, 11, 14)', () => {
  it('records snapshots and retrieves the latest READY snapshot at or below target sequence', async () => {
    const manager = new InMemorySnapshotMetadataManager();
    const timelineId = '00000000-0000-0000-0000-000000000001';
    const aggregateId = 'order-100';

    // Insert snapshot at sequence 3 (CREATING)
    await manager.insertSnapshot({
      snapshotId: 'snap-1',
      setId: null,
      timelineId,
      aggregateId,
      aggregateType: 'Order',
      aggregateSequence: 3,
      stateHash: 'hash-seq-3',
      status: 'CREATING',
      storageLocation: 'snapshots/snap-1.json',
      contentHash: 'content-hash-3',
    });

    // Not READY yet, should return null
    let latest = await manager.getLatestReadySnapshot(timelineId, aggregateId, 5);
    expect(latest).toBeNull();

    // Mark READY
    await manager.updateSnapshotStatus('snap-1', 'READY');
    latest = await manager.getLatestReadySnapshot(timelineId, aggregateId, 5);
    expect(latest).not.toBeNull();
    expect(latest?.snapshotId).toBe('snap-1');
    expect(latest?.aggregateSequence).toBe(3);

    // Insert snapshot at sequence 7 (READY)
    await manager.insertSnapshot({
      snapshotId: 'snap-2',
      setId: null,
      timelineId,
      aggregateId,
      aggregateType: 'Order',
      aggregateSequence: 7,
      stateHash: 'hash-seq-7',
      status: 'READY',
      storageLocation: 'snapshots/snap-2.json',
      contentHash: 'content-hash-7',
    });

    // Querying up to seq 10 should return snap-2 (seq 7)
    latest = await manager.getLatestReadySnapshot(timelineId, aggregateId, 10);
    expect(latest?.snapshotId).toBe('snap-2');

    // Querying up to seq 5 should return snap-1 (seq 3)
    latest = await manager.getLatestReadySnapshot(timelineId, aggregateId, 5);
    expect(latest?.snapshotId).toBe('snap-1');
  });

  it('manages snapshot sets and individual snapshots linked to a set', async () => {
    const manager = new InMemorySnapshotMetadataManager();
    const timelineId = '00000000-0000-0000-0000-000000000001';
    const setId = 'set-100';

    await manager.insertSnapshotSet({
      setId,
      timelineId,
      timelinePosition: 42,
      status: 'CREATING',
      contentHash: null,
      storageLocation: 'snapshot-sets/set-100.json',
      metadata: { aggregateCount: 2 },
    });

    await manager.insertSnapshot({
      snapshotId: 'snap-agg-1',
      setId,
      timelineId,
      aggregateId: 'order-1',
      aggregateType: 'Order',
      aggregateSequence: 4,
      stateHash: 'hash-1',
      status: 'READY',
      storageLocation: 'snapshots/snap-agg-1.json',
      contentHash: 'content-hash-agg-1',
    });

    await manager.insertSnapshot({
      snapshotId: 'snap-agg-2',
      setId,
      timelineId,
      aggregateId: 'order-2',
      aggregateType: 'Order',
      aggregateSequence: 6,
      stateHash: 'hash-2',
      status: 'READY',
      storageLocation: 'snapshots/snap-agg-2.json',
      contentHash: 'content-hash-agg-2',
    });

    await manager.updateSnapshotSetStatus(setId, 'READY', 'set-content-hash-100');

    const set = await manager.getSnapshotSet(setId);
    expect(set).not.toBeNull();
    expect(set?.status).toBe('READY');
    expect(set?.contentHash).toBe('set-content-hash-100');
    expect(set?.completedAt).not.toBeNull();

    const snapshotsInSet = await manager.getSnapshotsForSet(setId);
    expect(snapshotsInSet.length).toBe(2);
  });

  it('tracks execution lifecycle and verifies live/replay hash parity record (Rule 9, 11)', async () => {
    const manager = new InMemoryExecutionManager();
    const executionId = 'exec-001';

    await manager.createExecution({
      executionId,
      mode: 'LIVE_REPLAY',
      timelineId: '00000000-0000-0000-0000-000000000001',
      aggregateId: 'order-123',
      fromSequence: 0,
      toSequence: 5,
    });

    let exec = await manager.getExecution(executionId);
    expect(exec?.status).toBe('RUNNING');
    expect(exec?.eventsReplayed).toBe(0);

    const stateHash = 'canonical-state-hash-123';
    await manager.completeExecution(executionId, {
      eventsReplayed: 5,
      stateHash,
      liveStateHash: stateHash,
      hashParityMatched: true,
      summary: { durationMs: 42, snapshotUsed: false },
    });

    exec = await manager.getExecution(executionId);
    expect(exec?.status).toBe('COMPLETED');
    expect(exec?.eventsReplayed).toBe(5);
    expect(exec?.hashParityMatched).toBe(true);
    expect(exec?.stateHash).toBe(stateHash);
    expect(exec?.liveStateHash).toBe(stateHash);
    expect(exec?.completedAt).not.toBeNull();
  });
});
