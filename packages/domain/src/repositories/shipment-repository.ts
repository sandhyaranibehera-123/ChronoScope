import type { AggregateRepository } from './repository.js';
import type { ShipmentEvent, ShipmentState } from '../aggregates/shipment/index.js';

export type ShipmentRepository = AggregateRepository<ShipmentState, ShipmentEvent>;
