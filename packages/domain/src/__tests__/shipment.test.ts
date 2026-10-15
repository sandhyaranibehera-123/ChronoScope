import { describe, expect, it } from 'vitest';
import {
  decideCancelShipment,
  decideCreateShipment,
  decideDeliverShipment,
  decideDispatchShipment,
  shipmentReducer,
  type CancelShipmentCommand,
  type CreateShipmentCommand,
  type DeliverShipmentCommand,
  type DispatchShipmentCommand,
  type ShippingDestination,
} from '../aggregates/shipment/index.js';
import { foldEvents } from '../core/aggregate.js';
import { PreconditionFailedError } from '../core/errors.js';

describe('Shipment Aggregate', () => {
  const timelineId = 'timeline-main';
  const shipmentId = 'ship-500';
  const orderId = 'order-101';
  const destination: ShippingDestination = {
    address: '123 Main Street',
    city: 'Bangalore',
    postal_code: '560001',
    country: 'IND',
  };
  const items = [{ sku: 'SKU-A', quantity: 2 }];

  it('creates, dispatches, and delivers shipment', () => {
    const events = [];

    // 1. Create
    const createCmd: CreateShipmentCommand = {
      command_id: 'cmd-create',
      request_id: 'req-create',
      correlation_id: 'corr-1',
      causation_id: null,
      actor_id: 'actor-1',
      timeline_id: timelineId,
      aggregate_id: shipmentId,
      aggregate_type: 'SHIPMENT',
      expected_sequence: 0,
      payload: { order_id: orderId, items, destination },
    };
    const createEvent = decideCreateShipment(createCmd, null);
    events.push(createEvent);
    let state = shipmentReducer(null, createEvent);
    expect(state.status).toBe('PENDING');
    expect(state.items).toHaveLength(1);

    // 2. Dispatch
    const dispatchCmd: DispatchShipmentCommand = {
      command_id: 'cmd-dispatch',
      request_id: 'req-dispatch',
      correlation_id: 'corr-1',
      causation_id: createEvent.event_id,
      actor_id: 'actor-1',
      timeline_id: timelineId,
      aggregate_id: shipmentId,
      aggregate_type: 'SHIPMENT',
      expected_sequence: 1,
      payload: { tracking_number: 'TRK-987654', carrier: 'BLUE_DART' },
    };
    const dispatchEvent = decideDispatchShipment(dispatchCmd, state);
    events.push(dispatchEvent);
    state = shipmentReducer(state, dispatchEvent);
    expect(state.status).toBe('DISPATCHED');
    expect(state.tracking_number).toBe('TRK-987654');
    expect(state.carrier).toBe('BLUE_DART');

    // 3. Deliver
    const deliverCmd: DeliverShipmentCommand = {
      command_id: 'cmd-deliver',
      request_id: 'req-deliver',
      correlation_id: 'corr-1',
      causation_id: dispatchEvent.event_id,
      actor_id: 'actor-1',
      timeline_id: timelineId,
      aggregate_id: shipmentId,
      aggregate_type: 'SHIPMENT',
      expected_sequence: 2,
      payload: { delivered_at: new Date().toISOString() },
    };
    const deliverEvent = decideDeliverShipment(deliverCmd, state);
    events.push(deliverEvent);
    state = shipmentReducer(state, deliverEvent);
    expect(state.status).toBe('DELIVERED');

    const folded = foldEvents(events, shipmentReducer);
    expect(folded.aggregate_sequence).toBe(3);
    expect(folded.state).toEqual(state);
  });

  it('cancels undelivered shipment (compensation action)', () => {
    const createEvent = decideCreateShipment(
      {
        command_id: 'cmd-create',
        request_id: 'req-create',
        correlation_id: 'corr-1',
        causation_id: null,
        actor_id: 'actor-1',
        timeline_id: timelineId,
        aggregate_id: shipmentId,
        aggregate_type: 'SHIPMENT',
        expected_sequence: 0,
        payload: { order_id: orderId, items, destination },
      },
      null,
    );
    let state = shipmentReducer(null, createEvent);

    const cancelCmd: CancelShipmentCommand = {
      command_id: 'cmd-cancel',
      request_id: 'req-cancel',
      correlation_id: 'corr-1',
      causation_id: createEvent.event_id,
      actor_id: 'actor-1',
      timeline_id: timelineId,
      aggregate_id: shipmentId,
      aggregate_type: 'SHIPMENT',
      expected_sequence: 1,
      payload: { reason: 'Order cancelled compensation' },
    };
    const cancelEvent = decideCancelShipment(cancelCmd, state);
    state = shipmentReducer(state, cancelEvent);
    expect(state.status).toBe('CANCELLED');
    expect(state.cancellation_reason).toBe('Order cancelled compensation');
  });

  it('cannot cancel delivered shipment', () => {
    let state = shipmentReducer(
      null,
      decideCreateShipment(
        {
          command_id: 'c1',
          request_id: 'r1',
          correlation_id: 'corr-1',
          causation_id: null,
          actor_id: 'a1',
          timeline_id: timelineId,
          aggregate_id: shipmentId,
          aggregate_type: 'SHIPMENT',
          expected_sequence: 0,
          payload: { order_id: orderId, items, destination },
        },
        null,
      ),
    );
    state = { ...state, status: 'DELIVERED' };

    const cancelCmd: CancelShipmentCommand = {
      command_id: 'c2',
      request_id: 'r2',
      correlation_id: 'corr-1',
      causation_id: null,
      actor_id: 'a1',
      timeline_id: timelineId,
      aggregate_id: shipmentId,
      aggregate_type: 'SHIPMENT',
      expected_sequence: 1,
      payload: { reason: 'Cancelled' },
    };
    expect(() => decideCancelShipment(cancelCmd, state)).toThrow(PreconditionFailedError);
  });
});
