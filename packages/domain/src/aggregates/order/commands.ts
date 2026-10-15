import type { Command } from '../../core/command.js';
import type { OrderItem } from './state.js';

export interface CreateOrderPayload {
  readonly customer_id: string;
  readonly currency: string;
}

export interface AddOrderItemPayload {
  readonly item: OrderItem;
}

export interface ConfirmOrderPayload {
  readonly minimum_items?: number;
}

export interface MarkOrderPaidPayload {
  readonly payment_id: string;
  readonly amount_minor: bigint;
  readonly currency: string;
}

export interface MarkOrderAllocatedPayload {
  readonly allocation_id: string;
}

export interface MarkOrderShippedPayload {
  readonly shipment_id: string;
}

export interface CancelOrderPayload {
  readonly reason: string;
}

export type CreateOrderCommand = Command<CreateOrderPayload>;
export type AddOrderItemCommand = Command<AddOrderItemPayload>;
export type ConfirmOrderCommand = Command<ConfirmOrderPayload>;
export type MarkOrderPaidCommand = Command<MarkOrderPaidPayload>;
export type MarkOrderAllocatedCommand = Command<MarkOrderAllocatedPayload>;
export type MarkOrderShippedCommand = Command<MarkOrderShippedPayload>;
export type CancelOrderCommand = Command<CancelOrderPayload>;
