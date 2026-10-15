export type PaymentStatus = 'PENDING' | 'AUTHORIZED' | 'CAPTURED' | 'FAILED' | 'REFUNDED';

export interface PaymentState {
  readonly timeline_id: string;
  readonly aggregate_id: string;
  readonly order_id: string;
  readonly currency: string;
  readonly amount_minor: bigint;
  readonly status: PaymentStatus;
  readonly failure_reason?: string | undefined;
  readonly refund_reason?: string | undefined;
  readonly created_at: string;
  readonly updated_at: string;
}
