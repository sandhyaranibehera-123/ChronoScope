import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import {
  InMemoryAggregateRepository,
  InMemoryExecutionManager,
  InMemoryScenarioInputManager,
  InMemorySnapshotMetadataManager,
} from '@chronoscope/database';
import {
  LiveReplayService,
  CounterfactualReplayService,
  AuthoritativeStateResolver,
  SnapshotManager,
  InMemorySnapshotStorage,
  ReplayWorkerGrpcClient,
} from '@chronoscope/replay-engine';
import { createReplayWorkerServer, type ReplayWorkerServer } from '../server.js';
import { ReplayWorkerServiceImpl } from '../service.js';

describe('Replay Worker gRPC Extraction (Rule 19 & ADR-011)', () => {
  let server: ReplayWorkerServer;
  let client: ReplayWorkerGrpcClient;
  let boundPort: number;

  const timelineId = '00000000-0000-0000-0000-000000000001';
  const aggregateId = 'ord-grpc-1';

  beforeAll(async () => {
    const repo = new InMemoryAggregateRepository<{ status: string }>('Order');
    const executionManager = new InMemoryExecutionManager();
    const scenarioInputManager = new InMemoryScenarioInputManager();
    const snapshotStorage = new InMemorySnapshotStorage();
    const snapshotMetadataManager = new InMemorySnapshotMetadataManager();

    const eventReader = {
      loadEventsForAggregate: async (tId: string, aId: string, maxSeq?: number) => {
        const events = repo.getEvents(tId, aId);
        return events
          .filter((e) => maxSeq === undefined || e.aggregateSequence <= maxSeq)
          .map((se) => ({
            event_id: se.eventId,
            timeline_id: se.timelineId,
            timeline_position: se.timelinePosition,
            aggregate_id: se.aggregateId,
            aggregate_type: se.aggregateType,
            aggregate_sequence: se.aggregateSequence,
            event_type: se.eventType,
            schema_version: se.schemaVersion,
            payload: se.payload,
            event_hash: se.eventHash,
            causation_id: se.causationId,
            correlation_id: se.correlationId,
            recorded_at: se.recordedAt,
          }));
      },
    };

    const stateResolver = new AuthoritativeStateResolver(eventReader);
    const snapshotManager = new SnapshotManager(
      snapshotMetadataManager,
      snapshotStorage,
      stateResolver,
    );

    // Seed events into repository
    await repo.save(
      timelineId,
      aggregateId,
      0,
      [
        {
          event_id: 'evt-g1',
          timeline_id: timelineId,
          aggregate_id: aggregateId,
          aggregate_type: 'Order',
          aggregate_sequence: 1,
          event_type: 'OrderCreated',
          schema_version: 1,
          payload: { customerId: 'cust-g1' },
          event_hash: '1'.repeat(64),
          causation_id: null,
          correlation_id: 'corr-g1',
          recorded_at: new Date().toISOString(),
        },
        {
          event_id: 'evt-g2',
          timeline_id: timelineId,
          aggregate_id: aggregateId,
          aggregate_type: 'Order',
          aggregate_sequence: 2,
          event_type: 'OrderConfirmed',
          schema_version: 1,
          payload: { totalAmountMinor: 5000 },
          event_hash: '2'.repeat(64),
          causation_id: 'evt-g1',
          correlation_id: 'corr-g1',
          recorded_at: new Date().toISOString(),
        },
      ],
      { status: 'CONFIRMED' },
      'expected-state-hash-g1',
    );

    const liveStateProvider = {
      getLiveState: async (tId: string, aId: string) => {
        const row = await repo.load(tId, aId);
        if (!row) return null;
        return {
          sequence: row.sequence,
          state: row.state,
          stateHash: row.stateHash,
        };
      },
    };

    const liveReplayService = new LiveReplayService(
      eventReader,
      executionManager,
      snapshotManager,
      liveStateProvider,
    );

    const counterfactualReplayService = new CounterfactualReplayService(
      eventReader,
      executionManager,
      scenarioInputManager,
      liveStateProvider,
    );

    const service = new ReplayWorkerServiceImpl(liveReplayService, counterfactualReplayService);

    // Bind to ephemeral port 0
    server = createReplayWorkerServer(service);
    boundPort = await server.start(0);

    client = new ReplayWorkerGrpcClient({
      address: `127.0.0.1:${boundPort}`,
      defaultTimeoutMs: 3000,
      directHandler: service,
    });
  });

  afterAll(async () => {
    client?.close();
    await server?.stop();
  });

  it('checks gRPC service health returning SERVING', async () => {
    const health = await client.checkHealth();
    expect(health.status).toBe('SERVING');
  });

  it('synchronously executes LIVE_REPLAY over gRPC returning execution summary and state hash (Rule 19)', async () => {
    const response = await client.executeReplay(
      {
        timelineId,
        aggregateId,
        aggregateType: 'Order',
        mode: 'LIVE_REPLAY',
        useSnapshot: false,
      },
      {
        correlationId: 'corr-grpc-test-1',
        requestId: 'req-grpc-test-1',
      },
    );

    expect(response.executionId).toBeDefined();
    expect(response.mode).toBe('LIVE_REPLAY');
    expect(response.eventsReplayed).toBe(2);
    expect(response.stateHash).toHaveLength(64);
    expect(response.summary).toContain('Live replay executed');
  });

  it('enforces gRPC deadlines when timeout is exceeded', async () => {
    // Calling with an impossibly small deadline (e.g. 0 or 1ms)
    await expect(
      client.executeReplay(
        {
          timelineId,
          aggregateId,
          aggregateType: 'Order',
          mode: 'LIVE_REPLAY',
          useSnapshot: false,
        },
        { timeoutMs: 0 },
      ),
    ).rejects.toThrow();
  });
});
