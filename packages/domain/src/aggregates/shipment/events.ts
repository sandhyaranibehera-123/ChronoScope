import type { DomainEvent } from '../../core/event.js';
import type { ShipmentItem, ShippingDestination } from './state.js';

export const SHIPMENT_AGGREGATE_TYPE = 'SHIPMENT';

export interface ShipmentCreatedPayload {
  readonly order_id: string;
  readonly items: readonly ShipmentItem[];
  readonly destination: ShippingDestination;
}

export interface ShipmentDispatchedPayload {
  readonly tracking_number: string;
  readonly carrier: string;
}

export interface ShipmentDeliveredPayload {
  readonly delivered_at: string;
}

export interface ShipmentCancelledPayload {
  readonly reason: string;
}

export type ShipmentCreatedEvent = DomainEvent<ShipmentCreatedPayload> & {
  readonly event_type: 'ShipmentCreated';
};

export type ShipmentDispatchedEvent = DomainEvent<ShipmentDispatchedPayload> & {
  readonly event_type: 'ShipmentDispatched';
};

export type ShipmentDeliveredEvent = DomainEvent<ShipmentDeliveredPayload> & {
  readonly event_type: 'ShipmentDelivered';
};

export type ShipmentCancelledEvent = DomainEvent<ShipmentCancelledPayload> & {
  readonly event_type: 'ShipmentCancelled';
};

export type ShipmentEvent =
  ShipmentCreatedEvent | ShipmentDispatchedEvent | ShipmentDeliveredEvent | ShipmentCancelledEvent;
