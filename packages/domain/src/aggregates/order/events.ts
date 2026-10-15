import type { DomainEvent } from '../../core/event.js';
import type { OrderItem } from './state.js';

export const ORDER_AGGREGATE_TYPE = 'ORDER';

export interface OrderCreatedPayload {
  readonly customer_id: string;
  readonly currency: string;
}

export interface OrderItemAddedPayload {
  readonly item: OrderItem;
}

export interface OrderConfirmedPayload {
  readonly total_amount_minor: bigint;
  readonly currency: string;
  readonly item_count: number;
}

export interface OrderPaidPayload {
  readonly payment_id: string;
  readonly amount_minor: bigint;
  readonly currency: string;
}

export interface OrderAllocatedPayload {
  readonly allocation_id: string;
}

export interface OrderShippedPayload {
  readonly shipment_id: string;
}

export interface OrderCancelledPayload {
  readonly reason: string;
}

export type OrderCreatedEvent = DomainEvent<OrderCreatedPayload> & {
  readonly event_type: 'OrderCreated';
};

export type OrderItemAddedEvent = DomainEvent<OrderItemAddedPayload> & {
  readonly event_type: 'OrderItemAdded';
};

export type OrderConfirmedEvent = DomainEvent<OrderConfirmedPayload> & {
  readonly event_type: 'OrderConfirmed';
};

export type OrderPaidEvent = DomainEvent<OrderPaidPayload> & {
  readonly event_type: 'OrderPaid';
};

export type OrderAllocatedEvent = DomainEvent<OrderAllocatedPayload> & {
  readonly event_type: 'OrderAllocated';
};

export type OrderShippedEvent = DomainEvent<OrderShippedPayload> & {
  readonly event_type: 'OrderShipped';
};

export type OrderCancelledEvent = DomainEvent<OrderCancelledPayload> & {
  readonly event_type: 'OrderCancelled';
};

export type OrderEvent =
  | OrderCreatedEvent
  | OrderItemAddedEvent
  | OrderConfirmedEvent
  | OrderPaidEvent
  | OrderAllocatedEvent
  | OrderShippedEvent
  | OrderCancelledEvent;
