import { describe, expect, it } from 'vitest';
import { createDomainEvent, validateDomainEvent } from '../envelope.js';

describe('Domain Event Envelope (Rules 3, 4, 11)', () => {
  it('creates a frozen domain event with canonical event_hash', () => {
    const event = createDomainEvent({
      timelineId: '00000000-0000-0000-0000-000000000001',
      aggregateId: 'ord-123',
      aggregateType: 'Order',
      aggregateSequence: 1,
      eventType: 'OrderCreated',
      payload: { customerId: 'cust-456', currency: 'USD' },
      correlationId: 'corr-789',
    });

    expect(Object.isFrozen(event)).toBe(true);
    expect(event.event_id).toBeDefined();
    expect(event.aggregate_sequence).toBe(1);
    expect(event.schema_version).toBe(1);
    expect(event.event_hash).toHaveLength(64);
    expect(event.causation_id).toBeNull();
    expect(event.recorded_at).toBeDefined();

    // Validates cleanly
    expect(() => validateDomainEvent(event)).not.toThrow();
  });

  it('detects corrupted or mismatched event_hash', () => {
    const event = createDomainEvent({
      timelineId: '00000000-0000-0000-0000-000000000001',
      aggregateId: 'ord-123',
      aggregateType: 'Order',
      aggregateSequence: 1,
      eventType: 'OrderCreated',
      payload: { customerId: 'cust-456', currency: 'USD' },
      correlationId: 'corr-789',
    });

    const tampered = { ...event, event_hash: 'a'.repeat(64) };
    expect(() => validateDomainEvent(tampered)).toThrowError(/Event hash mismatch/);
  });
});
