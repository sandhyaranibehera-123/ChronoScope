import type { Command } from '../../core/command.js';
import type { ShipmentItem, ShippingDestination } from './state.js';

export interface CreateShipmentPayload {
  readonly order_id: string;
  readonly items: readonly ShipmentItem[];
  readonly destination: ShippingDestination;
}

export interface DispatchShipmentPayload {
  readonly tracking_number: string;
  readonly carrier: string;
}

export interface DeliverShipmentPayload {
  readonly delivered_at?: string;
}

export interface CancelShipmentPayload {
  readonly reason: string;
}

export type CreateShipmentCommand = Command<CreateShipmentPayload>;
export type DispatchShipmentCommand = Command<DispatchShipmentPayload>;
export type DeliverShipmentCommand = Command<DeliverShipmentPayload>;
export type CancelShipmentCommand = Command<CancelShipmentPayload>;
