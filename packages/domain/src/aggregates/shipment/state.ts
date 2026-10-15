export type ShipmentStatus = 'PENDING' | 'DISPATCHED' | 'DELIVERED' | 'CANCELLED';

export interface ShipmentItem {
  readonly sku: string;
  readonly quantity: number;
}

export interface ShippingDestination {
  readonly address: string;
  readonly city: string;
  readonly postal_code: string;
  readonly country: string;
}

export interface ShipmentState {
  readonly timeline_id: string;
  readonly aggregate_id: string;
  readonly order_id: string;
  readonly status: ShipmentStatus;
  readonly items: readonly ShipmentItem[];
  readonly destination: ShippingDestination;
  readonly tracking_number?: string | undefined;
  readonly carrier?: string | undefined;
  readonly cancellation_reason?: string | undefined;
  readonly created_at: string;
  readonly updated_at: string;
}
