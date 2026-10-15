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
  type OrderCreatedEvent,
  type OrderItemAddedEvent,
  decideCreateOrder,
  decideAddOrderItem,
  orderReducer,
  computeStateHash,
} from '@chronoscope/domain';
import {
  InMemoryAggregateRepository,
  InMemoryInboxCheckpointManager,
  InMemoryExperimentManager,
  InMemoryAuditLogger,
  type OutboxLeaseManager,
} from '@chronoscope/database';
import { InMemoryOrderSummaryRepository } from '@chronoscope/read-store';
import { InMemoryKafkaBus, OutboxPublisher } from '@chronoscope/messaging';
import { ProjectionWorker } from '@chronoscope/projection-worker';
import {
  ChaosEngine,
  ExperimentRunner,
  ChaosDisabledError,
  ChaosUnauthorizedError,
  ChaosLimitExceededError,
  executeMongoUnavailableScenario,
  executeMySqlUnavailableScenario,
} from '@chronoscope/chaos';

describe('Golden Scenario: Chaos Engine & Decoupled Polyglot Resilience (Phase 11, Rules 21 & 22)', () => {
  const timelineId = asTimelineId('00000000-0000-0000-0000-000000000001');

  it('proves Rule 21 safety gates: CHAOS_MODE gate, admin authorization, max concurrency limits, and kill switch', async () => {
    const auditLogger = new InMemoryAuditLogger();

    // 1. CHAOS_MODE=false -> injection strictly forbidden
    const disarmedEngine = new ChaosEngine({
      chaosEnabled: false,
      auditLogger,
    });

    await expect(
      disarmedEngine.inject(
        {
          layer: 'DEPENDENCY',
          type: 'MONGODB_UNAVAILABLE',
          target: 'mongodb',
        },
        'admin',
      ),
    ).rejects.toThrow(ChaosDisabledError);

    // 2. CHAOS_MODE=true with non-admin actor -> unauthorized
    const liveEngine = new ChaosEngine({
      chaosEnabled: true,
      maxConcurrentFaults: 3,
      auditLogger,
    });

    await expect(
      liveEngine.inject(
        {
          layer: 'DEPENDENCY',
          type: 'MONGODB_UNAVAILABLE',
          target: 'mongodb',
        },
        'operator', // non-admin
      ),
    ).rejects.toThrow(ChaosUnauthorizedError);

    // 3. Admin successfully injects faults up to limit (max = 3)
    const fault1 = await liveEngine.inject(
      {
        layer: 'APPLICATION',
        type: 'LATENCY',
        target: 'order-api',
        parameters: { latencyMs: 50 },
        ttlSeconds: 10,
      },
      'admin',
      'admin-alice',
    );
    const fault2 = await liveEngine.inject(
      { layer: 'DEPENDENCY', type: 'REDIS_UNAVAILABLE', target: 'redis', ttlSeconds: 10 },
      'admin',
      'admin-alice',
    );
    const fault3 = await liveEngine.inject(
      { layer: 'DEPENDENCY', type: 'KAFKA_UNAVAILABLE', target: 'kafka', ttlSeconds: 10 },
      'admin',
      'admin-alice',
    );

    expect(liveEngine.getActiveFaults()).toHaveLength(3);

    // 4. Attempting 4th fault exceeds concurrent limit
    await expect(
      liveEngine.inject(
        { layer: 'DEPENDENCY', type: 'MONGODB_UNAVAILABLE', target: 'mongodb' },
        'admin',
        'admin-alice',
      ),
    ).rejects.toThrow(ChaosLimitExceededError);

    // 5. Emergency Kill Switch (Rule 21): immediately disarms all faults
    const killResponse = await liveEngine.disarmAll('admin', 'admin-alice');
    expect(killResponse.disarmedCount).toBe(3);
    expect(killResponse.disarmedFaultIds).toContain(fault1.faultId);
    expect(killResponse.disarmedFaultIds).toContain(fault2.faultId);
    expect(killResponse.disarmedFaultIds).toContain(fault3.faultId);
    expect(liveEngine.getActiveFaults()).toHaveLength(0);

    // 6. Mandatory audit trail verification in chronoscope_ops.audit_log
    const auditLogs = await auditLogger.listRecent(10);
    expect(auditLogs).toHaveLength(4); // 3 injections + 1 kill switch
    expect(auditLogs[0]?.action).toBe('ENGAGE_KILL_SWITCH');
    expect(auditLogs[1]?.action).toBe('INJECT_FAULT');
    expect(auditLogs[2]?.action).toBe('INJECT_FAULT');
    expect(auditLogs[3]?.action).toBe('INJECT_FAULT');
  });

  it('demonstrates signature MONGODB_UNAVAILABLE resilience: write path succeeds, Kafka buffers, read degrades, post-recovery catches up with hash parity', async () => {
    const auditLogger = new InMemoryAuditLogger();
    const chaosEngine = new ChaosEngine({ chaosEnabled: true, auditLogger });

    // Polyglot write and read components
    const aggregateRepo = new InMemoryAggregateRepository<OrderState>(ORDER_AGGREGATE_TYPE);
    const readStoreRepo = new InMemoryOrderSummaryRepository();
    const inboxManager = new InMemoryInboxCheckpointManager();
    const kafkaBus = new InMemoryKafkaBus();

    const publishedIds = new Set<string>();
    const mockLeaseManager: OutboxLeaseManager = {
      leaseBatch: async () => {
        const pending = aggregateRepo
          .getOutbox('PENDING')
          .filter((r) => !publishedIds.has(r.outboxId));
        return pending.map((r) => ({
          outboxId: r.outboxId,
          eventId: r.eventId,
          topic: r.topic,
          partitionKey: r.partitionKey,
          payload: r.payload,
          attemptCount: r.attemptCount,
          maxAttempts: 5,
        }));
      },
      markPublished: async (outboxId: string) => {
        publishedIds.add(outboxId);
      },
      markFailed: async () => 'RETRY_SCHEDULED',
    } as unknown as OutboxLeaseManager;

    const outboxPublisher = new OutboxPublisher(mockLeaseManager, kafkaBus, {
      batchSize: 10,
      leaseDurationSeconds: 5,
      workerId: 'outbox-worker-chaos',
    });

    const originalUpsert = readStoreRepo.upsertOrderSummary.bind(readStoreRepo);
    readStoreRepo.upsertOrderSummary = async (doc) => {
      if (chaosEngine.isFaultActive('MONGODB_UNAVAILABLE', 'mongodb')) {
        throw new Error('Simulated MongoDB connection refused: write failed');
      }
      return originalUpsert(doc);
    };

    const projectionWorker = new ProjectionWorker(readStoreRepo, inboxManager, kafkaBus, {
      projectionName: 'order_summary',
      consumerName: 'order_summary_worker',
    });
    await projectionWorker.start(['chronoscope.domain.events']);

    const orderId = asAggregateId(`order-chaos-${randomUUID().slice(0, 8)}`);

    // Helper: dispatch command on MySQL write side
    const executeWrite = async (
      commandName: string,
    ): Promise<{ success: boolean; sequence: number }> => {
      const isCreate = commandName === 'CreateOrder';
      const current = await aggregateRepo.load(timelineId, orderId);
      const expectedSeq = current?.sequence ?? 0;
      let event: OrderCreatedEvent | OrderItemAddedEvent;
      let nextState: OrderState;

      if (isCreate) {
        event = decideCreateOrder(
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
            payload: { customer_id: 'cust-chaos', currency: 'INR' },
          },
          null,
        );
        nextState = orderReducer(null, event);
      } else {
        event = decideAddOrderItem(
          {
            command_id: asCommandId(randomUUID()),
            request_id: asRequestId(randomUUID()),
            correlation_id: asCorrelationId(randomUUID()),
            causation_id: null,
            actor_id: asActorId('user-alice'),
            timeline_id: timelineId,
            aggregate_id: orderId,
            aggregate_type: 'Order',
            expected_sequence: expectedSeq,
            payload: {
              item: {
                sku: 'SKU-001',
                quantity: 2,
                unitAmountMinor: 5000n,
                totalAmountMinor: 10000n,
              },
            },
          },
          current!.state,
        );
        nextState = orderReducer(current!.state, event);
      }

      const stateHash = computeStateHash(nextState);
      const result = await aggregateRepo.save(
        timelineId,
        orderId,
        expectedSeq,
        [event],
        nextState,
        stateHash,
      );

      // Lease and publish outbox to Kafka
      await outboxPublisher.publishBatch();
      return { success: true, sequence: result.newSequence };
    };

    // Helper: query read store with chaos interceptor
    const executeRead = async () => {
      if (chaosEngine.isFaultActive('MONGODB_UNAVAILABLE', 'mongodb')) {
        return { ok: false, error: 'Simulated MongoDB connection refused' };
      }
      const doc = await readStoreRepo.findById(timelineId, orderId);
      return { ok: true, status: doc?.status };
    };

    // Recorded invariants accumulator
    const invariantsEvaluated: Record<string, boolean> = {};
    const recordInvariant = async (
      name: string,
      _expected: unknown,
      _measured: unknown,
      passed: boolean,
    ) => {
      invariantsEvaluated[name] = passed;
    };

    // Run signature scenario
    const summary = await executeMongoUnavailableScenario(chaosEngine, recordInvariant, {
      executeWriteCommand: executeWrite,
      executeReadQuery: executeRead,
      flushProjectionBacklog: async () => {
        let count = 0;
        for (let p = 0; p < 4; p++) {
          const msgs = kafkaBus.getMessages('chronoscope.domain.events', p);
          for (const msg of msgs) {
            await projectionWorker.handleMessageWithPartitionQueue(msg);
            count++;
          }
        }
        return count;
      },
      verifyProjectionConsistency: async () => {
        const doc = await readStoreRepo.findById(timelineId, orderId);
        const snapshot = await aggregateRepo.load(timelineId, orderId);
        const matched =
          doc !== null && snapshot !== null && doc.appliedSequence === snapshot.sequence;
        return {
          matched,
          appliedSequence: doc?.appliedSequence ?? 0,
        };
      },
    });

    // Invariant assertions
    expect(invariantsEvaluated['baseline_write_ok']).toBe(true);
    expect(invariantsEvaluated['write_path_uninterrupted_during_mongo_outage']).toBe(true);
    expect(invariantsEvaluated['read_path_degraded_cleanly']).toBe(true);
    expect(invariantsEvaluated['read_model_hash_parity_and_sequence_convergence']).toBe(true);
    expect(summary.convergedSequence).toBe(2);
    expect(summary.consistencyMatched).toBe(true);
  });

  it('demonstrates MYSQL_UNAVAILABLE fail-fast while MongoDB continues serving read models', async () => {
    const chaosEngine = new ChaosEngine({ chaosEnabled: true });
    const orderId = asAggregateId(`order-mysql-chaos-${randomUUID().slice(0, 8)}`);

    const readStoreRepo = new InMemoryOrderSummaryRepository();
    // Pre-populate read model in MongoDB
    await readStoreRepo.upsertOrderSummary({
      _id: `${timelineId}:${orderId}`,
      timelineId,
      aggregateId: orderId,
      status: 'CONFIRMED',
      items: [{ sku: 'SKU-001', quantity: 2, amountMinor: 5000 }],
      totalAmountMinor: 10000,
      currency: 'INR',
      appliedSequence: 2,
      appliedTimelinePosition: 100,
      appliedKafkaTopic: 'chronoscope.domain.events',
      appliedKafkaPartition: 0,
      appliedKafkaOffset: 42,
      appliedEventId: randomUUID(),
      sourceAggregateSequence: 2,
      sourceStateHash: 'a'.repeat(64),
      projectionHash: 'b'.repeat(64),
      updatedAt: new Date(),
    });

    const invariantsEvaluated: Record<string, boolean> = {};
    const recordInvariant = async (
      name: string,
      _expected: unknown,
      _measured: unknown,
      passed: boolean,
    ) => {
      invariantsEvaluated[name] = passed;
    };

    const summary = await executeMySqlUnavailableScenario(chaosEngine, recordInvariant, {
      executeWriteCommand: async () => {
        if (chaosEngine.isFaultActive('MYSQL_UNAVAILABLE', 'mysql')) {
          return { success: false, errorCategory: 'SYSTEM_ERROR' };
        }
        return { success: true };
      },
      executeReadQuery: async () => {
        const doc = await readStoreRepo.findById(timelineId, orderId);
        return { ok: doc !== null, status: doc?.status };
      },
    });

    expect(invariantsEvaluated['write_path_fail_fast_on_mysql_outage']).toBe(true);
    expect(invariantsEvaluated['read_path_available_from_mongo']).toBe(true);
    expect(summary.writeFailedFast).toBe(true);
    expect(summary.readPathAvailable).toBe(true);
  });

  it('executes reproducible experiment run with exact machine profile and full manifest (Rule 22)', async () => {
    const experimentManager = new InMemoryExperimentManager();
    const auditLogger = new InMemoryAuditLogger();
    const chaosEngine = new ChaosEngine({ chaosEnabled: true, auditLogger });
    const runner = new ExperimentRunner(experimentManager, chaosEngine);

    await experimentManager.registerExperiment({
      experimentId: 'exp-polyglot-resilience',
      name: 'Polyglot Persistence Failure Domain Resilience',
      category: 'CHAOS',
      description: 'Proves independent degradation of MySQL and MongoDB under injected failures',
      hypothesis:
        'MongoDB outage leaves MySQL write path available; MySQL outage leaves MongoDB read models available',
      steadyStateInvariants: {
        zeroDataLoss: true,
        hashParityGuaranteed: true,
      },
      faultConfig: {
        type: 'MONGODB_UNAVAILABLE',
        layer: 'DEPENDENCY',
        target: 'mongodb',
        ttlSeconds: 60,
      },
    });

    const runRecord = await runner.runExperiment({
      experimentId: 'exp-polyglot-resilience',
      scenarioSeed: 'seed-repro-golden-42',
      workload: { commandVolume: 100, readQueries: 50 },
      actorRole: 'admin',
      actorId: 'test-runner',
    });

    expect(runRecord.status).toBe('COMPLETED');
    expect(runRecord.invariantsPassed).toBe(true);

    // Rule 22: Machine profile verification
    const profile = runRecord.manifest.machineProfile;
    expect(profile.mysqlVersion).toContain('8.4');
    expect(profile.mongodbVersion).toContain('7.0');
    expect(profile.mysqlImageDigest).toContain('sha256:');
    expect(profile.mongodbImageDigest).toContain('sha256:');
    expect(profile.nodeVersion).toBeDefined();
    expect(profile.dockerVersion).toBeDefined();
    expect(profile.osArch).toBeDefined();

    // Verify persisted invariant records
    const invariants = await experimentManager.getRunInvariants(runRecord.runId);
    expect(invariants.length).toBeGreaterThanOrEqual(2);
    expect(invariants.every((i) => i.status === 'PASSED')).toBe(true);
  });
});
