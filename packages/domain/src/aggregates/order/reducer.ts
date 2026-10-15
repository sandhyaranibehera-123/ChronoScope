import { computeEventHash } from '../../core/hash.js';
import {
  InvariantViolationError,
  PreconditionFailedError,
  ValidationError,
} from '../../core/errors.js';
import type { OrderState } from './state.js';
import {
  ORDER_AGGREGATE_TYPE,
  type OrderCancelledEvent,
  type OrderConfirmedEvent,
  type OrderCreatedEvent,
  type OrderEvent,
  type OrderItemAddedEvent,
  type OrderPaidEvent,
  type OrderAllocatedEvent,
  type OrderShippedEvent,
} from './events.js';
import type {
  AddOrderItemCommand,
  CancelOrderCommand,
  ConfirmOrderCommand,
  CreateOrderCommand,
  MarkOrderAllocatedCommand,
  MarkOrderPaidCommand,
  MarkOrderShippedCommand,
} from './commands.js';

/**
 * Pure state transition reducer for Order aggregate.
 * system-guarantees.md rule 2: "Neither database package ever invokes a domain reducer."
 */
export function orderReducer(state: OrderState | null, event: OrderEvent): OrderState {
  switch (event.event_type) {
    case 'OrderCreated': {
      return {
        timeline_id: event.timeline_id,
        aggregate_id: event.aggregate_id,
        customer_id: event.payload.customer_id,
        currency: event.payload.currency,
        status: 'CREATED',
        items: [],
        total_amount_minor: 0n,
        created_at: event.recorded_at,
        updated_at: event.recorded_at,
      };
    }

    case 'OrderItemAdded': {
      if (!state) throw new InvariantViolationError('Cannot apply OrderItemAdded to null state');
      const item = event.payload.item;
      const newItems = [...state.items, item];
      const newTotal = state.total_amount_minor + item.totalAmountMinor;
      return {
        ...state,
        items: newItems,
        total_amount_minor: newTotal,
        updated_at: event.recorded_at,
      };
    }

    case 'OrderConfirmed': {
      if (!state) throw new InvariantViolationError('Cannot apply OrderConfirmed to null state');
      return {
        ...state,
        status: 'CONFIRMED',
        updated_at: event.recorded_at,
      };
    }

    case 'OrderPaid': {
      if (!state) throw new InvariantViolationError('Cannot apply OrderPaid to null state');
      return {
        ...state,
        status: 'PAID',
        updated_at: event.recorded_at,
      };
    }

    case 'OrderAllocated': {
      if (!state) throw new InvariantViolationError('Cannot apply OrderAllocated to null state');
      return {
        ...state,
        status: 'ALLOCATED',
        updated_at: event.recorded_at,
      };
    }

    case 'OrderShipped': {
      if (!state) throw new InvariantViolationError('Cannot apply OrderShipped to null state');
      return {
        ...state,
        status: 'SHIPPED',
        updated_at: event.recorded_at,
      };
    }

    case 'OrderCancelled': {
      if (!state) throw new InvariantViolationError('Cannot apply OrderCancelled to null state');
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
        `Unhandled order event type: ${(exhaustiveCheck as OrderEvent).event_type}`,
      );
    }
  }
}

// --- Decision logic (Decide phase: Command + Current State -> Events) ---

export function decideCreateOrder(
  command: CreateOrderCommand,
  currentState: OrderState | null,
  nowIso = new Date().toISOString(),
): OrderCreatedEvent {
  if (currentState !== null) {
    throw new PreconditionFailedError(`Order '${command.aggregate_id}' already exists.`);
  }

  const { customer_id, currency } = command.payload;
  if (!customer_id || customer_id.trim() === '') {
    throw new ValidationError('Customer ID cannot be empty');
  }
  const normCurrency = currency.toUpperCase().trim();
  if (!normCurrency || normCurrency.length !== 3) {
    throw new ValidationError(`Invalid currency '${currency}'. Must be 3-letter ISO code.`);
  }

  const payload = { customer_id: customer_id.trim(), currency: normCurrency };
  return {
    event_id: crypto.randomUUID(),
    timeline_id: command.timeline_id,
    aggregate_id: command.aggregate_id,
    aggregate_type: ORDER_AGGREGATE_TYPE,
    aggregate_sequence: command.expected_sequence + 1,
    event_type: 'OrderCreated',
    schema_version: 1,
    payload,
    event_hash: computeEventHash(payload),
    causation_id: command.causation_id,
    correlation_id: command.correlation_id,
    recorded_at: nowIso,
  };
}

export function decideAddOrderItem(
  command: AddOrderItemCommand,
  currentState: OrderState | null,
  nowIso = new Date().toISOString(),
): OrderItemAddedEvent {
  if (!currentState) {
    throw new PreconditionFailedError(`Order '${command.aggregate_id}' does not exist.`);
  }
  if (currentState.status !== 'CREATED') {
    throw new PreconditionFailedError(
      `Cannot add items to order in status '${currentState.status}'. Must be 'CREATED'.`,
    );
  }

  const { item } = command.payload;
  if (!item.sku || item.sku.trim() === '') {
    throw new ValidationError('SKU cannot be empty');
  }
  if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
    throw new ValidationError(`Item quantity must be a positive integer, got ${item.quantity}`);
  }
  if (item.unitAmountMinor < 0n) {
    throw new ValidationError('Unit amount cannot be negative');
  }
  const expectedTotal = BigInt(item.quantity) * item.unitAmountMinor;
  if (item.totalAmountMinor !== expectedTotal) {
    throw new ValidationError(
      `Total amount minor mismatch: expected ${expectedTotal.toString()}, got ${item.totalAmountMinor.toString()}`,
    );
  }

  const payload = { item };
  return {
    event_id: crypto.randomUUID(),
    timeline_id: command.timeline_id,
    aggregate_id: command.aggregate_id,
    aggregate_type: ORDER_AGGREGATE_TYPE,
    aggregate_sequence: command.expected_sequence + 1,
    event_type: 'OrderItemAdded',
    schema_version: 1,
    payload,
    event_hash: computeEventHash(payload),
    causation_id: command.causation_id,
    correlation_id: command.correlation_id,
    recorded_at: nowIso,
  };
}

export function decideConfirmOrder(
  command: ConfirmOrderCommand,
  currentState: OrderState | null,
  nowIso = new Date().toISOString(),
): OrderConfirmedEvent {
  if (!currentState) {
    throw new PreconditionFailedError(`Order '${command.aggregate_id}' does not exist.`);
  }
  if (currentState.status !== 'CREATED') {
    throw new PreconditionFailedError(
      `Cannot confirm order in status '${currentState.status}'. Must be 'CREATED'.`,
    );
  }
  if (currentState.items.length === 0) {
    throw new InvariantViolationError('Cannot confirm order with no items');
  }
  if (command.payload.minimum_items && currentState.items.length < command.payload.minimum_items) {
    throw new InvariantViolationError(
      `Order has ${currentState.items.length} items, requires at least ${command.payload.minimum_items}`,
    );
  }
  if (currentState.total_amount_minor <= 0n) {
    throw new InvariantViolationError('Cannot confirm order with zero or negative total amount');
  }

  const payload = {
    total_amount_minor: currentState.total_amount_minor,
    currency: currentState.currency,
    item_count: currentState.items.length,
  };

  return {
    event_id: crypto.randomUUID(),
    timeline_id: command.timeline_id,
    aggregate_id: command.aggregate_id,
    aggregate_type: ORDER_AGGREGATE_TYPE,
    aggregate_sequence: command.expected_sequence + 1,
    event_type: 'OrderConfirmed',
    schema_version: 1,
    payload,
    event_hash: computeEventHash(payload),
    causation_id: command.causation_id,
    correlation_id: command.correlation_id,
    recorded_at: nowIso,
  };
}

export function decideMarkOrderPaid(
  command: MarkOrderPaidCommand,
  currentState: OrderState | null,
  nowIso = new Date().toISOString(),
): OrderPaidEvent {
  if (!currentState) {
    throw new PreconditionFailedError(`Order '${command.aggregate_id}' does not exist.`);
  }
  if (currentState.status !== 'CONFIRMED') {
    throw new PreconditionFailedError(
      `Cannot mark order as paid in status '${currentState.status}'. Must be 'CONFIRMED'.`,
    );
  }
  if (command.payload.currency !== currentState.currency) {
    throw new ValidationError(
      `Currency mismatch: order is in '${currentState.currency}', payment in '${command.payload.currency}'`,
    );
  }
  if (command.payload.amount_minor !== currentState.total_amount_minor) {
    throw new ValidationError(
      `Amount mismatch: order total is ${currentState.total_amount_minor.toString()}, payment is ${command.payload.amount_minor.toString()}`,
    );
  }

  const payload = command.payload;
  return {
    event_id: crypto.randomUUID(),
    timeline_id: command.timeline_id,
    aggregate_id: command.aggregate_id,
    aggregate_type: ORDER_AGGREGATE_TYPE,
    aggregate_sequence: command.expected_sequence + 1,
    event_type: 'OrderPaid',
    schema_version: 1,
    payload,
    event_hash: computeEventHash(payload),
    causation_id: command.causation_id,
    correlation_id: command.correlation_id,
    recorded_at: nowIso,
  };
}

export function decideMarkOrderAllocated(
  command: MarkOrderAllocatedCommand,
  currentState: OrderState | null,
  nowIso = new Date().toISOString(),
): OrderAllocatedEvent {
  if (!currentState) {
    throw new PreconditionFailedError(`Order '${command.aggregate_id}' does not exist.`);
  }
  if (currentState.status !== 'PAID') {
    throw new PreconditionFailedError(
      `Cannot mark order as allocated in status '${currentState.status}'. Must be 'PAID'.`,
    );
  }

  const payload = command.payload;
  return {
    event_id: crypto.randomUUID(),
    timeline_id: command.timeline_id,
    aggregate_id: command.aggregate_id,
    aggregate_type: ORDER_AGGREGATE_TYPE,
    aggregate_sequence: command.expected_sequence + 1,
    event_type: 'OrderAllocated',
    schema_version: 1,
    payload,
    event_hash: computeEventHash(payload),
    causation_id: command.causation_id,
    correlation_id: command.correlation_id,
    recorded_at: nowIso,
  };
}

export function decideMarkOrderShipped(
  command: MarkOrderShippedCommand,
  currentState: OrderState | null,
  nowIso = new Date().toISOString(),
): OrderShippedEvent {
  if (!currentState) {
    throw new PreconditionFailedError(`Order '${command.aggregate_id}' does not exist.`);
  }
  if (currentState.status !== 'ALLOCATED') {
    throw new PreconditionFailedError(
      `Cannot mark order as shipped in status '${currentState.status}'. Must be 'ALLOCATED'.`,
    );
  }

  const payload = command.payload;
  return {
    event_id: crypto.randomUUID(),
    timeline_id: command.timeline_id,
    aggregate_id: command.aggregate_id,
    aggregate_type: ORDER_AGGREGATE_TYPE,
    aggregate_sequence: command.expected_sequence + 1,
    event_type: 'OrderShipped',
    schema_version: 1,
    payload,
    event_hash: computeEventHash(payload),
    causation_id: command.causation_id,
    correlation_id: command.correlation_id,
    recorded_at: nowIso,
  };
}

export function decideCancelOrder(
  command: CancelOrderCommand,
  currentState: OrderState | null,
  nowIso = new Date().toISOString(),
): OrderCancelledEvent {
  if (!currentState) {
    throw new PreconditionFailedError(`Order '${command.aggregate_id}' does not exist.`);
  }
  if (currentState.status === 'SHIPPED') {
    throw new PreconditionFailedError('Cannot cancel an order that has already been shipped.');
  }
  if (currentState.status === 'CANCELLED') {
    throw new PreconditionFailedError('Order is already cancelled.');
  }

  const payload = { reason: command.payload.reason || 'User cancelled' };
  return {
    event_id: crypto.randomUUID(),
    timeline_id: command.timeline_id,
    aggregate_id: command.aggregate_id,
    aggregate_type: ORDER_AGGREGATE_TYPE,
    aggregate_sequence: command.expected_sequence + 1,
    event_type: 'OrderCancelled',
    schema_version: 1,
    payload,
    event_hash: computeEventHash(payload),
    causation_id: command.causation_id,
    correlation_id: command.correlation_id,
    recorded_at: nowIso,
  };
}
