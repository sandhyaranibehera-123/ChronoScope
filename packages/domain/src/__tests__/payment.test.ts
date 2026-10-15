import { describe, expect, it } from 'vitest';
import {
  decideAuthorizePayment,
  decideCapturePayment,
  decideFailPayment,
  decideRefundPayment,
  paymentReducer,
  type AuthorizePaymentCommand,
  type CapturePaymentCommand,
  type FailPaymentCommand,
  type RefundPaymentCommand,
} from '../aggregates/payment/index.js';
import { foldEvents } from '../core/aggregate.js';
import { PreconditionFailedError } from '../core/errors.js';

describe('Payment Aggregate', () => {
  const timelineId = 'timeline-main';
  const paymentId = 'pay-900';
  const orderId = 'order-101';
  const currency = 'USD';
  const amountMinor = 50000n; // $500.00

  it('authorizes, captures, and refunds payment (compensation)', () => {
    const events = [];

    // 1. Authorize
    const authCmd: AuthorizePaymentCommand = {
      command_id: 'cmd-auth',
      request_id: 'req-auth',
      correlation_id: 'corr-1',
      causation_id: null,
      actor_id: 'actor-1',
      timeline_id: timelineId,
      aggregate_id: paymentId,
      aggregate_type: 'PAYMENT',
      expected_sequence: 0,
      payload: {
        order_id: orderId,
        currency,
        amount_minor: amountMinor,
        payment_method: 'CREDIT_CARD',
      },
    };
    const authEvent = decideAuthorizePayment(authCmd, null);
    events.push(authEvent);
    let state = paymentReducer(null, authEvent);
    expect(state.status).toBe('AUTHORIZED');
    expect(state.amount_minor).toBe(50000n);

    // 2. Capture
    const capCmd: CapturePaymentCommand = {
      command_id: 'cmd-cap',
      request_id: 'req-cap',
      correlation_id: 'corr-1',
      causation_id: authEvent.event_id,
      actor_id: 'actor-1',
      timeline_id: timelineId,
      aggregate_id: paymentId,
      aggregate_type: 'PAYMENT',
      expected_sequence: 1,
      payload: { transaction_reference: 'tx-stripe-123' },
    };
    const capEvent = decideCapturePayment(capCmd, state);
    events.push(capEvent);
    state = paymentReducer(state, capEvent);
    expect(state.status).toBe('CAPTURED');

    // 3. Refund (compensation action)
    const refundCmd: RefundPaymentCommand = {
      command_id: 'cmd-ref',
      request_id: 'req-ref',
      correlation_id: 'corr-1',
      causation_id: capEvent.event_id,
      actor_id: 'actor-1',
      timeline_id: timelineId,
      aggregate_id: paymentId,
      aggregate_type: 'PAYMENT',
      expected_sequence: 2,
      payload: {
        reason: 'Order cancelled by user',
        refund_reference: 'ref-stripe-456',
      },
    };
    const refundEvent = decideRefundPayment(refundCmd, state);
    events.push(refundEvent);
    state = paymentReducer(state, refundEvent);
    expect(state.status).toBe('REFUNDED');
    expect(state.refund_reason).toBe('Order cancelled by user');

    const folded = foldEvents(events, paymentReducer);
    expect(folded.aggregate_sequence).toBe(3);
    expect(folded.state).toEqual(state);
  });

  it('handles payment failure and blocks capturing failed payment', () => {
    const failCmd: FailPaymentCommand = {
      command_id: 'cmd-fail',
      request_id: 'req-fail',
      correlation_id: 'corr-1',
      causation_id: null,
      actor_id: 'actor-1',
      timeline_id: timelineId,
      aggregate_id: paymentId,
      aggregate_type: 'PAYMENT',
      expected_sequence: 0,
      payload: { reason: 'Insufficient funds on credit card' },
    };
    const failEvent = decideFailPayment(failCmd, null);
    const state = paymentReducer(null, failEvent);
    expect(state.status).toBe('FAILED');
    expect(state.failure_reason).toBe('Insufficient funds on credit card');

    const capCmd: CapturePaymentCommand = {
      command_id: 'cmd-cap',
      request_id: 'req-cap',
      correlation_id: 'corr-1',
      causation_id: failEvent.event_id,
      actor_id: 'actor-1',
      timeline_id: timelineId,
      aggregate_id: paymentId,
      aggregate_type: 'PAYMENT',
      expected_sequence: 1,
      payload: { transaction_reference: 'tx-1' },
    };
    expect(() => decideCapturePayment(capCmd, state)).toThrow(PreconditionFailedError);
  });

  it('rejects refund when payment is not captured', () => {
    const refundCmd: RefundPaymentCommand = {
      command_id: 'cmd-ref',
      request_id: 'req-ref',
      correlation_id: 'corr-1',
      causation_id: null,
      actor_id: 'actor-1',
      timeline_id: timelineId,
      aggregate_id: paymentId,
      aggregate_type: 'PAYMENT',
      expected_sequence: 1,
      payload: { reason: 'test', refund_reference: 'ref-1' },
    };
    expect(() => decideRefundPayment(refundCmd, null)).toThrow(PreconditionFailedError);
  });
});
