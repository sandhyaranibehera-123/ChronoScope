import { describe, expect, it } from 'vitest';
import { UpcasterRegistry } from '../upcaster.js';

describe('UpcasterRegistry (Rule 4)', () => {
  it('upcasts through multiple sequential versions', () => {
    const registry = new UpcasterRegistry();

    // v1: { name: string }
    // v2: { firstName: string, lastName: string }
    // v3: { fullName: string, version: 3 }
    registry.register<{ name: string }, { firstName: string; lastName: string }>(
      'UserRenamed',
      1,
      (payload) => {
        const parts = payload.name.split(' ');
        return { firstName: parts[0] ?? '', lastName: parts[1] ?? '' };
      },
    );

    registry.register<
      { firstName: string; lastName: string },
      { fullName: string; version: number }
    >('UserRenamed', 2, (payload) => {
      return { fullName: `${payload.firstName} ${payload.lastName}`, version: 3 };
    });

    const v1Payload = { name: 'Ada Lovelace' };
    const v3Result = registry.upcast<{ fullName: string; version: number }>(
      'UserRenamed',
      v1Payload,
      1,
      3,
    );

    expect(v3Result).toEqual({
      fullName: 'Ada Lovelace',
      version: 3,
    });
  });

  it('returns payload unchanged when sourceVersion === targetVersion', () => {
    const registry = new UpcasterRegistry();
    const payload = { amount: 100 };
    const result = registry.upcast('OrderCreated', payload, 1, 1);
    expect(result).toBe(payload);
  });

  it('throws when missing intermediate upcaster', () => {
    const registry = new UpcasterRegistry();
    expect(() => registry.upcast('MissingEvent', { a: 1 }, 1, 2)).toThrowError(
      /Missing upcaster for MissingEvent/,
    );
  });

  it('throws on attempt to downcast', () => {
    const registry = new UpcasterRegistry();
    expect(() => registry.upcast('SomeEvent', { a: 1 }, 3, 1)).toThrowError(/Cannot downcast/);
  });
});
