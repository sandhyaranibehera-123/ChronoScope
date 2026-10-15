import { describe, expect, it } from 'vitest';
import {
  ExecutionContext,
  HistoricalClock,
  ExecutionClock,
  deriveSeed,
  DeterministicRandom,
} from '../core/execution-context.js';

describe('ExecutionContext & Deterministic Clocks (Rule 11 & ADR-008)', () => {
  it('strictly isolates HistoricalClock from ExecutionClock', () => {
    const historicalTime = '2025-01-01T12:00:00.000Z';
    const executionTime = '2026-10-10T15:30:00.000Z';

    const directHistClock = new HistoricalClock(historicalTime);
    expect(directHistClock.nowIso()).toBe(historicalTime);

    const directExecClock = new ExecutionClock('STEPPED', executionTime);
    expect(directExecClock.nowIso()).toBe(executionTime);
    directExecClock.tick(1000);
    expect(directExecClock.nowEpochMs()).toBe(new Date(executionTime).getTime() + 1000);

    const ctx = new ExecutionContext({
      mode: 'LIVE_REPLAY',
      initialHistoricalTime: historicalTime,
      initialExecutionTime: executionTime,
      executionClockMode: 'STEPPED',
    });

    expect(ctx.historicalClock.nowIso()).toBe(historicalTime);
    expect(ctx.executionClock.nowIso()).toBe(executionTime);

    // Advancing historical clock does not affect execution clock
    ctx.historicalClock.advanceTo('2025-01-01T12:05:00.000Z');
    expect(ctx.historicalClock.nowIso()).toBe('2025-01-01T12:05:00.000Z');
    expect(ctx.executionClock.nowIso()).toBe(executionTime);

    // Ticking execution clock does not affect historical clock
    ctx.executionClock.tick(5000);
    expect(ctx.executionClock.nowIso()).toBe('2026-10-10T15:30:05.000Z');
    expect(ctx.historicalClock.nowIso()).toBe('2025-01-01T12:05:00.000Z');
  });

  it('excludes execution_id from seed derivation and includes scenarioSeed (Rule 11)', () => {
    const scenarioSeed = 'scenario-order-failure-123';
    const timelineId = '00000000-0000-0000-0000-000000000001';
    const aggregateId = 'order-999';

    // Different runs with the same scenario parameters produce identical seeds
    const seed1 = deriveSeed({ scenarioSeed, timelineId, aggregateId, step: 1 });
    const seed2 = deriveSeed({ scenarioSeed, timelineId, aggregateId, step: 1 });
    expect(seed1).toBe(seed2);

    // Different step or scenario produces distinct seed
    const seedStep2 = deriveSeed({ scenarioSeed, timelineId, aggregateId, step: 2 });
    expect(seedStep2).not.toBe(seed1);

    const seedDifferentScenario = deriveSeed({
      scenarioSeed: 'different-scenario',
      timelineId,
      aggregateId,
      step: 1,
    });
    expect(seedDifferentScenario).not.toBe(seed1);
  });

  it('produces identical pseudo-random number sequences given the same seed', () => {
    const seed = deriveSeed({ scenarioSeed: 'test-seed-xyz' });
    const prng1 = new DeterministicRandom(seed);
    const prng2 = new DeterministicRandom(seed);

    const seq1 = Array.from({ length: 10 }, () => prng1.next());
    const seq2 = Array.from({ length: 10 }, () => prng2.next());
    expect(seq1).toEqual(seq2);

    const intSeq1 = Array.from({ length: 5 }, () => prng1.nextInt(1, 100));
    const intSeq2 = Array.from({ length: 5 }, () => prng2.nextInt(1, 100));
    expect(intSeq1).toEqual(intSeq2);
  });

  it('supports scenario inputs storage for counterfactual execution', () => {
    const ctx = ExecutionContext.createCounterfactual('seed-counterfactual', {
      forcePaymentFailure: true,
      failureReason: 'INSUFFICIENT_FUNDS',
    });

    expect(ctx.mode).toBe('COUNTERFACTUAL_REPLAY');
    expect(ctx.hasScenarioInput('forcePaymentFailure')).toBe(true);
    expect(ctx.getScenarioInput<boolean>('forcePaymentFailure')).toBe(true);
    expect(ctx.getScenarioInput<string>('failureReason')).toBe('INSUFFICIENT_FUNDS');
    expect(ctx.hasScenarioInput('unknownKey')).toBe(false);
  });
});
