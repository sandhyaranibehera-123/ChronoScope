import { describe, expect, it } from 'vitest';
import {
  InMemoryJobManager,
  InMemoryJobOutboxLeaseManager,
  InMemoryAggregateRepository,
  InMemoryExecutionManager,
  InMemoryScenarioInputManager,
} from '@chronoscope/database';
import { InMemoryRabbitMqBus, JobOutboxPublisher } from '@chronoscope/messaging';
import {
  LiveReplayService,
  CounterfactualReplayService,
  SnapshotManager,
  InMemorySnapshotStorage,
  ReplayWorkerGrpcClient,
} from '@chronoscope/replay-engine';
import { JobWorker } from '../../apps/worker/src/job-worker.js';
import { ReplayWorkerServiceImpl } from '../../apps/replay-worker/src/service.js';

describe('Golden Scenario: RabbitMQ + Jobs + Job_Outbox + gRPC Extraction (Phase 9, Rules 8, 10, 19 & ADR-005, ADR-011)', () => {
  const timelineId = '00000000-0000-0000-0000-000000000001';
  const aggregateId = 'ord-golden-job-1';

  it('runs complete asynchronous job lifecycle: outbox lease -> RabbitMQ delivery -> worker execution -> COMPLETED status (Rules 8 & 10, ADR-005)', async () => {
    const jobManager = new InMemoryJobManager();
    const leaseManager = new InMemoryJobOutboxLeaseManager(jobManager);
    const rabbitBus = new InMemoryRabbitMqBus();

    // 1. Submit asynchronous job transactionally creating job + job_outbox
    const submitResult = await jobManager.createJob({
      jobType: 'PROJECTION_REBUILD',
      idempotencyKey: 'golden-rebuild-order-summary-1',
      payload: { projection: 'order_summary', runId: 'run-golden-1' },
      queueName: 'chronoscope.jobs.projection_rebuild',
    });

    expect(submitResult.isNew).toBe(true);
    expect(submitResult.job.status).toBe('PENDING');
    expect(jobManager.outboxRecords).toHaveLength(1);
    expect(jobManager.outboxRecords[0]!.status).toBe('PENDING');

    // 2. Setup JobWorker with registered handler
    let handlerExecuted = false;
    const worker = new JobWorker(jobManager, rabbitBus, {
      queues: ['chronoscope.jobs.projection_rebuild'],
    });

    worker.registerHandler<{ projection: string; runId: string }>(
      'PROJECTION_REBUILD',
      async (payload, jobId) => {
        handlerExecuted = true;
        expect(payload.projection).toBe('order_summary');
        expect(jobId).toBe(submitResult.job.jobId);
        return `mongodb://chronoscope_read/${payload.projection}#${payload.runId}`;
      },
    );

    await worker.start();

    // 3. Outbox Publisher leases batch using SKIP LOCKED semantics and publishes to RabbitMQ
    const publisher = new JobOutboxPublisher(leaseManager, rabbitBus, {
      workerId: 'golden-publisher-1',
      batchSize: 10,
    });

    const pubResult = await publisher.publishBatch();
    expect(pubResult.publishedCount).toBe(1);
    expect(jobManager.outboxRecords[0]!.status).toBe('PUBLISHED');

    // Allow worker microtask dispatch to process RabbitMQ delivery
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(handlerExecuted).toBe(true);

    // 4. Verify authoritative job state in MySQL (chronoscope_ops.jobs)
    const completedJob = await jobManager.getJobById(submitResult.job.jobId);
    expect(completedJob).not.toBeNull();
    expect(completedJob!.status).toBe('COMPLETED');
    expect(completedJob!.resultReference).toBe(
      'mongodb://chronoscope_read/order_summary#run-golden-1',
    );
    expect(completedJob!.attemptCount).toBe(1);
    expect(completedJob!.completedAt).toBeDefined();

    worker.stop();
  });

  it('demonstrates North-Star recovery: mid-job worker crash & redelivery preserves at-most-once persistent effect (Rule 8)', async () => {
    const jobManager = new InMemoryJobManager();
    const leaseManager = new InMemoryJobOutboxLeaseManager(jobManager);
    const rabbitBus = new InMemoryRabbitMqBus();

    const { job } = await jobManager.createJob({
      jobType: 'EXPORT',
      idempotencyKey: 'export-golden-annual-2026',
      payload: { exportFormat: 'parquet', destination: 'minio://exports/2026.parquet' },
      queueName: 'chronoscope.jobs.export',
    });

    let executionCount = 0;

    // We manually intercept the delivery to simulate worker dying mid-delivery after DB completion
    await rabbitBus.consume('chronoscope.jobs.export', async () => {
      // Start and complete in DB as worker would
      await jobManager.startJob(job.jobId);
      executionCount += 1;
      await jobManager.completeJob(job.jobId, 'minio://exports/2026.parquet');
      // Worker crashed here! Never calls delivery.ack()!
    });

    const publisher = new JobOutboxPublisher(leaseManager, rabbitBus, {
      workerId: 'golden-publisher-crash',
    });

    await publisher.publishBatch();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(executionCount).toBe(1);
    const jobAfterCrash = await jobManager.getJobById(job.jobId);
    expect(jobAfterCrash?.status).toBe('COMPLETED');

    // -------------------------------------------------------------------------
    // Redelivery: RabbitMQ detects dead worker and redelivers message to surviving worker
    // -------------------------------------------------------------------------
    let secondWorkerExecutionCount = 0;
    const survivingWorker = new JobWorker(jobManager, rabbitBus, {
      queues: ['chronoscope.jobs.export'],
    });

    survivingWorker.registerHandler('EXPORT', async () => {
      secondWorkerExecutionCount += 1;
    });

    // Clear old handler and register surviving worker
    rabbitBus.clear();
    await survivingWorker.start();

    // Redeliver the unacked message to surviving worker
    await rabbitBus.publish(
      'chronoscope.jobs.export',
      {
        jobId: job.jobId,
        jobType: job.jobType,
        idempotencyKey: job.idempotencyKey,
        payload: job.payload,
      },
      {
        jobId: job.jobId,
        attemptCount: '2',
      },
    );

    await new Promise((resolve) => setTimeout(resolve, 50));

    // Surviving worker observed job.status === 'COMPLETED' in MySQL!
    // Acknowledged redelivery without re-executing handler (Rule 8 at-most-once persistent effect):
    expect(secondWorkerExecutionCount).toBe(0);

    const finalJob = await jobManager.getJobById(job.jobId);
    expect(finalJob?.status).toBe('COMPLETED');
    expect(finalJob?.resultReference).toBe('minio://exports/2026.parquet');
    survivingWorker.stop();
  });

  it('synchronously executes replay over gRPC between client and Replay Worker (Rule 19 & ADR-011)', async () => {
    const orderRepo = new InMemoryAggregateRepository<{ status: string }>('Order');
    const executionManager = new InMemoryExecutionManager();
    const scenarioInputManager = new InMemoryScenarioInputManager();
    const snapshotStorage = new InMemorySnapshotStorage();
    const snapshotMetadataManager = {
      getLatestReadySnapshot: async () => null,
      createSnapshot: async () => ({
        snapshotId: 'stub',
        aggregateSequence: 0,
        stateHash: '',
        contentHash: '',
        status: 'CREATING' as const,
        storageKey: '',
        createdAt: '',
      }),
      markSnapshotReady: async () => {},
      markSnapshotFailed: async () => {},
      createSnapshotSet: async () => ({
        setId: 'stub',
        timelineId: '',
        timelinePosition: 0,
        contentHash: '',
        status: 'CREATING' as const,
        storageKey: '',
        createdAt: '',
      }),
      markSnapshotSetReady: async () => {},
      markSnapshotSetFailed: async () => {},
      getLatestReadySnapshotSet: async () => null,
    };
    const snapshotManager = new SnapshotManager(snapshotMetadataManager, snapshotStorage);

    // Seed events into repository
    await orderRepo.save(
      timelineId,
      aggregateId,
      0,
      [
        {
          event_id: 'evt-gold-1',
          timeline_id: timelineId,
          aggregate_id: aggregateId,
          aggregate_type: 'Order',
          aggregate_sequence: 1,
          event_type: 'OrderCreated',
          schema_version: 1,
          payload: { customerId: 'cust-gold-1' },
          event_hash: '3'.repeat(64),
          causation_id: null,
          correlation_id: 'corr-gold-1',
          recorded_at: new Date().toISOString(),
        },
        {
          event_id: 'evt-gold-2',
          timeline_id: timelineId,
          aggregate_id: aggregateId,
          aggregate_type: 'Order',
          aggregate_sequence: 2,
          event_type: 'OrderConfirmed',
          schema_version: 1,
          payload: { totalAmountMinor: 12000 },
          event_hash: '4'.repeat(64),
          causation_id: 'evt-gold-1',
          correlation_id: 'corr-gold-1',
          recorded_at: new Date().toISOString(),
        },
      ],
      { status: 'CONFIRMED' },
      'hash-state-gold-1',
    );

    const eventReader = {
      loadEventsForAggregate: async (tId: string, aId: string, maxSeq?: number) => {
        const events = orderRepo.getEvents(tId, aId);
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

    const liveStateProvider = {
      getLiveState: async (tId: string, aId: string) => {
        const row = await orderRepo.load(tId, aId);
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

    const client = new ReplayWorkerGrpcClient({
      directHandler: service,
      defaultTimeoutMs: 5000,
    });

    // 1. Health probe
    const health = await client.checkHealth();
    expect(health.status).toBe('SERVING');

    // 2. Synchronous ExecuteReplay request (Rule 19)
    const response = await client.executeReplay(
      {
        timelineId,
        aggregateId,
        aggregateType: 'Order',
        mode: 'LIVE_REPLAY',
        useSnapshot: false,
      },
      {
        correlationId: 'corr-golden-grpc-1',
        requestId: 'req-golden-grpc-1',
      },
    );

    expect(response.executionId).toBeDefined();
    expect(response.eventsReplayed).toBe(2);
    expect(response.stateHash).toHaveLength(64);
    expect(response.summary).toContain('Live replay executed');

    client.close();
  });
});
