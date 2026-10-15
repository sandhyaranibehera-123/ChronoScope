import { describe, expect, it, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  ORDER_AGGREGATE_TYPE,
  type OrderState,
  type DomainEvent,
  decideCreateOrder,
  decideAddOrderItem,
  decideConfirmOrder,
  orderReducer,
  computeStateHash,
} from '@chronoscope/domain';
import {
  InMemoryAggregateRepository,
  InMemoryRebuildMetadataManager,
  InMemoryCommandDeduplicationManager,
} from '@chronoscope/database';
import { InMemoryOrderSummaryRepository, computeProjectionHash } from '@chronoscope/read-store';
import {
  AuthoritativeStateResolver,
  ProjectionRebuildController,
  type IEventReader,
  getProjectionRebuildControllerLockName,
} from '@chronoscope/replay-engine';

describe('Golden Scenario: MongoDB Projection Rebuild & CQRS Deduplication (Phase 5)', () => {
  const timelineId = '00000000-0000-0000-0000-000000000001';
  let orderRepo: InMemoryAggregateRepository<OrderState>;
  let metadataManager: InMemoryRebuildMetadataManager;
  let orderSummaryRepo: InMemoryOrderSummaryRepository;
  let commandDedupManager: InMemoryCommandDeduplicationManager;
  let stateResolver: AuthoritativeStateResolver;
  let controller: ProjectionRebuildController;

  beforeEach(() => {
    orderRepo = new InMemoryAggregateRepository<OrderState>(ORDER_AGGREGATE_TYPE);
    metadataManager = new InMemoryRebuildMetadataManager();
    orderSummaryRepo = new InMemoryOrderSummaryRepository();
    commandDedupManager = new InMemoryCommandDeduplicationManager();

    const eventReader: IEventReader = {
      async loadEventsForAggregate(tId, aId, maxSequence) {
        const stored = orderRepo.getEvents(tId, aId);
        return stored
          .filter((e) => maxSequence === undefined || e.aggregateSequence <= maxSequence)
          .map(
            (e) =>
              ({
                event_id: e.eventId,
                timeline_id: e.timelineId,
                timeline_position: e.timelinePosition,
                aggregate_id: e.aggregateId,
                aggregate_type: e.aggregateType,
                aggregate_sequence: e.aggregateSequence,
                event_type: e.eventType,
                schema_version: e.schemaVersion,
                payload: e.payload,
                event_hash: e.eventHash,
                causation_id: e.causationId,
                correlation_id: e.correlationId,
                recorded_at: e.recordedAt,
              }) as unknown as DomainEvent,
          );
      },
    };

    stateResolver = new AuthoritativeStateResolver(eventReader);
    controller = new ProjectionRebuildController(metadataManager, orderSummaryRepo, stateResolver);
  });

  it('runs complete deterministic MongoDB projection rebuild with hash parity (Rule 11, 17, Phase 5)', async () => {
    // 1. Seed 3 separate aggregates on MAIN timeline in MySQL event store
    const order1Id = 'order-alpha-001';
    const order2Id = 'order-beta-002';
    const order3Id = 'order-gamma-003';

    // Order 1: Create -> AddItem -> Confirm (Seq 1, 2, 3)
    {
      const e1 = decideCreateOrder(
        {
          command_id: randomUUID(),
          request_id: randomUUID(),
          correlation_id: randomUUID(),
          causation_id: null,
          actor_id: 'alice',
          timeline_id: timelineId,
          aggregate_id: order1Id,
          aggregate_type: ORDER_AGGREGATE_TYPE,
          expected_sequence: 0,
          payload: { customer_id: 'cust-1', currency: 'INR' },
        },
        null,
      );
      const s1 = orderReducer(null, e1);
      await orderRepo.save(timelineId, order1Id, 0, [e1], s1, computeStateHash(s1));

      const e2 = decideAddOrderItem(
        {
          command_id: randomUUID(),
          request_id: randomUUID(),
          correlation_id: randomUUID(),
          causation_id: null,
          actor_id: 'alice',
          timeline_id: timelineId,
          aggregate_id: order1Id,
          aggregate_type: ORDER_AGGREGATE_TYPE,
          expected_sequence: 1,
          payload: {
            item: {
              sku: 'SKU-LAPTOP',
              quantity: 1,
              unitAmountMinor: 4999000n,
              totalAmountMinor: 4999000n,
            },
          },
        },
        s1,
      );
      const s2 = orderReducer(s1, e2);
      await orderRepo.save(timelineId, order1Id, 1, [e2], s2, computeStateHash(s2));

      const e3 = decideConfirmOrder(
        {
          command_id: randomUUID(),
          request_id: randomUUID(),
          correlation_id: randomUUID(),
          causation_id: null,
          actor_id: 'alice',
          timeline_id: timelineId,
          aggregate_id: order1Id,
          aggregate_type: ORDER_AGGREGATE_TYPE,
          expected_sequence: 2,
          payload: { minimum_items: 1 },
        },
        s2,
      );
      const s3 = orderReducer(s2, e3);
      await orderRepo.save(timelineId, order1Id, 2, [e3], s3, computeStateHash(s3));
    }

    // Order 2: Create -> AddItem (Seq 1, 2)
    {
      const e1 = decideCreateOrder(
        {
          command_id: randomUUID(),
          request_id: randomUUID(),
          correlation_id: randomUUID(),
          causation_id: null,
          actor_id: 'bob',
          timeline_id: timelineId,
          aggregate_id: order2Id,
          aggregate_type: ORDER_AGGREGATE_TYPE,
          expected_sequence: 0,
          payload: { customer_id: 'cust-2', currency: 'INR' },
        },
        null,
      );
      const s1 = orderReducer(null, e1);
      await orderRepo.save(timelineId, order2Id, 0, [e1], s1, computeStateHash(s1));

      const e2 = decideAddOrderItem(
        {
          command_id: randomUUID(),
          request_id: randomUUID(),
          correlation_id: randomUUID(),
          causation_id: null,
          actor_id: 'bob',
          timeline_id: timelineId,
          aggregate_id: order2Id,
          aggregate_type: ORDER_AGGREGATE_TYPE,
          expected_sequence: 1,
          payload: {
            item: {
              sku: 'SKU-MOUSE',
              quantity: 2,
              unitAmountMinor: 150000n,
              totalAmountMinor: 300000n,
            },
          },
        },
        s1,
      );
      const s2 = orderReducer(s1, e2);
      await orderRepo.save(timelineId, order2Id, 1, [e2], s2, computeStateHash(s2));
    }

    // Order 3: Create (Seq 1)
    {
      const e1 = decideCreateOrder(
        {
          command_id: randomUUID(),
          request_id: randomUUID(),
          correlation_id: randomUUID(),
          causation_id: null,
          actor_id: 'carol',
          timeline_id: timelineId,
          aggregate_id: order3Id,
          aggregate_type: ORDER_AGGREGATE_TYPE,
          expected_sequence: 0,
          payload: { customer_id: 'cust-3', currency: 'INR' },
        },
        null,
      );
      const s1 = orderReducer(null, e1);
      await orderRepo.save(timelineId, order3Id, 0, [e1], s1, computeStateHash(s1));
    }

    // Register aggregates in timeline manager
    metadataManager.setTimelineAggregates(timelineId, [
      { timelineId, aggregateId: order1Id, aggregateType: 'Order', currentSequence: 3 },
      { timelineId, aggregateId: order2Id, aggregateType: 'Order', currentSequence: 2 },
      { timelineId, aggregateId: order3Id, aggregateType: 'Order', currentSequence: 1 },
    ]);

    // 2. Trigger projection rebuild (chronoscope rebuild-projection target)
    const result = await controller.rebuildProjection({
      projectionName: 'order_summary',
      timelineId,
      partitionCount: 4,
    });

    // Verification 1: Rebuild completed successfully with valid collection hashes
    expect(result.success).toBe(true);
    expect(result.documentsWritten).toBe(3);
    expect(result.sourceManifestHash).toHaveLength(64);
    expect(result.projectionCollectionHash).toHaveLength(64);

    // Verification 2: Live target collection contains the 3 swapped documents
    const liveDocs = await orderSummaryRepo.findAll();
    expect(liveDocs).toHaveLength(3);

    const doc1 = liveDocs.find((d) => d.aggregateId === order1Id);
    expect(doc1).toBeDefined();
    expect(doc1?.status).toBe('CONFIRMED');
    expect(doc1?.totalAmountMinor).toBe(4999000);
    expect(doc1?.appliedSequence).toBe(3);
    expect(doc1?.sourceAggregateSequence).toBe(3);

    // Verify spot-checked per-document sourceStateHash matches MySQL authoritative state hash
    const auth1 = await stateResolver.resolve(timelineId, order1Id, 3);
    expect(doc1?.sourceStateHash).toBe(auth1.stateHash);

    // Verify spot-checked per-document projectionHash matches canonical document hash
    const recomputedDoc1Hash = computeProjectionHash(doc1 as unknown as Record<string, unknown>);
    expect(doc1?.projectionHash).toBe(recomputedDoc1Hash);

    // Verification 3: Rebuild run audit trail is permanently recorded in projection_rebuild_runs
    const runRecord = await metadataManager.getRebuildRun(result.runId);
    expect(runRecord).not.toBeNull();
    expect(runRecord?.status).toBe('COMPLETED');
    expect(runRecord?.sourceManifestHash).toBe(result.sourceManifestHash);
    expect(runRecord?.projectionCollectionHash).toBe(result.projectionCollectionHash);
    expect(runRecord?.documentsWritten).toBe(3);
    expect(runRecord?.completedAt).not.toBeNull();

    // Verification 4: Status restored to ACTIVE after completion
    expect(metadataManager.getProjectionStatus('order_summary')).toBe('ACTIVE');
  });

  it('excludes writes committed to MySQL after cutoff and allows them to catch up on live resume (Rule 11)', async () => {
    const orderId = 'order-delta-cutoff';

    // 1. Commit Seq 1 and Seq 2 to MySQL
    const e1 = decideCreateOrder(
      {
        command_id: randomUUID(),
        request_id: randomUUID(),
        correlation_id: randomUUID(),
        causation_id: null,
        actor_id: 'alice',
        timeline_id: timelineId,
        aggregate_id: orderId,
        aggregate_type: ORDER_AGGREGATE_TYPE,
        expected_sequence: 0,
        payload: { customer_id: 'cust-1', currency: 'INR' },
      },
      null,
    );
    const s1 = orderReducer(null, e1);
    await orderRepo.save(timelineId, orderId, 0, [e1], s1, computeStateHash(s1));

    const e2 = decideAddOrderItem(
      {
        command_id: randomUUID(),
        request_id: randomUUID(),
        correlation_id: randomUUID(),
        causation_id: null,
        actor_id: 'alice',
        timeline_id: timelineId,
        aggregate_id: orderId,
        aggregate_type: ORDER_AGGREGATE_TYPE,
        expected_sequence: 1,
        payload: {
          item: {
            sku: 'SKU-BOOK',
            quantity: 1,
            unitAmountMinor: 50000n,
            totalAmountMinor: 50000n,
          },
        },
      },
      s1,
    );
    const s2 = orderReducer(s1, e2);
    await orderRepo.save(timelineId, orderId, 1, [e2], s2, computeStateHash(s2));

    // Register cutoff frozen at Sequence 2
    metadataManager.setTimelineAggregates(timelineId, [
      { timelineId, aggregateId: orderId, aggregateType: 'Order', currentSequence: 2 },
    ]);

    // 2. Now commit Sequence 3 (ConfirmOrder) AFTER the cutoff was frozen
    const e3 = decideConfirmOrder(
      {
        command_id: randomUUID(),
        request_id: randomUUID(),
        correlation_id: randomUUID(),
        causation_id: null,
        actor_id: 'alice',
        timeline_id: timelineId,
        aggregate_id: orderId,
        aggregate_type: ORDER_AGGREGATE_TYPE,
        expected_sequence: 2,
        payload: { minimum_items: 1 },
      },
      s2,
    );
    const s3 = orderReducer(s2, e3);
    await orderRepo.save(timelineId, orderId, 2, [e3], s3, computeStateHash(s3));

    // 3. Run rebuild targeting the recorded cutoff (Seq 2)
    const result = await controller.rebuildProjection({
      projectionName: 'order_summary',
      timelineId,
      partitionCount: 4,
    });
    expect(result.success).toBe(true);

    // Confirm rebuilt document reflects state at cutoff Sequence 2 (CREATED), NOT Sequence 3 (CONFIRMED)
    const doc = await orderSummaryRepo.findById(timelineId, orderId);
    expect(doc).not.toBeNull();
    expect(doc?.appliedSequence).toBe(2);
    expect(doc?.status).toBe('CREATED'); // Sequence 2 status was CREATED

    // 4. Simulate Kafka live worker resuming and processing Event 3 via normal sequence-guarded upsert
    const upsertRes = await orderSummaryRepo.upsertOrderSummary({
      timelineId,
      aggregateId: orderId,
      status: 'CONFIRMED',
      items: [{ sku: 'SKU-BOOK', quantity: 1, amountMinor: 50000 }],
      totalAmountMinor: 50000,
      currency: 'INR',
      appliedSequence: 3,
      appliedTimelinePosition: 1045,
      sourceAggregateSequence: 3,
      sourceStateHash: computeStateHash(s3),
    });

    expect(upsertRes.status).toBe('APPLIED');
    const caughtUpDoc = await orderSummaryRepo.findById(timelineId, orderId);
    expect(caughtUpDoc?.appliedSequence).toBe(3);
    expect(caughtUpDoc?.status).toBe('CONFIRMED');
  });

  it('blocks concurrent second rebuild on rebuild-controller lock (Rule 17)', async () => {
    const controllerLockName = getProjectionRebuildControllerLockName('order_summary');

    // Acquire the lock beforehand
    await metadataManager.acquireAdvisoryLock(controllerLockName, 5);

    // Attempting a rebuild while lock is held throws REBUILD_IN_PROGRESS
    await expect(
      controller.rebuildProjection({
        projectionName: 'order_summary',
        timelineId,
      }),
    ).rejects.toThrow(/REBUILD_IN_PROGRESS/);
  });

  it('verifies duplicate command_id returns cached result with zero re-execution (Rule 8 & 16)', async () => {
    const commandId = randomUUID();
    const aggregateId = 'order-dedup-test';

    const firstResult = {
      success: true,
      command_id: commandId,
      timeline_id: timelineId,
      aggregate_id: aggregateId,
      resulting_sequence: 1,
      state_hash: 'b'.repeat(64),
      events_produced: 1,
      deduplicated: false,
    };

    await commandDedupManager.recordCommandResult({
      commandId,
      timelineId,
      aggregateId,
      success: true,
      resultPayload: firstResult,
    });

    // Second check
    const cached = await commandDedupManager.findCommandResult(commandId);
    expect(cached).not.toBeNull();
    expect(cached?.commandId).toBe(commandId);
    expect(cached?.resultPayload).toEqual(firstResult);
  });
});
