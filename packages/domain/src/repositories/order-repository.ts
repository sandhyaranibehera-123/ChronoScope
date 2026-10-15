import type { AggregateRepository } from './repository.js';
import type { OrderEvent, OrderState } from '../aggregates/order/index.js';

export type OrderRepository = AggregateRepository<OrderState, OrderEvent>;
