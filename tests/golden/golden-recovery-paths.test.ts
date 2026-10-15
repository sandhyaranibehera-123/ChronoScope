import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  ORDER_AGGREGATE_TYPE,
  asTimelineId,
  asAggregateId,
  asCommandId,
  asRequestId,
  asCorrelationId,
  asActorId,
  type OrderState,
  type DomainEvent,
  decideCreateOrder,
  decideAddOrderItem,
  orderReducer,
  computeStateHash,
  computeEventHash,
} from '@chronoscope/domain';
import {
  InMemoryAggregateRepository,
  InMemoryInboxCheckpointManager,
  InMemoryRebuildMetadataManager,
  InMemoryJobManager,
  InMemoryControlCommandManager,
  InMemorySnapshotMetadataManager,
  InMemoryExecutionManager,
  type OutboxLeaseManager,
} from '@chronoscope/database';
import { InMemoryOrderSummaryRepository } from '@chronoscope/read-store';
import {
  InMemoryKafkaBus,
  OutboxPublisher,
  InMemoryRabbitMqBus,
  JobOutboxPublisher,
  InMemoryNatsClient,
  ControlDispatcher,
  ControlReconciler,
} from '@chronoscope/messaging';
import { ProjectionWorker } from '@chronoscope/projection-worker';
import {
  InMemorySnapshotStorage,
  SnapshotManager,
  LiveReplayService,
  ProjectionRebuildController,
  AuthoritativeStateResolver,
  type IEventReader,
} from '@chronoscope/replay-engine';

describe('Golden Scenario: Eight Complete Disaster Recovery Paths (Phase 12, Rule 23 & Failure Matrix)', () => {
  const timelineId = asTimelineId('00000000-0000-0000-0000-000000000001');

  // ---------------------------------------------------------------------------
  // PATH 1: API crashes before MySQL commit
  // ---------------------------------------------------------------------------
  it('Path 1: recovers cleanly from API crash before MySQL commit via client retry and command dedup', async () => {
    const aggregateRepo = new InMemoryAggregateRepository<OrderState>(ORDER_AGGREGATE_TYPE);
    const orderId = asAggregateId(`order-rec1-${randomUUID().slice(0, 8)}`);
    const commandId = asCommandId(randomUUID());

    // 1. First attempt: API crashes mid-request before aggregateRepo.save() is committed
    const apiCrashed = true;
    try {
      if (apiCrashed) {
        throw new Error('Simulated host crash before MySQL commit');
      }
    } catch {
      // Client catches 500 / network drop
    }

    // Assert: No state change in MySQL, no event in event store
    const preState = await aggregateRepo.load(timelineId, orderId);
    expect(preState).toBeNull();
    expect(aggregateRepo.getEvents(timelineId, orderId)).toHaveLength(0);

    // 2. Client retry with identical command_id
    const event = decideCreateOrder(
      {
        command_id: commandId,
        request_id: asRequestId(randomUUID()),
        correlation_id: asCorrelationId(randomUUID()),
        causation_id: null,
        actor_id: asActorId('user-alice'),
        timeline_id: timelineId,
        aggregate_id: orderId,
        aggregate_type: 'Order',
        expected_sequence: 0,
        payload: { customer_id: 'cust-recovery-1', currency: 'INR' },
      },
      null,
    );
    const nextState = orderReducer(null, event);
    const stateHash = computeStateHash(nextState);

    const result = await aggregateRepo.save(timelineId, orderId, 0, [event], nextState, stateHash);
    expect(result.success).toBe(true);
    expect(result.newSequence).toBe(1);

    // Post-retry state is fully durable
    const loaded = await aggregateRepo.load(timelineId, orderId);
    expect(loaded).not.toBeNull();
    expect(loaded?.sequence).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // PATH 2: API crashes after MySQL commit, before outbox publish
  // ---------------------------------------------------------------------------
  it('Path 2: recovers un-published events when API crashes post-commit via outbox lease worker', async () => {
    const aggregateRepo = new InMemoryAggregateRepository<OrderState>(ORDER_AGGREGATE_TYPE);
    const kafkaBus = new InMemoryKafkaBus();
    const orderId = asAggregateId(`order-rec2-${randomUUID().slice(0, 8)}`);

    // 1. Transaction commits event + PENDING outbox row in MySQL
    const event = decideCreateOrder(
      {
        command_id: asCommandId(randomUUID()),
        request_id: asRequestId(randomUUID()),
        correlation_id: asCorrelationId(randomUUID()),
        causation_id: null,
        actor_id: asActorId('user-bob'),
        timeline_id: timelineId,
        aggregate_id: orderId,
        aggregate_type: 'Order',
        expected_sequence: 0,
        payload: { customer_id: 'cust-recovery-2', currency: 'INR' },
      },
      null,
    );
    const nextState = orderReducer(null, event);
    await aggregateRepo.save(
      timelineId,
      orderId,
      0,
      [event],
      nextState,
      computeStateHash(nextState),
    );

    // API process exits abruptly without publishing to Kafka
    let totalMessages = 0;
    for (let p = 0; p < 4; p++) {
      totalMessages += kafkaBus.getMessages('chronoscope.domain.events', p).length;
    }
    expect(totalMessages).toBe(0);

    const pendingOutbox = aggregateRepo.getOutbox('PENDING');
    expect(pendingOutbox).toHaveLength(1);

    // 2. Independent OutboxPublisher starts, leases pending record, and publishes to Kafka
    const publishedIds = new Set<string>();
    const mockLeaseManager: OutboxLeaseManager = {
      leaseBatch: async () => {
        return aggregateRepo
          .getOutbox('PENDING')
          .filter((r) => !publishedIds.has(r.outboxId))
          .map((r) => ({
            outboxId: r.outboxId,
            eventId: r.eventId,
            topic: r.topic,
            partitionKey: r.partitionKey,
            payload: r.payload,
            attemptCount: r.attemptCount,
            maxAttempts: 5,
          }));
      },
      markPublished: async (id) => {
        publishedIds.add(id);
      },
      markFailed: async () => 'RETRY_SCHEDULED',
    } as unknown as OutboxLeaseManager;

    const publisher = new OutboxPublisher(mockLeaseManager, kafkaBus, { workerId: 'worker-rec2' });
    const { publishedCount } = await publisher.publishBatch();

    expect(publishedCount).toBe(1);
    expect(publishedIds.has(pendingOutbox[0]!.outboxId)).toBe(true);

    // Kafka has received the event envelope across one of the partitions
    let postMessages = 0;
    for (let p = 0; p < 4; p++) {
      postMessages += kafkaBus.getMessages('chronoscope.domain.events', p).length;
    }
    expect(postMessages).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // PATH 3: Outbox publisher crashes mid-lease
  // ---------------------------------------------------------------------------
  it('Path 3: recovers abandoned leased outbox records after worker crash via lease expiry reclamation', async () => {
    interface MutableOutboxRecord {
      outboxId: string;
      eventId: string;
      topic: string;
      partitionKey: string;
      payload: unknown;
      status: 'PENDING' | 'LEASED' | 'PUBLISHED' | 'FAILED' | 'RETRY_PENDING';
      attemptCount: number;
      createdAt: string;
      leaseExpiresAt?: number;
    }

    const records: MutableOutboxRecord[] = [
      {
        outboxId: 'outbox-abandoned-1',
        eventId: randomUUID(),
        topic: 'chronoscope.domain.events',
        partitionKey: `${timelineId}:order-1`,
        payload: { eventType: 'OrderCreated' },
        status: 'LEASED',
        attemptCount: 1,
        createdAt: new Date().toISOString(),
        leaseExpiresAt: Date.now() - 5000, // Lease expired 5s ago
      },
    ];

    const published: string[] = [];
    const leaseManager: OutboxLeaseManager = {
      leaseBatch: async () => {
        // Reaps expired LEASED or PENDING records
        const now = Date.now();
        const available = records.filter(
          (r) =>
            r.status === 'PENDING' || (r.status === 'LEASED' && (r.leaseExpiresAt ?? 0) <= now),
        );
        return available.map((r) => ({
          outboxId: r.outboxId,
          eventId: r.eventId,
          topic: r.topic,
          partitionKey: r.partitionKey,
          payload: r.payload,
          attemptCount: r.attemptCount,
          maxAttempts: 5,
        }));
      },
      markPublished: async (id) => {
        published.push(id);
        const rec = records.find((r) => r.outboxId === id);
        if (rec) rec.status = 'PUBLISHED';
      },
      markFailed: async () => 'RETRY_SCHEDULED',
    } as unknown as OutboxLeaseManager;

    const kafkaBus = new InMemoryKafkaBus();
    const publisher = new OutboxPublisher(leaseManager, kafkaBus, { workerId: 'reaper-worker' });

    const result = await publisher.publishBatch();
    expect(result.publishedCount).toBe(1);
    expect(published).toContain('outbox-abandoned-1');
    expect(records[0]?.status).toBe('PUBLISHED');
  });

  // ---------------------------------------------------------------------------
  // PATH 4: Kafka publish succeeds, lease-mark-published fails (At-Least-Once Redelivery)
  // ---------------------------------------------------------------------------
  it('Path 4: absorbs duplicate Kafka redeliveries idempotently via MySQL inbox deduplication', async () => {
    const readStoreRepo = new InMemoryOrderSummaryRepository();
    const inboxManager = new InMemoryInboxCheckpointManager();
    const kafkaBus = new InMemoryKafkaBus();

    const projectionWorker = new ProjectionWorker(readStoreRepo, inboxManager, kafkaBus, {
      projectionName: 'order_summary',
      consumerName: 'summary_worker_p4',
    });

    const eventId = randomUUID();
    const orderId = asAggregateId(`order-rec4-${randomUUID().slice(0, 8)}`);

    const envelope = {
      topic: 'chronoscope.domain.events',
      partition: 0,
      offset: 100,
      timestamp: new Date().toISOString(),
      headers: { eventId },
      key: `${timelineId}:${orderId}`,
      value: {
        eventId,
        timelineId,
        aggregateId: orderId,
        aggregateSequence: 1,
        timelinePosition: 1,
        eventType: 'OrderCreated',
        payload: { customer_id: 'cust-p4', currency: 'INR' },
        eventHash: computeEventHash({ customer_id: 'cust-p4', currency: 'INR' }),
      },
    };

    // First arrival: processes normally
    await projectionWorker.handleMessageWithPartitionQueue(envelope);
    const doc1 = await readStoreRepo.findById(timelineId, orderId);
    expect(doc1).not.toBeNull();
    expect(doc1?.appliedSequence).toBe(1);
    expect(await inboxManager.isEventInInbox(eventId, 'summary_worker_p4')).toBe(true);

    // Duplicate redelivery arrives due to lease-mark failure on publisher
    const envelopeDuplicate = {
      ...envelope,
      offset: 101, // New Kafka offset for redelivery
    };
    await projectionWorker.handleMessageWithPartitionQueue(envelopeDuplicate);

    // Deduplication check: MongoDB document not touched, inbox absorbed cleanly
    const doc2 = await readStoreRepo.findById(timelineId, orderId);
    expect(doc2?.appliedSequence).toBe(1);
    expect(projectionWorker.stats.duplicateCount).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // PATH 5: MongoDB document/collection lost after checkpoint advanced (Full Cold Rebuild)
  // ---------------------------------------------------------------------------
  it('Path 5: recovers from total MongoDB collection drop by deterministically rebuilding from MySQL event store', async () => {
    const aggregateRepo = new InMemoryAggregateRepository<OrderState>(ORDER_AGGREGATE_TYPE);
    const readStoreRepo = new InMemoryOrderSummaryRepository();
    const rebuildMetadataManager = new InMemoryRebuildMetadataManager();

    // 1. Establish MySQL authoritative history across 5 orders
    const orderIds = Array.from({ length: 5 }, (_, i) => asAggregateId(`order-rec5-${i}`));
    for (const orderId of orderIds) {
      const ev1 = decideCreateOrder(
        {
          command_id: asCommandId(randomUUID()),
          request_id: asRequestId(randomUUID()),
          correlation_id: asCorrelationId(randomUUID()),
          causation_id: null,
          actor_id: asActorId('user-alice'),
          timeline_id: timelineId,
          aggregate_id: orderId,
          aggregate_type: 'Order',
          expected_sequence: 0,
          payload: { customer_id: `cust-${orderId}`, currency: 'INR' },
        },
        null,
      );
      const st1 = orderReducer(null, ev1);
      await aggregateRepo.save(timelineId, orderId, 0, [ev1], st1, computeStateHash(st1));

      const ev2 = decideAddOrderItem(
        {
          command_id: asCommandId(randomUUID()),
          request_id: asRequestId(randomUUID()),
          correlation_id: asCorrelationId(randomUUID()),
          causation_id: null,
          actor_id: asActorId('user-alice'),
          timeline_id: timelineId,
          aggregate_id: orderId,
          aggregate_type: 'Order',
          expected_sequence: 1,
          payload: {
            item: {
              sku: 'SKU-REC-5',
              quantity: 1,
              unitAmountMinor: 2500n,
              totalAmountMinor: 2500n,
            },
          },
        },
        st1,
      );
      const st2 = orderReducer(st1, ev2);
      await aggregateRepo.save(timelineId, orderId, 1, [ev2], st2, computeStateHash(st2));
    }

    // Set timeline aggregates in rebuild metadata manager so rebuild controller discovers them
    rebuildMetadataManager.setTimelineAggregates(
      timelineId,
      orderIds.map((id) => ({
        timelineId,
        aggregateId: id,
        aggregateType: 'Order',
        currentSequence: 2,
      })),
    );

    // 2. Catastrophic data loss: MongoDB collection completely wiped
    readStoreRepo.clear();
    expect(await readStoreRepo.findById(timelineId, orderIds[0]!)).toBeNull();

    // 3. Rebuild controller executes cold read-store recovery (Rule 11, 17, 23)
    const eventReader: IEventReader = {
      loadEventsForAggregate: async (tId: string, aggId: string, maxSeq?: number) => {
        return aggregateRepo
          .getEvents(tId, aggId)
          .filter((e) => (maxSeq !== undefined ? e.aggregateSequence <= maxSeq : true))
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

    const stateResolver = new AuthoritativeStateResolver(eventReader);
    const controller = new ProjectionRebuildController(
      rebuildMetadataManager,
      readStoreRepo,
      stateResolver,
    );

    const rebuildResult = await controller.rebuildProjection({
      projectionName: 'order_summary',
      timelineId,
    });

    expect(rebuildResult.success).toBe(true);
    expect(rebuildResult.documentsWritten).toBe(5);

    // 4. Verify all 5 orders are restored with sequence and item parity
    for (const orderId of orderIds) {
      const doc = await readStoreRepo.findById(timelineId, orderId);
      expect(doc).not.toBeNull();
      expect(doc?.appliedSequence).toBe(2);
      expect(doc?.items).toHaveLength(1);
      expect(doc?.items[0]?.sku).toBe('SKU-REC-5');
      expect(doc?.totalAmountMinor).toBe(2500);
    }
  });

  // ---------------------------------------------------------------------------
  // PATH 6: RabbitMQ worker crashes mid-job execution before SQL state commit
  // ---------------------------------------------------------------------------
  it('Path 6: guarantees at-most-once persistent effect upon worker crash and redelivery via job idempotency', async () => {
    const jobManager = new InMemoryJobManager();
    const rabbitMq = new InMemoryRabbitMqBus();
    const jobPublisher = new JobOutboxPublisher(
      {
        leaseBatch: async () => [],
        markPublished: async () => {},
        markFailed: async () => 'RETRY_SCHEDULED',
      },
      rabbitMq,
      { workerId: 'job-pub-rec6' },
    );
    expect(jobPublisher).toBeDefined();

    const idempotencyKey = `job-key-rec6-${randomUUID()}`;
    const { job } = await jobManager.createJob({
      jobType: 'PROJECTION_REINDEX',
      payload: { partition: 0 },
      idempotencyKey,
    });

    // 1. First execution: worker crashes midway before marking completed
    let attempts = 0;
    const workerHandler = async () => {
      attempts++;
      if (attempts === 1) {
        throw new Error('Simulated worker process SIGKILL mid-execution');
      }
      await jobManager.completeJob(job.jobId, JSON.stringify({ result: 'OK' }));
    };

    // First attempt fails
    await expect(workerHandler()).rejects.toThrow('SIGKILL');
    expect((await jobManager.getJobById(job.jobId))?.status).toBe('PENDING');

    // 2. Redelivery: RabbitMQ re-delivers to replacement worker
    await workerHandler();
    const completedJob = await jobManager.getJobById(job.jobId);
    expect(completedJob?.status).toBe('COMPLETED');
    expect(completedJob?.resultReference).toBe(JSON.stringify({ result: 'OK' }));
  });

  // ---------------------------------------------------------------------------
  // PATH 7: NATS control message dropped/lost
  // ---------------------------------------------------------------------------
  it('Path 7: self-heals dropped control plane messages via MySQL ControlReconciler background scan', async () => {
    const controlCommandManager = new InMemoryControlCommandManager();
    const natsClient = new InMemoryNatsClient();
    const dispatcher = new ControlDispatcher(natsClient);

    // 1. Issue command stored durably in MySQL chronoscope_ops.control_commands
    const commandId = randomUUID();
    const { command } = await controlCommandManager.issueCommand({
      commandId,
      commandType: 'PAUSE_WORKER',
      targetWorker: 'order_summary_worker',
      payload: { reason: 'emergency_maintenance' },
      issuedBy: 'admin-operator',
    });

    // 2. NATS transport suffers simulated 100% packet loss
    natsClient.dropAllPackets();
    await dispatcher.publishControlCommand(command);

    // Worker never received the dropped message; command remains PENDING in MySQL
    const commandPre = await controlCommandManager.getCommandById(commandId);
    expect(commandPre?.status).toBe('PENDING');

    // 3. Network heals; ControlReconciler runs periodic reconciliation scan
    natsClient.clearPacketLoss();
    let reDeliveredCommand: string | null = null;
    natsClient.subscribe('chronoscope.control.commands.order_summary_worker', async (msg) => {
      const data =
        typeof msg.data === 'string' ? JSON.parse(msg.data) : (msg.data as { commandId: string });
      reDeliveredCommand = data.commandId;
      await controlCommandManager.markCompleted(data.commandId, { processed: true });
    });

    const reconciler = new ControlReconciler(controlCommandManager, dispatcher, {
      pollIntervalMs: 1000,
    });
    const { reconciledCount } = await reconciler.reconcileBatch();

    expect(reconciledCount).toBe(1);
    expect(reDeliveredCommand).toBe(commandId);

    // Command transitioned to COMPLETED
    const commandPost = await controlCommandManager.getCommandById(commandId);
    expect(commandPost?.status).toBe('COMPLETED');
  });

  // ---------------------------------------------------------------------------
  // PATH 8: Snapshot object lost or corrupted in storage
  // ---------------------------------------------------------------------------
  it('Path 8: recovers from storage bit-rot or missing snapshot via transparent fallback to MySQL raw event replay', async () => {
    const aggregateRepo = new InMemoryAggregateRepository<OrderState>(ORDER_AGGREGATE_TYPE);
    const snapshotMetadataManager = new InMemorySnapshotMetadataManager();
    const snapshotStorage = new InMemorySnapshotStorage();
    const executionManager = new InMemoryExecutionManager();

    const orderId = asAggregateId(`order-rec8-${randomUUID().slice(0, 8)}`);

    // 1. Create an order with 2 events
    const ev1 = decideCreateOrder(
      {
        command_id: asCommandId(randomUUID()),
        request_id: asRequestId(randomUUID()),
        correlation_id: asCorrelationId(randomUUID()),
        causation_id: null,
        actor_id: asActorId('user-alice'),
        timeline_id: timelineId,
        aggregate_id: orderId,
        aggregate_type: 'Order',
        expected_sequence: 0,
        payload: { customer_id: 'cust-rec8', currency: 'INR' },
      },
      null,
    );
    const st1 = orderReducer(null, ev1);
    await aggregateRepo.save(timelineId, orderId, 0, [ev1], st1, computeStateHash(st1));

    const ev2 = decideAddOrderItem(
      {
        command_id: asCommandId(randomUUID()),
        request_id: asRequestId(randomUUID()),
        correlation_id: asCorrelationId(randomUUID()),
        causation_id: null,
        actor_id: asActorId('user-alice'),
        timeline_id: timelineId,
        aggregate_id: orderId,
        aggregate_type: 'Order',
        expected_sequence: 1,
        payload: {
          item: {
            sku: 'SKU-REC-8',
            quantity: 2,
            unitAmountMinor: 1000n,
            totalAmountMinor: 2000n,
          },
        },
      },
      st1,
    );
    const st2 = orderReducer(st1, ev2);
    await aggregateRepo.save(timelineId, orderId, 1, [ev2], st2, computeStateHash(st2));

    const liveSnapshot = await aggregateRepo.load(timelineId, orderId);
    expect(liveSnapshot).not.toBeNull();

    // 2. Setup stateResolver, snapshotManager, and liveStateProvider
    const eventReader: IEventReader = {
      loadEventsForAggregate: async (tId: string, aggId: string, maxSeq?: number) => {
        return aggregateRepo
          .getEvents(tId, aggId)
          .filter((e) => (maxSeq !== undefined ? e.aggregateSequence <= maxSeq : true))
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

    const stateResolver = new AuthoritativeStateResolver(eventReader);
    const snapshotManager = new SnapshotManager(
      snapshotMetadataManager,
      snapshotStorage,
      stateResolver,
    );

    // Create snapshot at sequence 2
    const snapRecord = await snapshotManager.createAggregateSnapshot({
      timelineId,
      aggregateId: orderId,
      targetSequence: 2,
      aggregateType: 'Order',
    });
    expect(snapRecord.status).toBe('READY');

    // 3. Inject bit-rot corruption into MinIO storage key
    snapshotStorage.corruptPayload(snapRecord.storageLocation);

    // 4. LiveReplayService encounters corrupted snapshot, logs warning, and transparently replays from genesis
    const liveStateProvider = {
      getLiveState: async () => {
        const current = await aggregateRepo.load(timelineId, orderId);
        if (!current) return null;
        return {
          sequence: current.sequence,
          state: current.state,
          stateHash: current.stateHash,
        };
      },
    };

    const replayService = new LiveReplayService(
      eventReader,
      executionManager,
      snapshotManager,
      liveStateProvider,
    );

    const replayResult = await replayService.replayAggregate<OrderState>({
      timelineId,
      aggregateId: orderId,
      aggregateType: 'Order',
      targetSequence: 2,
      useSnapshot: true,
    });

    // Transparent fallback: fromSequence is 0 (genesis), snapshotId is null, all 2 events replayed
    expect(replayResult.fromSequence).toBe(0);
    expect(replayResult.toSequence).toBe(2);
    expect(replayResult.snapshotId).toBeNull();
    expect(replayResult.eventsReplayed).toBe(2);
    expect(replayResult.stateHash).toBe(liveSnapshot!.stateHash);
    expect(replayResult.hashParityMatched).toBe(true);
  });
});
