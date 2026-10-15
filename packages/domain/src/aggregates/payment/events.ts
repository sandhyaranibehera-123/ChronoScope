import type { DomainEvent } from '../../core/event.js';

export const PAYMENT_AGGREGATE_TYPE = 'PAYMENT';

export interface PaymentAuthorizedPayload {
  readonly order_id: string;
  readonly currency: string;
  readonly amount_minor: bigint;
  readonly payment_method: string;
}

export interface PaymentCapturedPayload {
  readonly transaction_reference: string;
}

export interface PaymentFailedPayload {
  readonly reason: string;
  readonly error_code?: string;
}

export interface PaymentRefundedPayload {
  readonly reason: string;
  readonly refund_reference: string;
}

export type PaymentAuthorizedEvent = DomainEvent<PaymentAuthorizedPayload> & {
  readonly event_type: 'PaymentAuthorized';
};

export type PaymentCapturedEvent = DomainEvent<PaymentCapturedPayload> & {
  readonly event_type: 'PaymentCaptured';
};

export type PaymentFailedEvent = DomainEvent<PaymentFailedPayload> & {
  readonly event_type: 'PaymentFailed';
};

export type PaymentRefundedEvent = DomainEvent<PaymentRefundedPayload> & {
  readonly event_type: 'PaymentRefunded';
};

export type PaymentEvent =
  PaymentAuthorizedEvent | PaymentCapturedEvent | PaymentFailedEvent | PaymentRefundedEvent;
