import type { AggregateRepository } from './repository.js';
import type { InventoryEvent, InventoryState } from '../aggregates/inventory/index.js';

export type InventoryRepository = AggregateRepository<InventoryState, InventoryEvent>;
