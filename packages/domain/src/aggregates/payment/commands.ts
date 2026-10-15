import type { Command } from '../../core/command.js';

export interface AuthorizePaymentPayload {
  readonly order_id: string;
  readonly currency: string;
  readonly amount_minor: bigint;
  readonly payment_method: string;
}

export interface CapturePaymentPayload {
  readonly transaction_reference: string;
}

export interface FailPaymentPayload {
  readonly reason: string;
  readonly error_code?: string;
}

export interface RefundPaymentPayload {
  readonly reason: string;
  readonly refund_reference: string;
}

export type AuthorizePaymentCommand = Command<AuthorizePaymentPayload>;
export type CapturePaymentCommand = Command<CapturePaymentPayload>;
export type FailPaymentCommand = Command<FailPaymentPayload>;
export type RefundPaymentCommand = Command<RefundPaymentPayload>;
