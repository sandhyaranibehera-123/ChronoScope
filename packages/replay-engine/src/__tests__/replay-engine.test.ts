import { describe, expect, it } from 'vitest';
import {
  type DomainEvent,
  type OrderState,
  computeStateHash,
  orderReducer,
} from '@chronoscope/domain';
import { InMemorySnapshotMetadataManager, InMemoryExecutionManager } from '@chronoscope/database';
import {
  InMemoryEventReader,
  AuthoritativeStateResolver,
} from '../authoritative-state-resolver.js';
import { InMemorySnapshotStorage } from '../snapshots/snapshot-storage.js';
import { SnapshotManager } from '../snapshots/snapshot-manager.js';
import { LiveReplayService, type ILiveStateProvider } from '../replay/live-replay-service.js';

describe('Replay Engine & Snapshot Service (Phase 6, Rules 9, 11, 14 & ADR-008, ADR-009)', () => {
  const timelineId = '00000000-0000-0000-0000-000000000001';
  const aggregateId = 'order-test-1';

  // Helper to build order events
  function createSampleOrderEvents(): DomainEvent[] {
    const e1: DomainEvent = {
      event_id: 'evt-001',
      timeline_id: timelineId,
      aggregate_id: aggregateId,
      aggregate_type: 'Order',
      aggregate_sequence: 1,
      event_type: 'OrderCreated',
      schema_version: 1,
      payload: { customer_id: 'cust-1', currency: 'INR' },
      event_hash: 'hash-evt-1',
      causation_id: null,
      correlation_id: 'corr-1',
      recorded_at: '2025-01-01T10:00:00.000Z',
    };

    const e2: DomainEvent = {
      event_id: 'evt-002',
      timeline_id: timelineId,
      aggregate_id: aggregateId,
      aggregate_type: 'Order',
      aggregate_sequence: 2,
      event_type: 'OrderItemAdded',
      schema_version: 1,
      payload: {
        item: {
          sku: 'SKU-A',
          quantity: 2,
          unitAmountMinor: 10000n,
          totalAmountMinor: 20000n,
        },
      },
      event_hash: 'hash-evt-2',
      causation_id: 'evt-001',
      correlation_id: 'corr-1',
      recorded_at: '2025-01-01T10:01:00.000Z',
    };

    const e3: DomainEvent = {
      event_id: 'evt-003',
      timeline_id: timelineId,
      aggregate_id: aggregateId,
      aggregate_type: 'Order',
      aggregate_sequence: 3,
      event_type: 'OrderConfirmed',
      schema_version: 1,
      payload: {
        total_amount_minor: 20000n,
        currency: 'INR',
        item_count: 1,
      },
      event_hash: 'hash-evt-3',
      causation_id: 'evt-002',
      correlation_id: 'corr-1',
      recorded_at: '2025-01-01T10:02:00.000Z',
    };

    return [e1, e2, e3];
  }

  it('captures an aggregate snapshot, verifies content_hash, and marks it READY (Rule 14)', async () => {
    const events = createSampleOrderEvents();
    const eventReader = new InMemoryEventReader(events);
    const metadataManager = new InMemorySnapshotMetadataManager();
    const storage = new InMemorySnapshotStorage();
    const stateResolver = new AuthoritativeStateResolver(eventReader);

    const snapshotManager = new SnapshotManager(metadataManager, storage, stateResolver);

    const snap = await snapshotManager.createAggregateSnapshot({
      timelineId,
      aggregateId,
      targetSequence: 2,
      aggregateType: 'Order',
    });

    expect(snap.status).toBe('READY');
    expect(snap.aggregateSequence).toBe(2);
    expect(snap.contentHash).toBeDefined();

    // Verify storage payload
    const payload = await storage.readSnapshotPayload<{ state: OrderState }>(snap.storageLocation);
    expect(payload.state.status).toBe('CREATED');
    expect(payload.state.items.length).toBe(1);

    // Verify loading and integrity
    const verified = await snapshotManager.loadAndVerifySnapshot(snap.snapshotId);
    expect(verified).not.toBeNull();
    expect(verified?.snapshot.snapshotId).toBe(snap.snapshotId);
  });

  it('executes full LIVE_REPLAY from genesis and proves hash parity against live state (Rule 9, 11)', async () => {
    const events = createSampleOrderEvents();
    const eventReader = new InMemoryEventReader(events);
    const executionManager = new InMemoryExecutionManager();

    // Compute live state manually using the reducer
    let liveState: OrderState | null = null;
    for (const e of events) {
      liveState = orderReducer(liveState as never, e as never);
    }
    const expectedLiveHash = computeStateHash(liveState);

    const liveStateProvider: ILiveStateProvider = {
      async getLiveState() {
        return {
          sequence: 3,
          state: liveState,
          stateHash: expectedLiveHash,
        };
      },
    };

    const replayService = new LiveReplayService(
      eventReader,
      executionManager,
      undefined,
      liveStateProvider,
    );

    const result = await replayService.replayAggregate<OrderState>({
      timelineId,
      aggregateId,
      aggregateType: 'Order',
      targetSequence: 3,
      useSnapshot: false,
    });

    expect(result.eventsReplayed).toBe(3);
    expect(result.fromSequence).toBe(0);
    expect(result.toSequence).toBe(3);
    expect(result.state?.status).toBe('CONFIRMED');
    expect(result.stateHash).toBe(expectedLiveHash);
    expect(result.hashParityMatched).toBe(true);

    // Check permanent audit execution record in chronoscope_ops.executions
    const execRecord = await executionManager.getExecution(result.executionId);
    expect(execRecord?.status).toBe('COMPLETED');
    expect(execRecord?.hashParityMatched).toBe(true);
    expect(execRecord?.eventsReplayed).toBe(3);
  });

  it('accelerates LIVE_REPLAY using a verified READY snapshot (replays only residual events)', async () => {
    const events = createSampleOrderEvents();
    const eventReader = new InMemoryEventReader(events);
    const metadataManager = new InMemorySnapshotMetadataManager();
    const storage = new InMemorySnapshotStorage();
    const executionManager = new InMemoryExecutionManager();
    const stateResolver = new AuthoritativeStateResolver(eventReader);
    const snapshotManager = new SnapshotManager(metadataManager, storage, stateResolver);

    // Create snapshot at sequence 2
    const snap = await snapshotManager.createAggregateSnapshot({
      timelineId,
      aggregateId,
      targetSequence: 2,
      aggregateType: 'Order',
    });

    // Compute live state at sequence 3
    let liveState: OrderState | null = null;
    for (const e of events) {
      liveState = orderReducer(liveState as never, e as never);
    }
    const expectedLiveHash = computeStateHash(liveState);

    const liveStateProvider: ILiveStateProvider = {
      async getLiveState() {
        return {
          sequence: 3,
          state: liveState,
          stateHash: expectedLiveHash,
        };
      },
    };

    const replayService = new LiveReplayService(
      eventReader,
      executionManager,
      snapshotManager,
      liveStateProvider,
    );

    const result = await replayService.replayAggregate<OrderState>({
      timelineId,
      aggregateId,
      aggregateType: 'Order',
      targetSequence: 3,
      useSnapshot: true,
    });

    // Accelerated: started from sequence 2, replayed only 1 residual event (evt-003)
    expect(result.fromSequence).toBe(2);
    expect(result.toSequence).toBe(3);
    expect(result.snapshotId).toBe(snap.snapshotId);
    expect(result.eventsReplayed).toBe(1);
    expect(result.state?.status).toBe('CONFIRMED');
    expect(result.stateHash).toBe(expectedLiveHash);
    expect(result.hashParityMatched).toBe(true);
  });

  it('transparently falls back to raw events if a snapshot is corrupted in storage (ADR-009 & Rule 14)', async () => {
    const events = createSampleOrderEvents();
    const eventReader = new InMemoryEventReader(events);
    const metadataManager = new InMemorySnapshotMetadataManager();
    const storage = new InMemorySnapshotStorage();
    const executionManager = new InMemoryExecutionManager();
    const stateResolver = new AuthoritativeStateResolver(eventReader);
    const snapshotManager = new SnapshotManager(metadataManager, storage, stateResolver);

    // Create snapshot at sequence 2
    const snap = await snapshotManager.createAggregateSnapshot({
      timelineId,
      aggregateId,
      targetSequence: 2,
      aggregateType: 'Order',
    });

    // Deliberately corrupt the snapshot payload in storage
    storage.corruptPayload(snap.storageLocation);

    // Compute expected live hash
    let liveState: OrderState | null = null;
    for (const e of events) {
      liveState = orderReducer(liveState as never, e as never);
    }
    const expectedLiveHash = computeStateHash(liveState);

    const liveStateProvider: ILiveStateProvider = {
      async getLiveState() {
        return {
          sequence: 3,
          state: liveState,
          stateHash: expectedLiveHash,
        };
      },
    };

    const replayService = new LiveReplayService(
      eventReader,
      executionManager,
      snapshotManager,
      liveStateProvider,
    );

    // Replay should detect corruption, log warning, fall back to genesis, and succeed
    const result = await replayService.replayAggregate<OrderState>({
      timelineId,
      aggregateId,
      aggregateType: 'Order',
      targetSequence: 3,
      useSnapshot: true,
    });

    // Fell back to fromSequence = 0, replayed all 3 events
    expect(result.fromSequence).toBe(0);
    expect(result.snapshotId).toBeNull();
    expect(result.eventsReplayed).toBe(3);
    expect(result.stateHash).toBe(expectedLiveHash);
    expect(result.hashParityMatched).toBe(true);
  });
});
