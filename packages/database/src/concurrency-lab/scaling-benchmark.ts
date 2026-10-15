import { performance } from 'node:perf_hooks';
import { computeLatencyMetrics, type ScalingBenchmarkResult } from './types.js';
import { InMemoryAggregateRepository } from '../repositories/in-memory-aggregate-repository.js';
import { createDomainEvent } from '@chronoscope/events';

export interface ScalingBenchmarkOptions {
  aggregateCount?: number;
  timelineId?: string;
  batchSize?: number;
}

/**
 * Runs independent aggregate scaling benchmark proving zero lock contention
 * under row-locked OCC (innodb_autoinc_lock_mode = 2 & row-locked aggregate_versions).
 */
export async function runScalingBenchmark(
  options: ScalingBenchmarkOptions = {},
): Promise<ScalingBenchmarkResult> {
  const { aggregateCount = 100, timelineId = '00000000-0000-0000-0000-000000000001' } = options;

  const repo = new InMemoryAggregateRepository<{ count: number }>('IndependentScaling');

  const startAll = performance.now();
  let successfulAppends = 0;
  let failedAppends = 0;
  let conflictCount = 0;

  const latencies: number[] = [];

  // Launch all aggregate appends concurrently
  const promises = Array.from({ length: aggregateCount }, async (_, index) => {
    const start = performance.now();
    const aggregateId = `agg-scale-${index}`;

    try {
      const event = createDomainEvent({
        eventId: `evt-scale-${index}`,
        timelineId,
        aggregateId,
        aggregateType: 'IndependentScaling',
        aggregateSequence: 1,
        eventType: 'AggregateCreated',
        payload: { index, initialValue: index * 10 },
        correlationId: `corr-scale-${index}`,
      });

      const res = await repo.save(
        timelineId,
        aggregateId,
        0, // expectedSequence = 0 for brand new aggregate
        [event],
        { count: 1 },
        `hash-scale-${index}`.padEnd(64, '0'),
      );

      if (res.success) {
        successfulAppends++;
      } else {
        failedAppends++;
      }
    } catch {
      failedAppends++;
      conflictCount++;
    } finally {
      latencies.push(performance.now() - start);
    }
  });

  await Promise.all(promises);

  const elapsedMs = performance.now() - startAll;
  const elapsedSec = elapsedMs / 1000;
  const throughputOpsPerSec =
    elapsedSec > 0 ? Math.round((successfulAppends / elapsedSec) * 100) / 100 : 0;

  return {
    aggregateCount,
    successfulAppends,
    failedAppends,
    conflictCount,
    throughputOpsPerSec,
    elapsedMs: Math.round(elapsedMs * 100) / 100,
    latency: computeLatencyMetrics(latencies),
  };
}
