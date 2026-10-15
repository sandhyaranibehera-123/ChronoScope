import { describe, expect, it } from 'vitest';
import { buildServer } from '../server.js';
import { type DomainEvent, computeStateHash, orderReducer } from '@chronoscope/domain';
import { InMemorySnapshotMetadataManager, InMemoryExecutionManager } from '@chronoscope/database';
import {
  InMemoryEventReader,
  AuthoritativeStateResolver,
  InMemorySnapshotStorage,
  SnapshotManager,
  LiveReplayService,
} from '@chronoscope/replay-engine';

describe('API — Replay & Snapshot Routes (Phase 6, Rules 9, 11, 14)', () => {
  const timelineId = '00000000-0000-0000-0000-000000000001';
  const aggregateId = 'order-api-test-1';

  const events: DomainEvent[] = [
    {
      event_id: 'evt-api-1',
      timeline_id: timelineId,
      aggregate_id: aggregateId,
      aggregate_type: 'Order',
      aggregate_sequence: 1,
      event_type: 'OrderCreated',
      schema_version: 1,
      payload: { customer_id: 'cust-1', currency: 'INR' },
      event_hash: 'hash-api-1',
      causation_id: null,
      correlation_id: 'corr-api-1',
      recorded_at: '2025-01-01T10:00:00.000Z',
    },
    {
      event_id: 'evt-api-2',
      timeline_id: timelineId,
      aggregate_id: aggregateId,
      aggregate_type: 'Order',
      aggregate_sequence: 2,
      event_type: 'OrderItemAdded',
      schema_version: 1,
      payload: {
        item: {
          sku: 'SKU-API',
          quantity: 1,
          unitAmountMinor: 50000n,
          totalAmountMinor: 50000n,
        },
      },
      event_hash: 'hash-api-2',
      causation_id: 'evt-api-1',
      correlation_id: 'corr-api-1',
      recorded_at: '2025-01-01T10:01:00.000Z',
    },
  ];

  function setupServices() {
    const eventReader = new InMemoryEventReader(events);
    const executionManager = new InMemoryExecutionManager();
    const metadataManager = new InMemorySnapshotMetadataManager();
    const storage = new InMemorySnapshotStorage();
    const stateResolver = new AuthoritativeStateResolver(eventReader);
    const snapshotManager = new SnapshotManager(metadataManager, storage, stateResolver);

    let state = orderReducer(null, events[0] as never);
    state = orderReducer(state, events[1] as never);
    const liveHash = computeStateHash(state);

    const liveStateProvider = {
      async getLiveState() {
        return {
          sequence: 2,
          state,
          stateHash: liveHash,
        };
      },
    };

    const liveReplayService = new LiveReplayService(
      eventReader,
      executionManager,
      snapshotManager,
      liveStateProvider,
    );

    return {
      executionManager,
      snapshotManager,
      liveReplayService,
      liveHash,
    };
  }

  it('POST /api/v1/replay/live executes deterministic replay and returns 200 with hash parity', async () => {
    const { liveReplayService, executionManager, snapshotManager, liveHash } = setupServices();
    const app = await buildServer({ liveReplayService, executionManager, snapshotManager });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/replay/live',
      payload: {
        timelineId,
        aggregateId,
        aggregateType: 'Order',
        targetSequence: 2,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.executionId).toBeDefined();
    expect(body.eventsReplayed).toBe(2);
    expect(body.hashParityMatched).toBe(true);
    expect(body.stateHash).toBe(liveHash);
    expect(body.liveStateHash).toBe(liveHash);

    // Verify GET /api/v1/executions/:executionId returns the audit record
    const execRes = await app.inject({
      method: 'GET',
      url: `/api/v1/executions/${body.executionId}`,
    });

    expect(execRes.statusCode).toBe(200);
    const execBody = execRes.json();
    expect(execBody.status).toBe('COMPLETED');
    expect(execBody.hashParityMatched).toBe(true);
  });

  it('POST /api/v1/snapshots/aggregate creates snapshot and returns 201', async () => {
    const { liveReplayService, executionManager, snapshotManager } = setupServices();
    const app = await buildServer({ liveReplayService, executionManager, snapshotManager });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/snapshots/aggregate',
      payload: {
        timelineId,
        aggregateId,
        targetSequence: 2,
        aggregateType: 'Order',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.snapshotId).toBeDefined();
    expect(body.status).toBe('READY');
    expect(body.aggregateSequence).toBe(2);
    expect(body.contentHash).toBeDefined();

    // Verify GET /api/v1/snapshots/:snapshotId
    const getRes = await app.inject({
      method: 'GET',
      url: `/api/v1/snapshots/${body.snapshotId}`,
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().snapshotId).toBe(body.snapshotId);
  });
});
