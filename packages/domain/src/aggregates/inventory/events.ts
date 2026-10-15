import type { DomainEvent } from '../../core/event.js';

export const INVENTORY_AGGREGATE_TYPE = 'INVENTORY';

export interface InventoryInitializedPayload {
  readonly sku: string;
  readonly initial_quantity: number;
}

export interface InventoryReservedPayload {
  readonly order_id: string;
  readonly quantity: number;
}

export interface InventoryReleasedPayload {
  readonly order_id: string;
  readonly quantity: number;
  readonly reason: string;
}

export interface InventoryDeductedPayload {
  readonly order_id: string;
  readonly quantity: number;
}

export type InventoryInitializedEvent = DomainEvent<InventoryInitializedPayload> & {
  readonly event_type: 'InventoryInitialized';
};

export type InventoryReservedEvent = DomainEvent<InventoryReservedPayload> & {
  readonly event_type: 'InventoryReserved';
};

export type InventoryReleasedEvent = DomainEvent<InventoryReleasedPayload> & {
  readonly event_type: 'InventoryReleased';
};

export type InventoryDeductedEvent = DomainEvent<InventoryDeductedPayload> & {
  readonly event_type: 'InventoryDeducted';
};

export type InventoryEvent =
  | InventoryInitializedEvent
  | InventoryReservedEvent
  | InventoryReleasedEvent
  | InventoryDeductedEvent;
