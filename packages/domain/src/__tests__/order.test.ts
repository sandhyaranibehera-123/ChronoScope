import { describe, expect, it } from 'vitest';
import {
  decideAddOrderItem,
  decideCancelOrder,
  decideConfirmOrder,
  decideCreateOrder,
  decideMarkOrderAllocated,
  decideMarkOrderPaid,
  decideMarkOrderShipped,
  orderReducer,
  type AddOrderItemCommand,
  type CancelOrderCommand,
  type ConfirmOrderCommand,
  type CreateOrderCommand,
} from '../aggregates/order/index.js';
import { foldEvents } from '../core/aggregate.js';
import {
  InvariantViolationError,
  PreconditionFailedError,
  ValidationError,
} from '../core/errors.js';

describe('Order Aggregate', () => {
  const timelineId = 'timeline-main';
  const orderId = 'order-101';
  const customerId = 'cust-88';
  const currency = 'USD';

  it('creates order with CREATED status and empty items', () => {
    const createCmd: CreateOrderCommand = {
      command_id: 'cmd-1',
      request_id: 'req-1',
      correlation_id: 'corr-1',
      causation_id: null,
      actor_id: 'actor-1',
      timeline_id: timelineId,
      aggregate_id: orderId,
      aggregate_type: 'ORDER',
      expected_sequence: 0,
      payload: { customer_id: customerId, currency },
    };

    const event = decideCreateOrder(createCmd, null);
    expect(event.event_type).toBe('OrderCreated');
    expect(event.aggregate_sequence).toBe(1);
    expect(event.payload.customer_id).toBe(customerId);
    expect(event.payload.currency).toBe('USD');

    const state = orderReducer(null, event);
    expect(state.status).toBe('CREATED');
    expect(state.items).toEqual([]);
    expect(state.total_amount_minor).toBe(0n);
  });

  it('rejects creating order with empty customer ID or invalid currency', () => {
    const badCmd: CreateOrderCommand = {
      command_id: 'cmd-1',
      request_id: 'req-1',
      correlation_id: 'corr-1',
      causation_id: null,
      actor_id: 'actor-1',
      timeline_id: timelineId,
      aggregate_id: orderId,
      aggregate_type: 'ORDER',
      expected_sequence: 0,
      payload: { customer_id: '', currency: 'USD' },
    };
    expect(() => decideCreateOrder(badCmd, null)).toThrow(ValidationError);

    const badCurrCmd = { ...badCmd, payload: { customer_id: 'cust-1', currency: 'INVALID' } };
    expect(() => decideCreateOrder(badCurrCmd, null)).toThrow(ValidationError);
  });

  it('adds items and updates totalAmountMinor accurately using BigInt', () => {
    let state = orderReducer(null, {
      event_id: 'e1',
      timeline_id: timelineId,
      aggregate_id: orderId,
      aggregate_type: 'ORDER',
      aggregate_sequence: 1,
      event_type: 'OrderCreated',
      schema_version: 1,
      payload: { customer_id: customerId, currency },
      event_hash: 'hash1',
      causation_id: null,
      correlation_id: 'corr-1',
      recorded_at: new Date().toISOString(),
    });

    const addCmd: AddOrderItemCommand = {
      command_id: 'cmd-2',
      request_id: 'req-2',
      correlation_id: 'corr-1',
      causation_id: 'e1',
      actor_id: 'actor-1',
      timeline_id: timelineId,
      aggregate_id: orderId,
      aggregate_type: 'ORDER',
      expected_sequence: 1,
      payload: {
        item: {
          sku: 'SKU-LAPTOP',
          quantity: 2,
          unitAmountMinor: 120000n, // $1200.00
          totalAmountMinor: 240000n,
        },
      },
    };

    const addEvent = decideAddOrderItem(addCmd, state);
    state = orderReducer(state, addEvent);

    expect(state.items).toHaveLength(1);
    expect(state.total_amount_minor).toBe(240000n);

    // Add a second item
    const addCmd2: AddOrderItemCommand = {
      ...addCmd,
      command_id: 'cmd-3',
      expected_sequence: 2,
      payload: {
        item: {
          sku: 'SKU-MOUSE',
          quantity: 1,
          unitAmountMinor: 5000n, // $50.00
          totalAmountMinor: 5000n,
        },
      },
    };
    const addEvent2 = decideAddOrderItem(addCmd2, state);
    state = orderReducer(state, addEvent2);

    expect(state.items).toHaveLength(2);
    expect(state.total_amount_minor).toBe(245000n);
  });

  it('cannot confirm order with no items', () => {
    const state = orderReducer(null, {
      event_id: 'e1',
      timeline_id: timelineId,
      aggregate_id: orderId,
      aggregate_type: 'ORDER',
      aggregate_sequence: 1,
      event_type: 'OrderCreated',
      schema_version: 1,
      payload: { customer_id: customerId, currency },
      event_hash: 'hash1',
      causation_id: null,
      correlation_id: 'corr-1',
      recorded_at: new Date().toISOString(),
    });

    const confirmCmd: ConfirmOrderCommand = {
      command_id: 'cmd-confirm',
      request_id: 'req-confirm',
      correlation_id: 'corr-1',
      causation_id: 'e1',
      actor_id: 'actor-1',
      timeline_id: timelineId,
      aggregate_id: orderId,
      aggregate_type: 'ORDER',
      expected_sequence: 1,
      payload: {},
    };

    expect(() => decideConfirmOrder(confirmCmd, state)).toThrow(InvariantViolationError);
  });

  it('progresses through full lifecycle: CREATED -> CONFIRMED -> PAID -> ALLOCATED -> SHIPPED', () => {
    const events = [];

    // 1. Create
    const e1 = decideCreateOrder(
      {
        command_id: 'c1',
        request_id: 'r1',
        correlation_id: 'corr-1',
        causation_id: null,
        actor_id: 'a1',
        timeline_id: timelineId,
        aggregate_id: orderId,
        aggregate_type: 'ORDER',
        expected_sequence: 0,
        payload: { customer_id: customerId, currency },
      },
      null,
    );
    events.push(e1);
    let state = orderReducer(null, e1);

    // 2. Add Item
    const e2 = decideAddOrderItem(
      {
        command_id: 'c2',
        request_id: 'r2',
        correlation_id: 'corr-1',
        causation_id: e1.event_id,
        actor_id: 'a1',
        timeline_id: timelineId,
        aggregate_id: orderId,
        aggregate_type: 'ORDER',
        expected_sequence: 1,
        payload: {
          item: { sku: 'SKU-A', quantity: 1, unitAmountMinor: 1000n, totalAmountMinor: 1000n },
        },
      },
      state,
    );
    events.push(e2);
    state = orderReducer(state, e2);

    // 3. Confirm
    const e3 = decideConfirmOrder(
      {
        command_id: 'c3',
        request_id: 'r3',
        correlation_id: 'corr-1',
        causation_id: e2.event_id,
        actor_id: 'a1',
        timeline_id: timelineId,
        aggregate_id: orderId,
        aggregate_type: 'ORDER',
        expected_sequence: 2,
        payload: {},
      },
      state,
    );
    events.push(e3);
    state = orderReducer(state, e3);
    expect(state.status).toBe('CONFIRMED');

    // 4. Paid
    const e4 = decideMarkOrderPaid(
      {
        command_id: 'c4',
        request_id: 'r4',
        correlation_id: 'corr-1',
        causation_id: e3.event_id,
        actor_id: 'a1',
        timeline_id: timelineId,
        aggregate_id: orderId,
        aggregate_type: 'ORDER',
        expected_sequence: 3,
        payload: { payment_id: 'pay-1', amount_minor: 1000n, currency: 'USD' },
      },
      state,
    );
    events.push(e4);
    state = orderReducer(state, e4);
    expect(state.status).toBe('PAID');

    // 5. Allocated
    const e5 = decideMarkOrderAllocated(
      {
        command_id: 'c5',
        request_id: 'r5',
        correlation_id: 'corr-1',
        causation_id: e4.event_id,
        actor_id: 'a1',
        timeline_id: timelineId,
        aggregate_id: orderId,
        aggregate_type: 'ORDER',
        expected_sequence: 4,
        payload: { allocation_id: 'alloc-1' },
      },
      state,
    );
    events.push(e5);
    state = orderReducer(state, e5);
    expect(state.status).toBe('ALLOCATED');

    // 6. Shipped
    const e6 = decideMarkOrderShipped(
      {
        command_id: 'c6',
        request_id: 'r6',
        correlation_id: 'corr-1',
        causation_id: e5.event_id,
        actor_id: 'a1',
        timeline_id: timelineId,
        aggregate_id: orderId,
        aggregate_type: 'ORDER',
        expected_sequence: 5,
        payload: { shipment_id: 'ship-1' },
      },
      state,
    );
    events.push(e6);
    state = orderReducer(state, e6);
    expect(state.status).toBe('SHIPPED');

    // Verify foldEvents produces identical state deterministically
    const folded = foldEvents(events, orderReducer);
    expect(folded.aggregate_sequence).toBe(6);
    expect(folded.state).toEqual(state);
  });

  it('rejects cancelling a shipped order', () => {
    let state = orderReducer(null, {
      event_id: 'e1',
      timeline_id: timelineId,
      aggregate_id: orderId,
      aggregate_type: 'ORDER',
      aggregate_sequence: 1,
      event_type: 'OrderCreated',
      schema_version: 1,
      payload: { customer_id: customerId, currency },
      event_hash: 'hash1',
      causation_id: null,
      correlation_id: 'corr-1',
      recorded_at: new Date().toISOString(),
    });
    state = { ...state, status: 'SHIPPED' };

    const cancelCmd: CancelOrderCommand = {
      command_id: 'c-cancel',
      request_id: 'r-cancel',
      correlation_id: 'corr-1',
      causation_id: null,
      actor_id: 'a1',
      timeline_id: timelineId,
      aggregate_id: orderId,
      aggregate_type: 'ORDER',
      expected_sequence: 2,
      payload: { reason: 'Customer changed mind' },
    };

    expect(() => decideCancelOrder(cancelCmd, state)).toThrow(PreconditionFailedError);
  });
});
