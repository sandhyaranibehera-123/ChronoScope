import { describe, expect, it } from 'vitest';
import { canonicalJson, computeEventHash, computeStateHash } from '../core/hash.js';

describe('Deterministic Hashing & Canonical JSON (Rules 9 & 11)', () => {
  it('serializes objects identically regardless of key insertion order', () => {
    const obj1 = {
      zebra: 10,
      apple: 'red',
      banana: { yellow: true, count: 5n },
    };

    const obj2 = {
      banana: { count: 5n, yellow: true },
      apple: 'red',
      zebra: 10,
    };

    expect(canonicalJson(obj1)).toBe(canonicalJson(obj2));
    expect(computeStateHash(obj1)).toBe(computeStateHash(obj2));
  });

  it('excludes transport metadata from state hashing (Rule 9)', () => {
    const baseState = {
      order_id: 'order-100',
      status: 'CONFIRMED',
      total_amount_minor: 50000n,
    };

    const stateWithTransport1 = {
      ...baseState,
      event_id: 'evt-111',
      request_id: 'req-222',
      command_id: 'cmd-333',
      trace_id: 'trace-444',
      span_id: 'span-555',
      recorded_at: '2026-09-19T10:00:00.000Z',
    };

    const stateWithTransport2 = {
      ...baseState,
      event_id: 'evt-999',
      request_id: 'req-888',
      command_id: 'cmd-777',
      trace_id: 'trace-666',
      span_id: 'span-555',
      recorded_at: '2026-09-19T12:00:00.000Z',
    };

    expect(computeStateHash(stateWithTransport1)).toBe(computeStateHash(baseState));
    expect(computeStateHash(stateWithTransport2)).toBe(computeStateHash(baseState));
  });

  it('produces exactly 64-character lowercase hexadecimal hash', () => {
    const hash = computeStateHash({ foo: 'bar', n: 42 });
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('computes event hash over payload canonically', () => {
    const payload1 = { sku: 'SKU-A', quantity: 2, amount: 100n };
    const payload2 = { amount: 100n, sku: 'SKU-A', quantity: 2 };

    expect(computeEventHash(payload1)).toBe(computeEventHash(payload2));
  });
});
