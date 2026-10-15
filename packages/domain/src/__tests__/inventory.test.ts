import { describe, expect, it } from 'vitest';
import {
  decideDeductInventory,
  decideInitializeInventory,
  decideReleaseInventory,
  decideReserveInventory,
  inventoryReducer,
  type InitializeInventoryCommand,
  type ReleaseInventoryCommand,
  type ReserveInventoryCommand,
} from '../aggregates/inventory/index.js';
import { foldEvents } from '../core/aggregate.js';
import { InvariantViolationError } from '../core/errors.js';

describe('Inventory Aggregate', () => {
  const timelineId = 'timeline-main';
  const sku = 'SKU-PHONE-XYZ';

  it('initializes inventory and reserves stock correctly', () => {
    const initCmd: InitializeInventoryCommand = {
      command_id: 'cmd-init',
      request_id: 'req-init',
      correlation_id: 'corr-1',
      causation_id: null,
      actor_id: 'actor-1',
      timeline_id: timelineId,
      aggregate_id: sku,
      aggregate_type: 'INVENTORY',
      expected_sequence: 0,
      payload: { sku, initial_quantity: 100 },
    };

    const initEvent = decideInitializeInventory(initCmd, null);
    let state = inventoryReducer(null, initEvent);
    expect(state.total_quantity).toBe(100);
    expect(state.reserved_quantity).toBe(0);
    expect(state.available_quantity).toBe(100);

    // Reserve 20
    const reserveCmd: ReserveInventoryCommand = {
      command_id: 'cmd-res',
      request_id: 'req-res',
      correlation_id: 'corr-1',
      causation_id: initEvent.event_id,
      actor_id: 'actor-1',
      timeline_id: timelineId,
      aggregate_id: sku,
      aggregate_type: 'INVENTORY',
      expected_sequence: 1,
      payload: { order_id: 'order-1', quantity: 20 },
    };

    const reserveEvent = decideReserveInventory(reserveCmd, state);
    state = inventoryReducer(state, reserveEvent);
    expect(state.total_quantity).toBe(100);
    expect(state.reserved_quantity).toBe(20);
    expect(state.available_quantity).toBe(80);
  });

  it('prevents overselling (cannot reserve more than available)', () => {
    const initCmd: InitializeInventoryCommand = {
      command_id: 'cmd-init',
      request_id: 'req-init',
      correlation_id: 'corr-1',
      causation_id: null,
      actor_id: 'actor-1',
      timeline_id: timelineId,
      aggregate_id: sku,
      aggregate_type: 'INVENTORY',
      expected_sequence: 0,
      payload: { sku, initial_quantity: 5 },
    };
    const state = inventoryReducer(null, decideInitializeInventory(initCmd, null));

    const badReserveCmd: ReserveInventoryCommand = {
      command_id: 'cmd-res-bad',
      request_id: 'req-res',
      correlation_id: 'corr-1',
      causation_id: null,
      actor_id: 'actor-1',
      timeline_id: timelineId,
      aggregate_id: sku,
      aggregate_type: 'INVENTORY',
      expected_sequence: 1,
      payload: { order_id: 'order-1', quantity: 10 }, // exceeds 5 available
    };

    expect(() => decideReserveInventory(badReserveCmd, state)).toThrow(InvariantViolationError);
  });

  it('releases reserved inventory (compensation action)', () => {
    const events = [];
    const initEvent = decideInitializeInventory(
      {
        command_id: 'c1',
        request_id: 'r1',
        correlation_id: 'corr-1',
        causation_id: null,
        actor_id: 'a1',
        timeline_id: timelineId,
        aggregate_id: sku,
        aggregate_type: 'INVENTORY',
        expected_sequence: 0,
        payload: { sku, initial_quantity: 50 },
      },
      null,
    );
    events.push(initEvent);
    let state = inventoryReducer(null, initEvent);

    const resEvent = decideReserveInventory(
      {
        command_id: 'c2',
        request_id: 'r2',
        correlation_id: 'corr-1',
        causation_id: initEvent.event_id,
        actor_id: 'a1',
        timeline_id: timelineId,
        aggregate_id: sku,
        aggregate_type: 'INVENTORY',
        expected_sequence: 1,
        payload: { order_id: 'order-1', quantity: 15 },
      },
      state,
    );
    events.push(resEvent);
    state = inventoryReducer(state, resEvent);
    expect(state.reserved_quantity).toBe(15);
    expect(state.available_quantity).toBe(35);

    // Release 15 (compensation)
    const relEvent = decideReleaseInventory(
      {
        command_id: 'c3',
        request_id: 'r3',
        correlation_id: 'corr-1',
        causation_id: resEvent.event_id,
        actor_id: 'a1',
        timeline_id: timelineId,
        aggregate_id: sku,
        aggregate_type: 'INVENTORY',
        expected_sequence: 2,
        payload: { order_id: 'order-1', quantity: 15, reason: 'Payment failed' },
      },
      state,
    );
    events.push(relEvent);
    state = inventoryReducer(state, relEvent);
    expect(state.reserved_quantity).toBe(0);
    expect(state.available_quantity).toBe(50);

    const folded = foldEvents(events, inventoryReducer);
    expect(folded.aggregate_sequence).toBe(3);
    expect(folded.state).toEqual(state);
  });

  it('cannot release more than currently reserved', () => {
    const initEvent = decideInitializeInventory(
      {
        command_id: 'c1',
        request_id: 'r1',
        correlation_id: 'corr-1',
        causation_id: null,
        actor_id: 'a1',
        timeline_id: timelineId,
        aggregate_id: sku,
        aggregate_type: 'INVENTORY',
        expected_sequence: 0,
        payload: { sku, initial_quantity: 50 },
      },
      null,
    );
    const state = inventoryReducer(null, initEvent);

    const relCmd: ReleaseInventoryCommand = {
      command_id: 'c2',
      request_id: 'r2',
      correlation_id: 'corr-1',
      causation_id: null,
      actor_id: 'a1',
      timeline_id: timelineId,
      aggregate_id: sku,
      aggregate_type: 'INVENTORY',
      expected_sequence: 1,
      payload: { order_id: 'order-1', quantity: 5, reason: 'Bad release' },
    };
    expect(() => decideReleaseInventory(relCmd, state)).toThrow(InvariantViolationError);
  });

  it('deducts inventory upon successful order completion', () => {
    let state = inventoryReducer(
      null,
      decideInitializeInventory(
        {
          command_id: 'c1',
          request_id: 'r1',
          correlation_id: 'corr-1',
          causation_id: null,
          actor_id: 'a1',
          timeline_id: timelineId,
          aggregate_id: sku,
          aggregate_type: 'INVENTORY',
          expected_sequence: 0,
          payload: { sku, initial_quantity: 50 },
        },
        null,
      ),
    );

    state = inventoryReducer(
      state,
      decideReserveInventory(
        {
          command_id: 'c2',
          request_id: 'r2',
          correlation_id: 'corr-1',
          causation_id: null,
          actor_id: 'a1',
          timeline_id: timelineId,
          aggregate_id: sku,
          aggregate_type: 'INVENTORY',
          expected_sequence: 1,
          payload: { order_id: 'order-1', quantity: 10 },
        },
        state,
      ),
    );

    const deductEvent = decideDeductInventory(
      {
        command_id: 'c3',
        request_id: 'r3',
        correlation_id: 'corr-1',
        causation_id: null,
        actor_id: 'a1',
        timeline_id: timelineId,
        aggregate_id: sku,
        aggregate_type: 'INVENTORY',
        expected_sequence: 2,
        payload: { order_id: 'order-1', quantity: 10 },
      },
      state,
    );
    state = inventoryReducer(state, deductEvent);

    expect(state.total_quantity).toBe(40);
    expect(state.reserved_quantity).toBe(0);
    expect(state.available_quantity).toBe(40);
  });
});
