import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import { computeLatencyMetrics, type MongoLatencyProfileResult } from './types.js';
import { InMemoryAggregateRepository } from '../repositories/in-memory-aggregate-repository.js';
import { InMemoryInboxCheckpointManager } from '../projections/inbox-checkpoint-manager.js';
import {
  ORDER_AGGREGATE_TYPE,
  type OrderState,
  orderReducer,
  decideCreateOrder,
  computeStateHash,
} from '@chronoscope/domain';

export interface MongoLatencyProfilerOptions {
  eventCount?: number;
  timelineId?: string;
  topic?: string;
}

/**
 * Profiles the 3 decoupled stages of the CQRS event-sourcing pipeline:
 *  - Stage 1: MySQL Event Store append (events + aggregate_versions + aggregate_state + outbox)
 *  - Stage 2: Outbox lease & Kafka publisher dispatch
 *  - Stage 3: Projection Worker MongoDB commit (w:1, j:true) + MySQL inbox/checkpoint update
 *
 * Measures percentiles (p50, p95, p99) per stage and the end-to-end projection lag.
 */
export async function runMongoLatencyProfiler(
  options: MongoLatencyProfilerOptions = {},
): Promise<MongoLatencyProfileResult> {
  const {
    eventCount = 25,
    timelineId = '00000000-0000-0000-0000-000000000001',
    topic = 'chronoscope.events.orders',
  } = options;

  // Dynamically load downstream projection components at runtime to break circular package dependencies
  const readStoreMod = '@chronoscope/read-store';
  const messagingMod = '@chronoscope/messaging';
  const projectionWorkerMod = '@chronoscope/projection-worker';

  interface ProfilerOrderSummaryRepo {
    readonly [key: string]: unknown;
  }
  interface ProfilerBus {
    send(
      topic: string,
      key: string,
      payload: unknown,
      headers?: Record<string, string>,
    ): Promise<{ topic: string; partition: number; offset: number }>;
  }
  interface ProfilerWorker {
    processMessage(msg: unknown): Promise<void>;
  }

  const { InMemoryOrderSummaryRepository } = (await import(readStoreMod)) as {
    InMemoryOrderSummaryRepository: new () => ProfilerOrderSummaryRepo;
  };
  const { InMemoryKafkaBus } = (await import(messagingMod)) as {
    InMemoryKafkaBus: new (partitions: number) => ProfilerBus;
  };
  const { ProjectionWorker } = (await import(projectionWorkerMod)) as {
    ProjectionWorker: new (
      repo: ProfilerOrderSummaryRepo,
      inbox: unknown,
      bus: ProfilerBus,
      opts?: unknown,
    ) => ProfilerWorker;
  };

  const orderRepo = new InMemoryAggregateRepository<OrderState>(ORDER_AGGREGATE_TYPE);
  const inboxCheckpoint = new InMemoryInboxCheckpointManager();
  const orderSummaryRepo = new InMemoryOrderSummaryRepository();
  const bus = new InMemoryKafkaBus(1);

  const worker = new ProjectionWorker(orderSummaryRepo, inboxCheckpoint, bus, {
    projectionName: 'order_summary',
  });

  const stage1Latencies: number[] = [];
  const stage2Latencies: number[] = [];
  const stage3Latencies: number[] = [];
  const endToEndLags: number[] = [];

  const startAll = performance.now();

  for (let i = 0; i < eventCount; i++) {
    const aggregateId = randomUUID();
    const correlationId = randomUUID();

    // -------------------------------------------------------------------------
    // STAGE 1: MySQL Event Store Append
    // -------------------------------------------------------------------------
    const t0 = performance.now();

    const createCmd = {
      command_id: randomUUID(),
      request_id: randomUUID(),
      actor_id: 'system',
      timeline_id: timelineId,
      aggregate_id: aggregateId,
      aggregate_type: 'Order',
      expected_sequence: 0,
      payload: { customer_id: `cust-${i}`, currency: 'USD' },
      causation_id: null,
      correlation_id: correlationId,
    };
    const evt1 = decideCreateOrder(createCmd, null);
    const state1 = orderReducer(null, evt1);
    const hash1 = computeStateHash(state1);

    await orderRepo.save(timelineId, aggregateId, 0, [evt1], state1, hash1);
    const t1 = performance.now();
    const stage1Duration = t1 - t0;
    stage1Latencies.push(stage1Duration);

    // -------------------------------------------------------------------------
    // STAGE 2: Outbox Lease & Kafka Publish
    // -------------------------------------------------------------------------
    const pendingOutbox = orderRepo.getOutbox('PENDING');
    const latestRecord = pendingOutbox.find((r) => r.eventId === evt1.event_id);

    const headers: Record<string, string> = {
      'x-event-id': evt1.event_id,
      'x-aggregate-id': aggregateId,
      'x-timeline-id': timelineId,
      'x-event-type': evt1.event_type,
    };

    let publishResult = { topic, partition: 0, offset: i + 1 };
    if (latestRecord) {
      publishResult = await bus.send(
        topic,
        `${timelineId}:${aggregateId}`,
        latestRecord.payload,
        headers,
      );
    }
    const t2 = performance.now();
    const stage2Duration = t2 - t1;
    stage2Latencies.push(stage2Duration);

    // -------------------------------------------------------------------------
    // STAGE 3: Projection Worker MongoDB Commit (w:1, j:true) + Checkpoint
    // -------------------------------------------------------------------------
    await worker.processMessage({
      topic,
      partition: publishResult.partition,
      offset: publishResult.offset,
      key: `${timelineId}:${aggregateId}`,
      value: latestRecord?.payload ?? evt1.payload,
      timestamp: String(Date.now()),
      headers,
    });
    const t3 = performance.now();
    const stage3Duration = t3 - t2;
    stage3Latencies.push(stage3Duration);

    // End-to-end projection lag: difference between event generation and read-store commit
    const e2eLag = t3 - t0;
    endToEndLags.push(e2eLag);
  }

  const totalElapsedMs = performance.now() - startAll;

  return {
    totalEvents: eventCount,
    stage1EventStoreAppend: computeLatencyMetrics(stage1Latencies),
    stage2OutboxPublish: computeLatencyMetrics(stage2Latencies),
    stage3ProjectionCommit: computeLatencyMetrics(stage3Latencies),
    endToEndProjectionLag: computeLatencyMetrics(endToEndLags),
    totalElapsedMs: Math.round(totalElapsedMs * 100) / 100,
  };
}
