import { performance } from 'node:perf_hooks';
import { computeLatencyMetrics, type OccContentionResult } from './types.js';
import { InMemoryAggregateRepository } from '../repositories/in-memory-aggregate-repository.js';
import { createDomainEvent } from '@chronoscope/events';

export interface OccContentionOptions {
  aggregateId?: string;
  totalWriters?: number;
  timelineId?: string;
  enableRetry?: boolean;
  maxRetries?: number;
  initialBackoffMs?: number;
}

/**
 * Runs a hot-spot OCC contention benchmark where N concurrent workers race to append
 * to the exact same aggregate version anchor.
 */
export async function runOccContentionBenchmark(
  options: OccContentionOptions = {},
): Promise<OccContentionResult> {
  const {
    aggregateId = 'agg-contended-hotspot',
    totalWriters = 50,
    timelineId = '00000000-0000-0000-0000-000000000001',
    enableRetry = true,
    maxRetries = 25,
    initialBackoffMs = 2,
  } = options;

  const repo = new InMemoryAggregateRepository<{ counter: number }>('ContendedCounter');

  // Initialize aggregate at sequence 0
  const startAll = performance.now();
  let directSuccessCount = 0;
  let conflictCount = 0;
  let retriedSuccessCount = 0;
  let totalAttempts = 0;
  let maxRetriesObserved = 0;

  const latencies: number[] = [];

  const workerPromises = Array.from({ length: totalWriters }, async (_, writerIdx) => {
    const workerStart = performance.now();
    let attempts = 0;
    let succeeded = false;

    while (attempts < (enableRetry ? maxRetries : 1) && !succeeded) {
      attempts++;
      totalAttempts++;

      try {
        // Read current state
        const current = await repo.load(timelineId, aggregateId);
        const currentSeq = current?.sequence ?? 0;
        const currentCount = current?.state.counter ?? 0;

        const nextSeq = currentSeq + 1;
        const nextCount = currentCount + 1;

        const event = createDomainEvent({
          eventId: `evt-contend-${writerIdx}-${attempts}`,
          timelineId,
          aggregateId,
          aggregateType: 'ContendedCounter',
          aggregateSequence: nextSeq,
          eventType: 'CounterIncremented',
          payload: { writer: writerIdx, count: nextCount },
          correlationId: `corr-contend-${writerIdx}`,
        });

        const res = await repo.save(
          timelineId,
          aggregateId,
          currentSeq, // OCC expectedSequence check
          [event],
          { counter: nextCount },
          `hash-contend-${nextSeq}`.padEnd(64, '0'),
        );

        if (res.success) {
          succeeded = true;
          if (attempts === 1) {
            directSuccessCount++;
          } else {
            retriedSuccessCount++;
          }
          break;
        }
      } catch (_err: unknown) {
        conflictCount++;
        if (!enableRetry) {
          break;
        }

        // Apply exponential backoff with full jitter
        const backoff =
          Math.min(100, Math.pow(1.3, attempts) * initialBackoffMs) +
          Math.random() * initialBackoffMs * 2;
        await new Promise((r) => setTimeout(r, backoff));
      }
    }

    if (attempts > maxRetriesObserved) {
      maxRetriesObserved = attempts;
    }

    const workerElapsed = performance.now() - workerStart;
    latencies.push(workerElapsed);
  });

  await Promise.all(workerPromises);

  const elapsedMs = performance.now() - startAll;
  const finalSnapshot = await repo.load(timelineId, aggregateId);
  const finalSequence = finalSnapshot?.sequence ?? 0;

  return {
    aggregateId,
    totalWriters,
    directSuccessCount,
    conflictCount,
    retriedSuccessCount,
    totalAttempts,
    maxRetriesObserved,
    elapsedMs: Math.round(elapsedMs * 100) / 100,
    finalSequence,
    latency: computeLatencyMetrics(latencies),
  };
}
