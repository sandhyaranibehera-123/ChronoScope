export type OrderStatus = 'CREATED' | 'CONFIRMED' | 'PAID' | 'ALLOCATED' | 'SHIPPED' | 'CANCELLED';

export interface OrderItem {
  readonly sku: string;
  readonly quantity: number;
  readonly unitAmountMinor: bigint;
  readonly totalAmountMinor: bigint;
}

export interface OrderState {
  readonly timeline_id: string;
  readonly aggregate_id: string;
  readonly customer_id: string;
  readonly currency: string;
  readonly status: OrderStatus;
  readonly items: readonly OrderItem[];
  readonly total_amount_minor: bigint;
  readonly cancellation_reason?: string | undefined;
  readonly created_at: string;
  readonly updated_at: string;
}
