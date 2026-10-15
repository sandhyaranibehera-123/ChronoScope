import { performance } from 'node:perf_hooks';
import {
  computeLatencyMetrics,
  type InventoryItem,
  type InventoryLabResult,
  type InventoryStrategy,
  type ReservationRequest,
  type ReservationResult,
} from './types.js';
import { InMemoryAggregateRepository } from '../repositories/in-memory-aggregate-repository.js';
import {
  decideInitializeInventory,
  decideReserveInventory,
  inventoryReducer,
  type InventoryState,
  ConcurrencyError,
} from '@chronoscope/domain';

export interface InventoryLabOptions {
  initialStock: number;
  requests: ReservationRequest[];
  strategy: InventoryStrategy;
  maxOccRetries?: number;
  initialBackoffMs?: number;
}

/**
 * Mutex for simulating pessimistic row locking (`SELECT ... FOR UPDATE`).
 */
class SkuRowLockMutex {
  private queue: Array<() => void> = [];
  private locked = false;

  async acquire(): Promise<() => void> {
    if (!this.locked) {
      this.locked = true;
      return () => this.release();
    }
    return new Promise<() => void>((resolve) => {
      this.queue.push(() => {
        this.locked = true;
        resolve(() => this.release());
      });
    });
  }

  private release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      next();
    } else {
      this.locked = false;
    }
  }
}

/**
 * Runs the inventory concurrency lab comparing the 4 SQL & Event-Sourcing concurrency strategies.
 */
export async function runInventoryConcurrencyLab(
  options: InventoryLabOptions,
): Promise<InventoryLabResult> {
  const { initialStock, requests, strategy, maxOccRetries = 15, initialBackoffMs = 2 } = options;

  let description = '';
  const item: InventoryItem = {
    sku: requests[0]?.sku ?? 'SKU-CONCURRENCY-1',
    totalQuantity: initialStock,
    availableQuantity: initialStock,
    reservedQuantity: 0,
    version: 0,
  };

  const results: ReservationResult[] = [];
  const startAll = performance.now();

  switch (strategy) {
    case 'UNCONTROLLED_READ_MODIFY_WRITE': {
      description =
        'Naive Read-Modify-Write without locking. Highly vulnerable to Lost Updates and overselling stock.';

      const tasks = requests.map(async (req) => {
        const start = performance.now();
        // 1. Read available stock into application memory
        const currentAvailable = item.availableQuantity;

        // 2. Realistic context-switch / network delay simulation
        await new Promise((r) => setTimeout(r, Math.random() * 3 + 1));

        // 3. Application check based on stale read
        if (currentAvailable >= req.quantity) {
          // 4. Stale write back overwriting concurrent updates
          item.availableQuantity = currentAvailable - req.quantity;
          item.reservedQuantity += req.quantity;
          item.version += 1;

          results.push({
            requestId: req.requestId,
            success: true,
            quantity: req.quantity,
            attempts: 1,
            latencyMs: performance.now() - start,
          });
        } else {
          results.push({
            requestId: req.requestId,
            success: false,
            quantity: req.quantity,
            error: `Stale check: insufficient stock (saw ${currentAvailable}, requested ${req.quantity})`,
            attempts: 1,
            latencyMs: performance.now() - start,
          });
        }
      });

      await Promise.all(tasks);
      break;
    }

    case 'PESSIMISTIC_ROW_LOCK': {
      description =
        'Pessimistic Row Locking via `SELECT ... FOR UPDATE`. Serializes access on SKU row; strictly prevents overselling.';
      const rowLock = new SkuRowLockMutex();

      const tasks = requests.map(async (req) => {
        const start = performance.now();
        // Acquire exclusive row lock
        const release = await rowLock.acquire();
        try {
          // Simulate query latency inside the transaction
          await new Promise((r) => setTimeout(r, 0.5 + Math.random() * 0.5));

          if (item.availableQuantity >= req.quantity) {
            item.availableQuantity -= req.quantity;
            item.reservedQuantity += req.quantity;
            item.version += 1;

            results.push({
              requestId: req.requestId,
              success: true,
              quantity: req.quantity,
              attempts: 1,
              latencyMs: performance.now() - start,
            });
          } else {
            results.push({
              requestId: req.requestId,
              success: false,
              quantity: req.quantity,
              error: `Insufficient stock (available: ${item.availableQuantity}, requested: ${req.quantity})`,
              attempts: 1,
              latencyMs: performance.now() - start,
            });
          }
        } finally {
          release();
        }
      });

      await Promise.all(tasks);
      break;
    }

    case 'ATOMIC_CONDITIONAL_UPDATE': {
      description =
        'Atomic SQL Conditional Update: `UPDATE inventory SET available = available - ? WHERE available >= ?`. Zero lock-wait overhead; guarantees non-negative stock.';

      // Atomic single-step operation simulated under V8 microtask atomicity
      const tasks = requests.map(async (req) => {
        const start = performance.now();
        // Slight network jitter before reaching DB
        await new Promise((r) => setTimeout(r, Math.random() * 2));

        // Atomic check-and-decrement
        let succeeded = false;
        if (item.availableQuantity >= req.quantity) {
          item.availableQuantity -= req.quantity;
          item.reservedQuantity += req.quantity;
          item.version += 1;
          succeeded = true;
        }

        const latencyMs = performance.now() - start;
        if (succeeded) {
          results.push({
            requestId: req.requestId,
            success: true,
            quantity: req.quantity,
            attempts: 1,
            latencyMs,
          });
        } else {
          results.push({
            requestId: req.requestId,
            success: false,
            quantity: req.quantity,
            error: 'Atomic condition (available >= qty) failed',
            attempts: 1,
            latencyMs,
          });
        }
      });

      await Promise.all(tasks);
      break;
    }

    case 'EVENT_SOURCED_OCC': {
      description =
        'Event-Sourced Optimistic Concurrency Control with retry backoff & jitter. Preserves immutable append history, prevents oversell, and guarantees state hash parity.';
      const TIMELINE_ID = '00000000-0000-0000-0000-000000000001';
      const AGGREGATE_ID = requests[0]?.sku ?? 'SKU-CONCURRENCY-1';
      const repo = new InMemoryAggregateRepository<InventoryState>('Inventory');

      // Initialize aggregate in event store
      const initEvent = decideInitializeInventory(
        {
          command_id: 'cmd-init-1',
          request_id: 'req-init-1',
          actor_id: 'system',
          timeline_id: TIMELINE_ID,
          aggregate_id: AGGREGATE_ID,
          aggregate_type: 'Inventory',
          expected_sequence: 0,
          payload: { sku: AGGREGATE_ID, initial_quantity: initialStock },
          causation_id: null,
          correlation_id: 'corr-init',
        },
        null,
      );

      const initState = inventoryReducer(null, initEvent);
      await repo.save(TIMELINE_ID, AGGREGATE_ID, 0, [initEvent], initState, 'hash-init');

      const tasks = requests.map(async (req) => {
        const start = performance.now();
        let attempts = 0;
        let success = false;
        let lastError: string | undefined;

        while (attempts < maxOccRetries && !success) {
          attempts++;
          try {
            // 1. Load latest state and sequence from repository
            const snapshot = await repo.load(TIMELINE_ID, AGGREGATE_ID);
            if (!snapshot) {
              throw new Error('Aggregate not found');
            }

            // 2. Pure domain decision based on current aggregate state
            const reserveEvent = decideReserveInventory(
              {
                command_id: `cmd-res-${req.requestId}-${attempts}`,
                request_id: `req-${req.requestId}-${attempts}`,
                actor_id: 'worker',
                timeline_id: TIMELINE_ID,
                aggregate_id: AGGREGATE_ID,
                aggregate_type: 'Inventory',
                expected_sequence: snapshot.sequence,
                payload: { order_id: `order-${req.requestId}`, quantity: req.quantity },
                causation_id: null,
                correlation_id: `corr-${req.requestId}`,
              },
              snapshot.state,
            );

            // 3. Reduce state and attempt OCC append
            const nextState = inventoryReducer(snapshot.state, reserveEvent);
            const appendRes = await repo.save(
              TIMELINE_ID,
              AGGREGATE_ID,
              snapshot.sequence,
              [reserveEvent],
              nextState,
              reserveEvent.event_hash,
            );

            if (appendRes.success) {
              success = true;
              break;
            }
          } catch (err: unknown) {
            const isConcurrency =
              err instanceof ConcurrencyError ||
              (err as { category?: string })?.category === 'CONCURRENCY_CONFLICT' ||
              (err as Error).name === 'ConcurrencyError' ||
              (err as Error).name === 'ConcurrencyConflictError';

            if (isConcurrency) {
              // OCC conflict: another worker appended first. Apply exponential backoff with jitter
              const backoff =
                Math.pow(1.5, attempts) * initialBackoffMs + Math.random() * initialBackoffMs;
              await new Promise((r) => setTimeout(r, backoff));
              continue;
            } else if ((err as Error).name === 'InvariantViolationError') {
              // Business rule failure: inventory genuinely exhausted
              lastError = (err as Error).message;
              break;
            } else {
              lastError = (err as Error).message;
              break;
            }
          }
        }

        const latencyMs = performance.now() - start;
        results.push({
          requestId: req.requestId,
          success,
          quantity: req.quantity,
          error: success ? undefined : (lastError ?? 'Max OCC retries exceeded'),
          attempts,
          latencyMs,
        });
      });

      await Promise.all(tasks);

      // Re-read final state from event store
      const finalSnapshot = await repo.load(TIMELINE_ID, AGGREGATE_ID);
      if (finalSnapshot) {
        item.availableQuantity = finalSnapshot.state.available_quantity;
        item.reservedQuantity = finalSnapshot.state.reserved_quantity;
        item.version = finalSnapshot.sequence;
      }
      break;
    }
  }

  const elapsedMs = performance.now() - startAll;
  const successfulAllocations = results.filter((r) => r.success).length;
  const failedAllocations = results.filter((r) => !r.success).length;
  const totalRequestedQuantity = requests.reduce((sum, r) => sum + r.quantity, 0);
  const totalAllocatedQuantity = results
    .filter((r) => r.success)
    .reduce((sum, r) => sum + r.quantity, 0);

  // Oversell calculation: if allocated quantity exceeds initial stock, or available stock went negative
  const oversoldQuantity = Math.max(0, totalAllocatedQuantity - initialStock);
  const isOversold = oversoldQuantity > 0 || item.availableQuantity < 0;

  const latencies = results.map((r) => r.latencyMs);

  return {
    strategy,
    description,
    totalRequests: requests.length,
    successfulAllocations,
    failedAllocations,
    initialStock,
    finalAvailableStock: item.availableQuantity,
    totalRequestedQuantity,
    totalAllocatedQuantity,
    oversoldQuantity,
    isOversold,
    elapsedMs: Math.round(elapsedMs * 100) / 100,
    latency: computeLatencyMetrics(latencies),
  };
}
