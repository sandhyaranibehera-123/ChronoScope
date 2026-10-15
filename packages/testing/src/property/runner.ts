import { RandomGenerator } from './random.js';
import type { Arbitrary } from './arbitrary.js';
import {
  integer,
  boolean,
  string,
  array,
  oneOf,
  record,
  tuple,
  constant,
  shuffledArray,
} from './arbitrary.js';

export interface PropertyTestOptions {
  runs?: number;
  seed?: number;
  verbose?: boolean;
}

export class PropertyAssertionError extends Error {
  public readonly seed: number;
  public readonly runIndex: number;
  public readonly counterexample: unknown;

  constructor(
    message: string,
    seed: number,
    runIndex: number,
    counterexample: unknown,
    originalError?: Error,
  ) {
    const detail = `\n  • Failed at run ${runIndex + 1}\n  • Seed: 0x${seed.toString(16)}\n  • Counterexample: ${JSON.stringify(counterexample, null, 2)}\n  • Caused by: ${originalError?.message ?? 'Invariant predicate returned false or threw'}`;
    super(`PropertyAssertionError: ${message}${detail}`);
    this.name = 'PropertyAssertionError';
    this.seed = seed;
    this.runIndex = runIndex;
    this.counterexample = counterexample;
  }
}

/**
 * Asserts that a given property/predicate holds true for all generated values of an arbitrary.
 */
export async function assertProperty<T>(
  arb: Arbitrary<T>,
  predicate: (value: T) => void | boolean | Promise<void | boolean>,
  options: PropertyTestOptions = {},
): Promise<void> {
  const runs = options.runs ?? 50;
  const seed = options.seed ?? Math.floor(Math.random() * 0xffffffff);
  const rng = new RandomGenerator(seed);

  for (let i = 0; i < runs; i++) {
    const value = arb.generate(rng, i);
    try {
      const res = await predicate(value);
      if (res === false) {
        throw new Error('Predicate returned false');
      }
    } catch (err) {
      // Attempt shrinking if available
      let smallestCounterexample = value;
      if (arb.shrink) {
        try {
          for (const shrunken of arb.shrink(value)) {
            const shrinkRes = await predicate(shrunken);
            if (shrinkRes === false) {
              smallestCounterexample = shrunken;
            }
          }
        } catch {
          // Shrink step failed as well, which is expected for counterexamples
        }
      }

      throw new PropertyAssertionError(
        'Property invariant violated during generative execution',
        seed,
        i,
        smallestCounterexample,
        err instanceof Error ? err : new Error(String(err)),
      );
    }
  }
}

/**
 * fast-check compatible API facade for property-based testing.
 */
export const fc = {
  assert: assertProperty,
  property: <T>(
    arb: Arbitrary<T>,
    predicate: (val: T) => void | boolean | Promise<void | boolean>,
  ) => ({
    arb,
    predicate,
  }),
  integer,
  boolean,
  string,
  array,
  oneof: oneOf,
  record,
  tuple,
  constant,
  shuffledArray,
};
