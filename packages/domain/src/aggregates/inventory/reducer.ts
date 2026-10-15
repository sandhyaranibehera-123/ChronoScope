import { computeEventHash } from '../../core/hash.js';
import {
  InvariantViolationError,
  PreconditionFailedError,
  ValidationError,
} from '../../core/errors.js';
import type { InventoryState } from './state.js';
import {
  INVENTORY_AGGREGATE_TYPE,
  type InventoryDeductedEvent,
  type InventoryEvent,
  type InventoryInitializedEvent,
  type InventoryReleasedEvent,
  type InventoryReservedEvent,
} from './events.js';
import type {
  DeductInventoryCommand,
  InitializeInventoryCommand,
  ReleaseInventoryCommand,
  ReserveInventoryCommand,
} from './commands.js';

export function inventoryReducer(
  state: InventoryState | null,
  event: InventoryEvent,
): InventoryState {
  switch (event.event_type) {
    case 'InventoryInitialized': {
      const initialQty = event.payload.initial_quantity;
      return {
        timeline_id: event.timeline_id,
        aggregate_id: event.aggregate_id,
        sku: event.payload.sku,
        total_quantity: initialQty,
        reserved_quantity: 0,
        available_quantity: initialQty,
        created_at: event.recorded_at,
        updated_at: event.recorded_at,
      };
    }

    case 'InventoryReserved': {
      if (!state) throw new InvariantViolationError('Cannot apply InventoryReserved to null state');
      const qty = event.payload.quantity;
      const newReserved = state.reserved_quantity + qty;
      const newAvailable = state.total_quantity - newReserved;
      return {
        ...state,
        reserved_quantity: newReserved,
        available_quantity: newAvailable,
        updated_at: event.recorded_at,
      };
    }

    case 'InventoryReleased': {
      if (!state) throw new InvariantViolationError('Cannot apply InventoryReleased to null state');
      const qty = event.payload.quantity;
      const newReserved = state.reserved_quantity - qty;
      const newAvailable = state.total_quantity - newReserved;
      return {
        ...state,
        reserved_quantity: newReserved,
        available_quantity: newAvailable,
        updated_at: event.recorded_at,
      };
    }

    case 'InventoryDeducted': {
      if (!state) throw new InvariantViolationError('Cannot apply InventoryDeducted to null state');
      const qty = event.payload.quantity;
      const newTotal = state.total_quantity - qty;
      const newReserved = state.reserved_quantity - qty;
      return {
        ...state,
        total_quantity: newTotal,
        reserved_quantity: newReserved,
        available_quantity: newTotal - newReserved,
        updated_at: event.recorded_at,
      };
    }

    default: {
      const exhaustiveCheck: never = event;
      throw new InvariantViolationError(
        `Unhandled inventory event type: ${(exhaustiveCheck as InventoryEvent).event_type}`,
      );
    }
  }
}

// --- Decision Logic ---

export function decideInitializeInventory(
  command: InitializeInventoryCommand,
  currentState: InventoryState | null,
  nowIso = new Date().toISOString(),
): InventoryInitializedEvent {
  if (currentState !== null) {
    throw new PreconditionFailedError(
      `Inventory for '${command.aggregate_id}' already initialized.`,
    );
  }

  const { sku, initial_quantity } = command.payload;
  if (!sku || sku.trim() === '') {
    throw new ValidationError('SKU cannot be empty');
  }
  if (!Number.isInteger(initial_quantity) || initial_quantity < 0) {
    throw new ValidationError(
      `Initial quantity must be a non-negative integer, got ${initial_quantity}`,
    );
  }

  const payload = { sku: sku.trim(), initial_quantity };
  return {
    event_id: crypto.randomUUID(),
    timeline_id: command.timeline_id,
    aggregate_id: command.aggregate_id,
    aggregate_type: INVENTORY_AGGREGATE_TYPE,
    aggregate_sequence: command.expected_sequence + 1,
    event_type: 'InventoryInitialized',
    schema_version: 1,
    payload,
    event_hash: computeEventHash(payload),
    causation_id: command.causation_id,
    correlation_id: command.correlation_id,
    recorded_at: nowIso,
  };
}

export function decideReserveInventory(
  command: ReserveInventoryCommand,
  currentState: InventoryState | null,
  nowIso = new Date().toISOString(),
): InventoryReservedEvent {
  if (!currentState) {
    throw new PreconditionFailedError(`Inventory '${command.aggregate_id}' does not exist.`);
  }

  const { order_id, quantity } = command.payload;
  if (!order_id || order_id.trim() === '') {
    throw new ValidationError('Order ID cannot be empty');
  }
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new ValidationError(`Reservation quantity must be a positive integer, got ${quantity}`);
  }
  if (quantity > currentState.available_quantity) {
    throw new InvariantViolationError(
      `Insufficient inventory for SKU '${currentState.sku}': requested ${quantity}, available ${currentState.available_quantity}`,
    );
  }

  const payload = { order_id: order_id.trim(), quantity };
  return {
    event_id: crypto.randomUUID(),
    timeline_id: command.timeline_id,
    aggregate_id: command.aggregate_id,
    aggregate_type: INVENTORY_AGGREGATE_TYPE,
    aggregate_sequence: command.expected_sequence + 1,
    event_type: 'InventoryReserved',
    schema_version: 1,
    payload,
    event_hash: computeEventHash(payload),
    causation_id: command.causation_id,
    correlation_id: command.correlation_id,
    recorded_at: nowIso,
  };
}

/**
 * Compensation action: Release Inventory.
 */
export function decideReleaseInventory(
  command: ReleaseInventoryCommand,
  currentState: InventoryState | null,
  nowIso = new Date().toISOString(),
): InventoryReleasedEvent {
  if (!currentState) {
    throw new PreconditionFailedError(`Inventory '${command.aggregate_id}' does not exist.`);
  }

  const { order_id, quantity, reason } = command.payload;
  if (!order_id || order_id.trim() === '') {
    throw new ValidationError('Order ID cannot be empty');
  }
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new ValidationError(`Release quantity must be a positive integer, got ${quantity}`);
  }
  if (quantity > currentState.reserved_quantity) {
    throw new InvariantViolationError(
      `Cannot release ${quantity} units: only ${currentState.reserved_quantity} units reserved for SKU '${currentState.sku}'`,
    );
  }

  const payload = {
    order_id: order_id.trim(),
    quantity,
    reason: reason || 'Compensation release',
  };

  return {
    event_id: crypto.randomUUID(),
    timeline_id: command.timeline_id,
    aggregate_id: command.aggregate_id,
    aggregate_type: INVENTORY_AGGREGATE_TYPE,
    aggregate_sequence: command.expected_sequence + 1,
    event_type: 'InventoryReleased',
    schema_version: 1,
    payload,
    event_hash: computeEventHash(payload),
    causation_id: command.causation_id,
    correlation_id: command.correlation_id,
    recorded_at: nowIso,
  };
}

export function decideDeductInventory(
  command: DeductInventoryCommand,
  currentState: InventoryState | null,
  nowIso = new Date().toISOString(),
): InventoryDeductedEvent {
  if (!currentState) {
    throw new PreconditionFailedError(`Inventory '${command.aggregate_id}' does not exist.`);
  }

  const { order_id, quantity } = command.payload;
  if (!order_id || order_id.trim() === '') {
    throw new ValidationError('Order ID cannot be empty');
  }
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new ValidationError(`Deduct quantity must be a positive integer, got ${quantity}`);
  }
  if (quantity > currentState.reserved_quantity) {
    throw new InvariantViolationError(
      `Cannot deduct ${quantity} units: only ${currentState.reserved_quantity} units reserved for SKU '${currentState.sku}'`,
    );
  }

  const payload = { order_id: order_id.trim(), quantity };
  return {
    event_id: crypto.randomUUID(),
    timeline_id: command.timeline_id,
    aggregate_id: command.aggregate_id,
    aggregate_type: INVENTORY_AGGREGATE_TYPE,
    aggregate_sequence: command.expected_sequence + 1,
    event_type: 'InventoryDeducted',
    schema_version: 1,
    payload,
    event_hash: computeEventHash(payload),
    causation_id: command.causation_id,
    correlation_id: command.correlation_id,
    recorded_at: nowIso,
  };
}
