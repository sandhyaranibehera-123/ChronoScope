import type { RandomGenerator } from './random.js';

export interface Arbitrary<T> {
  generate(rng: RandomGenerator, size: number): T;
  shrink?(value: T): Iterable<T>;
}

export function integer(min: number = 0, max: number = 100): Arbitrary<number> {
  return {
    generate(rng: RandomGenerator): number {
      return rng.nextInt(min, max);
    },
    *shrink(value: number): Iterable<number> {
      if (value > min) yield min;
      const mid = Math.floor((value + min) / 2);
      if (mid !== value && mid !== min) yield mid;
      if (value - 1 >= min) yield value - 1;
    },
  };
}

export function boolean(): Arbitrary<boolean> {
  return {
    generate(rng: RandomGenerator): boolean {
      return rng.nextBoolean();
    },
    *shrink(value: boolean): Iterable<boolean> {
      if (value) yield false;
    },
  };
}

export function constant<T>(val: T): Arbitrary<T> {
  return {
    generate(): T {
      return val;
    },
  };
}

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function string(
  options: { minLength?: number; maxLength?: number } = {},
): Arbitrary<string> {
  const min = options.minLength ?? 1;
  const max = options.maxLength ?? 16;
  return {
    generate(rng: RandomGenerator): string {
      const len = rng.nextInt(min, max);
      let res = '';
      for (let i = 0; i < len; i++) {
        res += ALPHABET[rng.nextInt(0, ALPHABET.length - 1)];
      }
      return res;
    },
  };
}

export function array<T>(
  elementArb: Arbitrary<T>,
  options: { minLength?: number; maxLength?: number } = {},
): Arbitrary<T[]> {
  const min = options.minLength ?? 0;
  const max = options.maxLength ?? 10;
  return {
    generate(rng: RandomGenerator, size: number): T[] {
      const len = rng.nextInt(min, max);
      const res: T[] = [];
      for (let i = 0; i < len; i++) {
        res.push(elementArb.generate(rng, size));
      }
      return res;
    },
    *shrink(arr: T[]): Iterable<T[]> {
      if (arr.length > min) {
        yield arr.slice(0, min);
        yield arr.slice(0, Math.floor(arr.length / 2));
        yield arr.slice(1);
      }
    },
  };
}

export function oneOf<T>(...arbs: Arbitrary<T>[]): Arbitrary<T> {
  if (arbs.length === 0) {
    throw new Error('oneOf requires at least one arbitrary');
  }
  return {
    generate(rng: RandomGenerator, size: number): T {
      const chosen = rng.pickOne(arbs);
      return chosen.generate(rng, size);
    },
  };
}

export function tuple<T extends readonly unknown[]>(
  ...arbs: { [K in keyof T]: Arbitrary<T[K]> }
): Arbitrary<T> {
  return {
    generate(rng: RandomGenerator, size: number): T {
      return arbs.map((a) => a.generate(rng, size)) as unknown as T;
    },
  };
}

export type RecordSpec<T> = {
  [K in keyof T]: Arbitrary<T[K]>;
};

export function record<T extends Record<string, unknown>>(spec: RecordSpec<T>): Arbitrary<T> {
  return {
    generate(rng: RandomGenerator, size: number): T {
      const res = {} as T;
      for (const [key, arb] of Object.entries(spec)) {
        (res as Record<string, unknown>)[key] = (arb as Arbitrary<unknown>).generate(rng, size);
      }
      return res;
    },
  };
}

export function shuffledArray<T>(items: readonly T[]): Arbitrary<T[]> {
  return {
    generate(rng: RandomGenerator): T[] {
      return rng.shuffle(items);
    },
  };
}
