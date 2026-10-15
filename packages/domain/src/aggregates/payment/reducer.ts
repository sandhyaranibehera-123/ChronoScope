import { computeEventHash } from '../../core/hash.js';
import {
  InvariantViolationError,
  PreconditionFailedError,
  ValidationError,
} from '../../core/errors.js';
import type { PaymentState } from './state.js';
import {
  PAYMENT_AGGREGATE_TYPE,
  type PaymentAuthorizedEvent,
  type PaymentCapturedEvent,
  type PaymentEvent,
  type PaymentFailedEvent,
  type PaymentRefundedEvent,
} from './events.js';
import type {
  AuthorizePaymentCommand,
  CapturePaymentCommand,
  FailPaymentCommand,
  RefundPaymentCommand,
} from './commands.js';

export function paymentReducer(state: PaymentState | null, event: PaymentEvent): PaymentState {
  switch (event.event_type) {
    case 'PaymentAuthorized': {
      return {
        timeline_id: event.timeline_id,
        aggregate_id: event.aggregate_id,
        order_id: event.payload.order_id,
        currency: event.payload.currency,
        amount_minor: event.payload.amount_minor,
        status: 'AUTHORIZED',
        created_at: event.recorded_at,
        updated_at: event.recorded_at,
      };
    }

    case 'PaymentCaptured': {
      if (!state) throw new InvariantViolationError('Cannot apply PaymentCaptured to null state');
      return {
        ...state,
        status: 'CAPTURED',
        updated_at: event.recorded_at,
      };
    }

    case 'PaymentFailed': {
      if (!state) {
        return {
          timeline_id: event.timeline_id,
          aggregate_id: event.aggregate_id,
          order_id: '',
          currency: '',
          amount_minor: 0n,
          status: 'FAILED',
          failure_reason: event.payload.reason,
          created_at: event.recorded_at,
          updated_at: event.recorded_at,
        };
      }
      return {
        ...state,
        status: 'FAILED',
        failure_reason: event.payload.reason,
        updated_at: event.recorded_at,
      };
    }

    case 'PaymentRefunded': {
      if (!state) throw new InvariantViolationError('Cannot apply PaymentRefunded to null state');
      return {
        ...state,
        status: 'REFUNDED',
        refund_reason: event.payload.reason,
        updated_at: event.recorded_at,
      };
    }

    default: {
      const exhaustiveCheck: never = event;
      throw new InvariantViolationError(
        `Unhandled payment event type: ${(exhaustiveCheck as PaymentEvent).event_type}`,
      );
    }
  }
}

// --- Decision Logic ---

export function decideAuthorizePayment(
  command: AuthorizePaymentCommand,
  currentState: PaymentState | null,
  nowIso = new Date().toISOString(),
): PaymentAuthorizedEvent {
  if (currentState !== null) {
    throw new PreconditionFailedError(`Payment '${command.aggregate_id}' already exists.`);
  }

  const { order_id, currency, amount_minor, payment_method } = command.payload;
  if (!order_id || order_id.trim() === '') {
    throw new ValidationError('Order ID cannot be empty');
  }
  const normCurrency = currency.toUpperCase().trim();
  if (!normCurrency || normCurrency.length !== 3) {
    throw new ValidationError(`Invalid currency '${currency}'. Must be 3-letter ISO code.`);
  }
  if (amount_minor <= 0n) {
    throw new ValidationError(`Payment amount must be positive, got ${amount_minor.toString()}`);
  }
  if (!payment_method || payment_method.trim() === '') {
    throw new ValidationError('Payment method cannot be empty');
  }

  const payload = {
    order_id: order_id.trim(),
    currency: normCurrency,
    amount_minor,
    payment_method: payment_method.trim(),
  };

  return {
    event_id: crypto.randomUUID(),
    timeline_id: command.timeline_id,
    aggregate_id: command.aggregate_id,
    aggregate_type: PAYMENT_AGGREGATE_TYPE,
    aggregate_sequence: command.expected_sequence + 1,
    event_type: 'PaymentAuthorized',
    schema_version: 1,
    payload,
    event_hash: computeEventHash(payload),
    causation_id: command.causation_id,
    correlation_id: command.correlation_id,
    recorded_at: nowIso,
  };
}

export function decideCapturePayment(
  command: CapturePaymentCommand,
  currentState: PaymentState | null,
  nowIso = new Date().toISOString(),
): PaymentCapturedEvent {
  if (!currentState) {
    throw new PreconditionFailedError(`Payment '${command.aggregate_id}' does not exist.`);
  }
  if (currentState.status !== 'AUTHORIZED') {
    throw new PreconditionFailedError(
      `Cannot capture payment in status '${currentState.status}'. Must be 'AUTHORIZED'.`,
    );
  }

  const { transaction_reference } = command.payload;
  if (!transaction_reference || transaction_reference.trim() === '') {
    throw new ValidationError('Transaction reference cannot be empty');
  }

  const payload = { transaction_reference: transaction_reference.trim() };
  return {
    event_id: crypto.randomUUID(),
    timeline_id: command.timeline_id,
    aggregate_id: command.aggregate_id,
    aggregate_type: PAYMENT_AGGREGATE_TYPE,
    aggregate_sequence: command.expected_sequence + 1,
    event_type: 'PaymentCaptured',
    schema_version: 1,
    payload,
    event_hash: computeEventHash(payload),
    causation_id: command.causation_id,
    correlation_id: command.correlation_id,
    recorded_at: nowIso,
  };
}

export function decideFailPayment(
  command: FailPaymentCommand,
  currentState: PaymentState | null,
  nowIso = new Date().toISOString(),
): PaymentFailedEvent {
  if (currentState && (currentState.status === 'CAPTURED' || currentState.status === 'REFUNDED')) {
    throw new PreconditionFailedError(`Cannot fail payment in status '${currentState.status}'.`);
  }

  const { reason, error_code } = command.payload;
  const payload = {
    reason: reason || 'Payment processor failed',
    ...(error_code ? { error_code } : {}),
  };

  return {
    event_id: crypto.randomUUID(),
    timeline_id: command.timeline_id,
    aggregate_id: command.aggregate_id,
    aggregate_type: PAYMENT_AGGREGATE_TYPE,
    aggregate_sequence: command.expected_sequence + 1,
    event_type: 'PaymentFailed',
    schema_version: 1,
    payload,
    event_hash: computeEventHash(payload),
    causation_id: command.causation_id,
    correlation_id: command.correlation_id,
    recorded_at: nowIso,
  };
}

/**
 * Compensation action: Refund Payment.
 * Rule 15: PaymentRefunded built only when needed.
 */
export function decideRefundPayment(
  command: RefundPaymentCommand,
  currentState: PaymentState | null,
  nowIso = new Date().toISOString(),
): PaymentRefundedEvent {
  if (!currentState) {
    throw new PreconditionFailedError(`Payment '${command.aggregate_id}' does not exist.`);
  }
  if (currentState.status !== 'CAPTURED') {
    throw new PreconditionFailedError(
      `Cannot refund payment in status '${currentState.status}'. Must be 'CAPTURED'.`,
    );
  }

  const { reason, refund_reference } = command.payload;
  if (!refund_reference || refund_reference.trim() === '') {
    throw new ValidationError('Refund reference cannot be empty');
  }

  const payload = {
    reason: reason || 'Order cancelled compensation',
    refund_reference: refund_reference.trim(),
  };

  return {
    event_id: crypto.randomUUID(),
    timeline_id: command.timeline_id,
    aggregate_id: command.aggregate_id,
    aggregate_type: PAYMENT_AGGREGATE_TYPE,
    aggregate_sequence: command.expected_sequence + 1,
    event_type: 'PaymentRefunded',
    schema_version: 1,
    payload,
    event_hash: computeEventHash(payload),
    causation_id: command.causation_id,
    correlation_id: command.correlation_id,
    recorded_at: nowIso,
  };
}
