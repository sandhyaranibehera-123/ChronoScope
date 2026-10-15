import type { AggregateRepository } from './repository.js';
import type { PaymentEvent, PaymentState } from '../aggregates/payment/index.js';

export type PaymentRepository = AggregateRepository<PaymentState, PaymentEvent>;
