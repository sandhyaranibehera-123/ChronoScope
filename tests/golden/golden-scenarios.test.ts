import { describe, expect, it } from 'vitest';
import { InMemoryAggregateRepository } from '@chronoscope/database';
import {
  computeStateHash,
  decideAddOrderItem,
  decideConfirmOrder,
  decideCreateOrder,
  orderReducer,
  type AddOrderItemCommand,
  type ConfirmOrderCommand,
  type CreateOrderCommand,
} from '@chronoscope/domain';

describe('Golden Scenarios: Event Sourced Dynamic Order Fulfillment (Rules 3, 5, 6, 8, 9)', () => {
  const TIMELINE_MAIN = '00000000-0000-0000-0000-000000000001';

  it('runs complete order fulfillment lifecycle through event store asserting three-way invariant', async () => {
    const orderRepo = new InMemoryAggregateRepository('Order');
    const orderId = 'ord-golden-1';

    // Step 1: Create Order (Sequence 0 -> 1)
    const createCmd: CreateOrderCommand = {
      command_id: 'cmd-1',
      request_id: 'req-1',
      correlation_id: 'corr-1',
      causation_id: null,
      actor_id: 'cust-sarah',
      timeline_id: TIMELINE_MAIN,
      aggregate_id: orderId,
      aggregate_type: 'Order',
      expected_sequence: 0,
      payload: {
        customer_id: 'cust-sarah',
        currency: 'USD',
      },
    };

    const event1 = decideCreateOrder(createCmd, null);
    const state1 = orderReducer(null, event1);
    const stateHash1 = computeStateHash(state1);

    const append1 = await orderRepo.save(TIMELINE_MAIN, orderId, 0, [event1], state1, stateHash1);

    expect(append1.success).toBe(true);
    expect(append1.newSequence).toBe(1);

    // Assert Three-Way Invariant: aggregate_versions == aggregate_state == MAX(events)
    const snapshot1 = await orderRepo.load(TIMELINE_MAIN, orderId);
    expect(snapshot1).not.toBeNull();
    expect(snapshot1!.sequence).toBe(1);
    expect(snapshot1!.state.status).toBe('CREATED');
    expect(snapshot1!.stateHash).toBe(stateHash1);

    const storedEvents1 = orderRepo.getEvents(TIMELINE_MAIN, orderId);
    expect(storedEvents1).toHaveLength(1);
    expect(storedEvents1[0]!.aggregateSequence).toBe(1);
    expect(storedEvents1[0]!.timelinePosition).toBe(1);

    // Step 2: Add 2 items in sequential steps (Sequence 1 -> 3)
    const item1Cmd: AddOrderItemCommand = {
      command_id: 'cmd-2',
      request_id: 'req-2',
      correlation_id: 'corr-1',
      causation_id: 'cmd-1',
      actor_id: 'cust-sarah',
      timeline_id: TIMELINE_MAIN,
      aggregate_id: orderId,
      aggregate_type: 'Order',
      expected_sequence: 1,
      payload: {
        item: {
          sku: 'LAPTOP-M3',
          quantity: 1,
          unitAmountMinor: 199900n,
          totalAmountMinor: 199900n, // $1,999.00
        },
      },
    };

    const event2 = decideAddOrderItem(item1Cmd, snapshot1!.state);
    const state2a = orderReducer(snapshot1!.state, event2);

    const item2Cmd: AddOrderItemCommand = {
      command_id: 'cmd-3',
      request_id: 'req-3',
      correlation_id: 'corr-1',
      causation_id: 'cmd-2',
      actor_id: 'cust-sarah',
      timeline_id: TIMELINE_MAIN,
      aggregate_id: orderId,
      aggregate_type: 'Order',
      expected_sequence: 2,
      payload: {
        item: {
          sku: 'USB-C-DOCK',
          quantity: 2,
          unitAmountMinor: 9900n,
          totalAmountMinor: 19800n, // $198.00 total
        },
      },
    };

    const event3 = decideAddOrderItem(item2Cmd, state2a);
    const state2b = orderReducer(state2a, event3);
    const stateHash2b = computeStateHash(state2b);

    // Multi-event command fold before transaction (Rule 9)
    const append2 = await orderRepo.save(
      TIMELINE_MAIN,
      orderId,
      1,
      [event2, event3],
      state2b,
      stateHash2b,
    );

    expect(append2.success).toBe(true);
    expect(append2.newSequence).toBe(3);

    // Verify Three-Way Invariant after multi-event batch
    const snapshot2 = await orderRepo.load(TIMELINE_MAIN, orderId);
    expect(snapshot2!.sequence).toBe(3);
    expect(snapshot2!.state.items).toHaveLength(2);
    expect(snapshot2!.state.total_amount_minor).toBe(219700n); // 199900 + 19800
    expect(snapshot2!.stateHash).toBe(stateHash2b);

    const storedEvents2 = orderRepo.getEvents(TIMELINE_MAIN, orderId);
    expect(storedEvents2).toHaveLength(3);
    expect(storedEvents2.map((e) => e.aggregateSequence)).toEqual([1, 2, 3]);
    expect(storedEvents2.map((e) => e.timelinePosition)).toEqual([1, 2, 3]);

    // Step 3: Confirm Order (Sequence 3 -> 4)
    const confirmCmd: ConfirmOrderCommand = {
      command_id: 'cmd-4',
      request_id: 'req-4',
      correlation_id: 'corr-1',
      causation_id: 'cmd-3',
      actor_id: 'cust-sarah',
      timeline_id: TIMELINE_MAIN,
      aggregate_id: orderId,
      aggregate_type: 'Order',
      expected_sequence: 3,
      payload: {},
    };

    const event4 = decideConfirmOrder(confirmCmd, snapshot2!.state);
    const state3 = orderReducer(snapshot2!.state, event4);
    const stateHash3 = computeStateHash(state3);

    const append3 = await orderRepo.save(TIMELINE_MAIN, orderId, 3, [event4], state3, stateHash3);

    expect(append3.success).toBe(true);
    expect(append3.newSequence).toBe(4);

    const snapshot3 = await orderRepo.load(TIMELINE_MAIN, orderId);
    expect(snapshot3!.sequence).toBe(4);
    expect(snapshot3!.state.status).toBe('CONFIRMED');

    // Verify Outbox Entries: exactly 4 pending messages with composite partition key
    const outbox = orderRepo.getOutbox('PENDING');
    expect(outbox).toHaveLength(4);
    for (const record of outbox) {
      expect(record.partitionKey).toBe(`${TIMELINE_MAIN}:${orderId}`);
      expect(record.topic).toBe('chronoscope.domain.events');
    }
  });
});
