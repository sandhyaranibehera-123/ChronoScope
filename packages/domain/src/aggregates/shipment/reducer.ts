import { computeEventHash } from '../../core/hash.js';
import {
  InvariantViolationError,
  PreconditionFailedError,
  ValidationError,
} from '../../core/errors.js';
import type { ShipmentState } from './state.js';
import {
  SHIPMENT_AGGREGATE_TYPE,
  type ShipmentCancelledEvent,
  type ShipmentCreatedEvent,
  type ShipmentDeliveredEvent,
  type ShipmentDispatchedEvent,
  type ShipmentEvent,
} from './events.js';
import type {
  CancelShipmentCommand,
  CreateShipmentCommand,
  DeliverShipmentCommand,
  DispatchShipmentCommand,
} from './commands.js';

export function shipmentReducer(state: ShipmentState | null, event: ShipmentEvent): ShipmentState {
  switch (event.event_type) {
    case 'ShipmentCreated': {
      return {
        timeline_id: event.timeline_id,
        aggregate_id: event.aggregate_id,
        order_id: event.payload.order_id,
        status: 'PENDING',
        items: event.payload.items,
        destination: event.payload.destination,
        created_at: event.recorded_at,
        updated_at: event.recorded_at,
      };
    }

    case 'ShipmentDispatched': {
      if (!state)
        throw new InvariantViolationError('Cannot apply ShipmentDispatched to null state');
      return {
        ...state,
        status: 'DISPATCHED',
        tracking_number: event.payload.tracking_number,
        carrier: event.payload.carrier,
        updated_at: event.recorded_at,
      };
    }

    case 'ShipmentDelivered': {
      if (!state) throw new InvariantViolationError('Cannot apply ShipmentDelivered to null state');
      return {
        ...state,
        status: 'DELIVERED',
        updated_at: event.recorded_at,
      };
    }

    case 'ShipmentCancelled': {
      if (!state) throw new InvariantViolationError('Cannot apply ShipmentCancelled to null state');
      return {
        ...state,
        status: 'CANCELLED',
        cancellation_reason: event.payload.reason,
        updated_at: event.recorded_at,
      };
    }

    default: {
      const exhaustiveCheck: never = event;
      throw new InvariantViolationError(
        `Unhandled shipment event type: ${(exhaustiveCheck as ShipmentEvent).event_type}`,
      );
    }
  }
}

// --- Decision Logic ---

export function decideCreateShipment(
  command: CreateShipmentCommand,
  currentState: ShipmentState | null,
  nowIso = new Date().toISOString(),
): ShipmentCreatedEvent {
  if (currentState !== null) {
    throw new PreconditionFailedError(`Shipment '${command.aggregate_id}' already exists.`);
  }

  const { order_id, items, destination } = command.payload;
  if (!order_id || order_id.trim() === '') {
    throw new ValidationError('Order ID cannot be empty');
  }
  if (!items || items.length === 0) {
    throw new ValidationError('Shipment must contain at least one item');
  }
  for (const item of items) {
    if (!item.sku || item.sku.trim() === '') {
      throw new ValidationError('Shipment item SKU cannot be empty');
    }
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new ValidationError(`Shipment item quantity must be positive, got ${item.quantity}`);
    }
  }
  if (!destination || !destination.address || !destination.country) {
    throw new ValidationError('Shipment destination must include address and country');
  }

  const payload = {
    order_id: order_id.trim(),
    items,
    destination,
  };

  return {
    event_id: crypto.randomUUID(),
    timeline_id: command.timeline_id,
    aggregate_id: command.aggregate_id,
    aggregate_type: SHIPMENT_AGGREGATE_TYPE,
    aggregate_sequence: command.expected_sequence + 1,
    event_type: 'ShipmentCreated',
    schema_version: 1,
    payload,
    event_hash: computeEventHash(payload),
    causation_id: command.causation_id,
    correlation_id: command.correlation_id,
    recorded_at: nowIso,
  };
}

export function decideDispatchShipment(
  command: DispatchShipmentCommand,
  currentState: ShipmentState | null,
  nowIso = new Date().toISOString(),
): ShipmentDispatchedEvent {
  if (!currentState) {
    throw new PreconditionFailedError(`Shipment '${command.aggregate_id}' does not exist.`);
  }
  if (currentState.status !== 'PENDING') {
    throw new PreconditionFailedError(
      `Cannot dispatch shipment in status '${currentState.status}'. Must be 'PENDING'.`,
    );
  }

  const { tracking_number, carrier } = command.payload;
  if (!tracking_number || tracking_number.trim() === '') {
    throw new ValidationError('Tracking number cannot be empty');
  }
  if (!carrier || carrier.trim() === '') {
    throw new ValidationError('Carrier cannot be empty');
  }

  const payload = {
    tracking_number: tracking_number.trim(),
    carrier: carrier.trim(),
  };

  return {
    event_id: crypto.randomUUID(),
    timeline_id: command.timeline_id,
    aggregate_id: command.aggregate_id,
    aggregate_type: SHIPMENT_AGGREGATE_TYPE,
    aggregate_sequence: command.expected_sequence + 1,
    event_type: 'ShipmentDispatched',
    schema_version: 1,
    payload,
    event_hash: computeEventHash(payload),
    causation_id: command.causation_id,
    correlation_id: command.correlation_id,
    recorded_at: nowIso,
  };
}

export function decideDeliverShipment(
  command: DeliverShipmentCommand,
  currentState: ShipmentState | null,
  nowIso = new Date().toISOString(),
): ShipmentDeliveredEvent {
  if (!currentState) {
    throw new PreconditionFailedError(`Shipment '${command.aggregate_id}' does not exist.`);
  }
  if (currentState.status !== 'DISPATCHED') {
    throw new PreconditionFailedError(
      `Cannot deliver shipment in status '${currentState.status}'. Must be 'DISPATCHED'.`,
    );
  }

  const payload = {
    delivered_at: command.payload.delivered_at || nowIso,
  };

  return {
    event_id: crypto.randomUUID(),
    timeline_id: command.timeline_id,
    aggregate_id: command.aggregate_id,
    aggregate_type: SHIPMENT_AGGREGATE_TYPE,
    aggregate_sequence: command.expected_sequence + 1,
    event_type: 'ShipmentDelivered',
    schema_version: 1,
    payload,
    event_hash: computeEventHash(payload),
    causation_id: command.causation_id,
    correlation_id: command.correlation_id,
    recorded_at: nowIso,
  };
}

/**
 * Compensation action: Cancel Shipment.
 */
export function decideCancelShipment(
  command: CancelShipmentCommand,
  currentState: ShipmentState | null,
  nowIso = new Date().toISOString(),
): ShipmentCancelledEvent {
  if (!currentState) {
    throw new PreconditionFailedError(`Shipment '${command.aggregate_id}' does not exist.`);
  }
  if (currentState.status === 'DELIVERED') {
    throw new PreconditionFailedError('Cannot cancel a shipment that has already been delivered.');
  }
  if (currentState.status === 'CANCELLED') {
    throw new PreconditionFailedError('Shipment is already cancelled.');
  }

  const payload = {
    reason: command.payload.reason || 'Order cancelled compensation',
  };

  return {
    event_id: crypto.randomUUID(),
    timeline_id: command.timeline_id,
    aggregate_id: command.aggregate_id,
    aggregate_type: SHIPMENT_AGGREGATE_TYPE,
    aggregate_sequence: command.expected_sequence + 1,
    event_type: 'ShipmentCancelled',
    schema_version: 1,
    payload,
    event_hash: computeEventHash(payload),
    causation_id: command.causation_id,
    correlation_id: command.correlation_id,
    recorded_at: nowIso,
  };
}
