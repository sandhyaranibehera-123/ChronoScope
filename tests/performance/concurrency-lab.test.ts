import { describe, expect, it } from 'vitest';
import {
  runScalingBenchmark,
  runOccContentionBenchmark,
  runInventoryConcurrencyLab,
  runMongoLatencyProfiler,
  type ReservationRequest,
} from '@chronoscope/database';

describe('Performance & Concurrency Lab (Phase 13, Rules 1, 6, 10, 15)', () => {
  // ---------------------------------------------------------------------------
  // 1. High-Throughput Scaling Benchmark (Rule 6)
  // ---------------------------------------------------------------------------
  it('proves 100 independent aggregates append concurrently with zero lock contention', async () => {
    const AGGREGATE_COUNT = 100;
    const result = await runScalingBenchmark({
      aggregateCount: AGGREGATE_COUNT,
    });

    expect(result.aggregateCount).toBe(AGGREGATE_COUNT);
    expect(result.successfulAppends).toBe(AGGREGATE_COUNT);
    expect(result.failedAppends).toBe(0);
    expect(result.conflictCount).toBe(0);
    expect(result.throughputOpsPerSec).toBeGreaterThan(0);
    expect(result.latency.p50).toBeGreaterThanOrEqual(0);
  });

  // ---------------------------------------------------------------------------
  // 2. Hot-Spot OCC Contention Benchmark
  // ---------------------------------------------------------------------------
  describe('Hot-Spot OCC Contention & Retry Convergence', () => {
    it('proves raw OCC race without retries has exactly 1 winner and N-1 conflicts', async () => {
      const TOTAL_WRITERS = 20;
      const result = await runOccContentionBenchmark({
        aggregateId: 'agg-hotspot-raw',
        totalWriters: TOTAL_WRITERS,
        enableRetry: false,
      });

      expect(result.totalWriters).toBe(TOTAL_WRITERS);
      expect(result.directSuccessCount).toBe(1);
      expect(result.conflictCount).toBe(TOTAL_WRITERS - 1);
      expect(result.finalSequence).toBe(1);
    });

    it('proves jittered exponential backoff retries converge 100% of writers to final sequence N', async () => {
      const TOTAL_WRITERS = 25;
      const result = await runOccContentionBenchmark({
        aggregateId: 'agg-hotspot-retried',
        totalWriters: TOTAL_WRITERS,
        enableRetry: true,
        maxRetries: 30,
        initialBackoffMs: 2,
      });

      expect(result.totalWriters).toBe(TOTAL_WRITERS);
      // All writers must eventually succeed
      const totalSucceeded = result.directSuccessCount + result.retriedSuccessCount;
      expect(totalSucceeded).toBe(TOTAL_WRITERS);
      expect(result.finalSequence).toBe(TOTAL_WRITERS);
      expect(result.latency.p95).toBeGreaterThanOrEqual(result.latency.p50);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Four SQL & Event-Sourcing Inventory Concurrency Strategies
  // ---------------------------------------------------------------------------
  describe('Inventory Concurrency Lab: 4 Strategies & Race Prevention', () => {
    const INITIAL_STOCK = 10;
    const REQUEST_COUNT = 20; // 20 requests for 1 item each -> 10 oversell demand

    const generateRequests = (): ReservationRequest[] =>
      Array.from({ length: REQUEST_COUNT }, (_, i) => ({
        requestId: `req-${i + 1}`,
        sku: 'SKU-WIDGET-01',
        quantity: 1,
      }));

    it('Strategy 1 (Uncontrolled Read-Modify-Write): exhibits lost update bug and oversells inventory', async () => {
      const requests = generateRequests();
      const result = await runInventoryConcurrencyLab({
        initialStock: INITIAL_STOCK,
        requests,
        strategy: 'UNCONTROLLED_READ_MODIFY_WRITE',
      });

      // Uncontrolled strategy allows overlapping stale reads -> oversells beyond initial stock
      expect(result.isOversold).toBe(true);
      expect(result.totalAllocatedQuantity).toBeGreaterThan(INITIAL_STOCK);
      expect(result.oversoldQuantity).toBeGreaterThan(0);
    });

    it('Strategy 2 (Pessimistic Row Lock): serializes via SELECT ... FOR UPDATE and strictly prevents overselling', async () => {
      const requests = generateRequests();
      const result = await runInventoryConcurrencyLab({
        initialStock: INITIAL_STOCK,
        requests,
        strategy: 'PESSIMISTIC_ROW_LOCK',
      });

      expect(result.isOversold).toBe(false);
      expect(result.oversoldQuantity).toBe(0);
      expect(result.successfulAllocations).toBe(INITIAL_STOCK);
      expect(result.failedAllocations).toBe(REQUEST_COUNT - INITIAL_STOCK);
      expect(result.finalAvailableStock).toBe(0);
      expect(result.totalAllocatedQuantity).toBe(INITIAL_STOCK);
    });

    it('Strategy 3 (Atomic Conditional Update): executes UPDATE WHERE available >= ? atomically with zero oversell', async () => {
      const requests = generateRequests();
      const result = await runInventoryConcurrencyLab({
        initialStock: INITIAL_STOCK,
        requests,
        strategy: 'ATOMIC_CONDITIONAL_UPDATE',
      });

      expect(result.isOversold).toBe(false);
      expect(result.oversoldQuantity).toBe(0);
      expect(result.successfulAllocations).toBe(INITIAL_STOCK);
      expect(result.failedAllocations).toBe(REQUEST_COUNT - INITIAL_STOCK);
      expect(result.finalAvailableStock).toBe(0);
      expect(result.totalAllocatedQuantity).toBe(INITIAL_STOCK);
    });

    it('Strategy 4 (Event-Sourced OCC): event log append with version check & retry prevents oversell and ensures state hash parity', async () => {
      const requests = generateRequests();
      const result = await runInventoryConcurrencyLab({
        initialStock: INITIAL_STOCK,
        requests,
        strategy: 'EVENT_SOURCED_OCC',
        maxOccRetries: 25,
        initialBackoffMs: 2,
      });

      expect(result.isOversold).toBe(false);
      expect(result.oversoldQuantity).toBe(0);
      expect(result.successfulAllocations).toBe(INITIAL_STOCK);
      expect(result.failedAllocations).toBe(REQUEST_COUNT - INITIAL_STOCK);
      expect(result.finalAvailableStock).toBe(0);
      expect(result.totalAllocatedQuantity).toBe(INITIAL_STOCK);
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Mongo 3-Step Commit Latency Profiling
  // ---------------------------------------------------------------------------
  it('profiles CQRS 3-step commit pipeline latency and verifies decoupled stage latencies', async () => {
    const EVENT_COUNT = 15;
    const profile = await runMongoLatencyProfiler({
      eventCount: EVENT_COUNT,
    });

    expect(profile.totalEvents).toBe(EVENT_COUNT);
    expect(profile.stage1EventStoreAppend.p50).toBeGreaterThanOrEqual(0);
    expect(profile.stage2OutboxPublish.p50).toBeGreaterThanOrEqual(0);
    expect(profile.stage3ProjectionCommit.p50).toBeGreaterThanOrEqual(0);
    expect(profile.endToEndProjectionLag.p50).toBeGreaterThanOrEqual(0);

    // End to end projection lag is the cumulative duration through the pipeline
    expect(profile.endToEndProjectionLag.avg).toBeGreaterThanOrEqual(
      profile.stage1EventStoreAppend.avg,
    );
  });
});
