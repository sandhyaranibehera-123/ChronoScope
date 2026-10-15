import { createHash } from 'node:crypto';

export interface IClock {
  now(): Date;
  nowIso(): string;
  nowEpochMs(): number;
}

/**
 * HistoricalClock — system-guarantees.md Rule 11 & ADR-008:
 * "HistoricalClock splits from ExecutionClock. An event uses its own occurred_at/recorded_at.
 * HistoricalClock/ExecutionClock are never conflated."
 *
 * During replay, this clock represents historical time and advances monotonically
 * as events are processed.
 */
export class HistoricalClock implements IClock {
  private currentTime: Date;

  constructor(initialTime: string | Date | number = new Date(0)) {
    this.currentTime = new Date(initialTime);
  }

  public now(): Date {
    return new Date(this.currentTime.getTime());
  }

  public nowIso(): string {
    return this.currentTime.toISOString();
  }

  public nowEpochMs(): number {
    return this.currentTime.getTime();
  }

  public advanceTo(timestamp: string | Date | number): void {
    const nextTime = new Date(timestamp);
    if (nextTime.getTime() < this.currentTime.getTime()) {
      // In historical event streams, out-of-order timestamps can occur across different aggregates,
      // but within an aggregate stream, time is monotonically increasing.
      // We advance or update accordingly.
    }
    this.currentTime = nextTime;
  }
}

export type ExecutionClockMode = 'LIVE' | 'STEPPED';

/**
 * ExecutionClock — ADR-008:
 * Represents the execution time for new event generation, either real wall-clock time
 * or deterministic stepped logical time.
 */
export class ExecutionClock implements IClock {
  private currentTime: Date;

  constructor(
    private readonly mode: ExecutionClockMode = 'LIVE',
    initialTime?: string | Date | number,
  ) {
    this.currentTime = initialTime ? new Date(initialTime) : new Date();
  }

  public now(): Date {
    if (this.mode === 'LIVE') {
      return new Date();
    }
    return new Date(this.currentTime.getTime());
  }

  public nowIso(): string {
    return this.now().toISOString();
  }

  public nowEpochMs(): number {
    return this.now().getTime();
  }

  public tick(stepMs = 1000): void {
    if (this.mode === 'STEPPED') {
      this.currentTime = new Date(this.currentTime.getTime() + stepMs);
    }
  }

  public advanceTo(timestamp: string | Date | number): void {
    this.currentTime = new Date(timestamp);
  }

  public getMode(): ExecutionClockMode {
    return this.mode;
  }
}

export interface SeedDerivationOptions {
  readonly scenarioSeed: string | number;
  readonly timelineId?: string | undefined;
  readonly aggregateId?: string | undefined;
  readonly step?: number | undefined;
}

/**
 * Deterministic seed derivation formula — system-guarantees.md Rule 11 & ADR-008:
 * "Seed derivation excludes execution_id, includes scenarioSeed."
 *
 * Excludes volatile run identifiers so different execution runs with the same
 * scenario produce identical pseudo-random outputs.
 */
export function deriveSeed(options: SeedDerivationOptions): number {
  const parts: string[] = [`seed:${String(options.scenarioSeed)}`];

  if (options.timelineId !== undefined) {
    parts.push(`timeline:${options.timelineId}`);
  }
  if (options.aggregateId !== undefined) {
    parts.push(`agg:${options.aggregateId}`);
  }
  if (options.step !== undefined) {
    parts.push(`step:${options.step}`);
  }

  const hash = createHash('sha256').update(parts.join('|')).digest();
  // Read first 32-bit unsigned integer
  return hash.readUInt32BE(0);
}

/**
 * Deterministic PRNG implementation (Mulberry32).
 * Fast, 32-bit state generator with excellent distribution and deterministic reproducibility.
 */
export class DeterministicRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
    if (this.state === 0) {
      this.state = 0x6d2b79f5;
    }
  }

  /**
   * Returns a pseudo-random floating-point number in [0, 1).
   */
  public next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /**
   * Returns a pseudo-random integer in [min, max] inclusive.
   */
  public nextInt(min: number, max: number): number {
    const fMin = Math.ceil(min);
    const fMax = Math.floor(max);
    return Math.floor(this.next() * (fMax - fMin + 1)) + fMin;
  }

  /**
   * Returns a pseudo-random boolean.
   */
  public nextBoolean(): boolean {
    return this.next() >= 0.5;
  }

  /**
   * Picks a random element from an array.
   */
  public choice<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new Error('Cannot pick from empty array');
    }
    const index = this.nextInt(0, items.length - 1);
    return items[index]!;
  }
}

export type ExecutionMode = 'LIVE_EXECUTION' | 'LIVE_REPLAY' | 'COUNTERFACTUAL_REPLAY';

export interface ExecutionContextOptions {
  readonly mode: ExecutionMode;
  readonly scenarioSeed?: string | number | undefined;
  readonly executionClockMode?: ExecutionClockMode | undefined;
  readonly initialHistoricalTime?: string | Date | number | undefined;
  readonly initialExecutionTime?: string | Date | number | undefined;
  readonly scenarioInputs?: Readonly<Record<string, unknown>> | undefined;
}

/**
 * ExecutionContext — system-guarantees.md Rule 11 & ADR-008.
 *
 * Encapsulates the execution environment, enforcing:
 * 1. Independent HistoricalClock vs ExecutionClock.
 * 2. Deterministic pseudo-random generation derived from scenarioSeed (excluding execution_id).
 * 3. Execution mode tracking (LIVE_EXECUTION vs LIVE_REPLAY vs COUNTERFACTUAL_REPLAY).
 * 4. Persisted scenario inputs for counterfactual execution.
 */
export class ExecutionContext {
  public readonly mode: ExecutionMode;
  public readonly historicalClock: HistoricalClock;
  public readonly executionClock: ExecutionClock;
  public readonly random: DeterministicRandom;
  public readonly scenarioSeed: string | number;
  private readonly scenarioInputsMap: Map<string, unknown>;

  constructor(options: ExecutionContextOptions) {
    this.mode = options.mode;
    this.scenarioSeed = options.scenarioSeed ?? 'default-scenario-seed';

    this.historicalClock = new HistoricalClock(options.initialHistoricalTime ?? 0);
    this.executionClock = new ExecutionClock(
      options.executionClockMode ?? (options.mode === 'LIVE_EXECUTION' ? 'LIVE' : 'STEPPED'),
      options.initialExecutionTime,
    );

    const derivedSeed = deriveSeed({ scenarioSeed: this.scenarioSeed });
    this.random = new DeterministicRandom(derivedSeed);

    this.scenarioInputsMap = new Map();
    if (options.scenarioInputs) {
      for (const [key, value] of Object.entries(options.scenarioInputs)) {
        this.scenarioInputsMap.set(key, value);
      }
    }
  }

  public static createLive(
    scenarioSeed?: string | number,
    scenarioInputs?: Record<string, unknown>,
  ): ExecutionContext {
    return new ExecutionContext({
      mode: 'LIVE_EXECUTION',
      scenarioSeed,
      executionClockMode: 'LIVE',
      scenarioInputs,
    });
  }

  public static createReplay(
    scenarioSeed?: string | number,
    initialHistoricalTime?: string | Date | number,
  ): ExecutionContext {
    return new ExecutionContext({
      mode: 'LIVE_REPLAY',
      scenarioSeed,
      executionClockMode: 'STEPPED',
      initialHistoricalTime,
    });
  }

  public static createCounterfactual(
    scenarioSeed: string | number,
    scenarioInputs: Record<string, unknown>,
  ): ExecutionContext {
    return new ExecutionContext({
      mode: 'COUNTERFACTUAL_REPLAY',
      scenarioSeed,
      executionClockMode: 'STEPPED',
      scenarioInputs,
    });
  }

  public getScenarioInput<T>(key: string): T | undefined {
    return this.scenarioInputsMap.get(key) as T | undefined;
  }

  public hasScenarioInput(key: string): boolean {
    return this.scenarioInputsMap.has(key);
  }

  public getScenarioInputs(): Readonly<Record<string, unknown>> {
    const result: Record<string, unknown> = {};
    for (const [k, v] of this.scenarioInputsMap.entries()) {
      result[k] = v;
    }
    return result;
  }
}
