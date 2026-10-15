export type InventoryStrategy =
  | 'UNCONTROLLED_READ_MODIFY_WRITE'
  | 'PESSIMISTIC_ROW_LOCK'
  | 'ATOMIC_CONDITIONAL_UPDATE'
  | 'EVENT_SOURCED_OCC';

export interface InventoryItem {
  sku: string;
  totalQuantity: number;
  availableQuantity: number;
  reservedQuantity: number;
  version: number;
}

export interface ReservationRequest {
  requestId: string;
  sku: string;
  quantity: number;
}

export interface ReservationResult {
  requestId: string;
  success: boolean;
  quantity: number;
  error?: string | undefined;
  attempts: number;
  latencyMs: number;
}

export interface LatencyMetrics {
  p50: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
  avg: number;
}

export interface InventoryLabResult {
  strategy: InventoryStrategy;
  description: string;
  totalRequests: number;
  successfulAllocations: number;
  failedAllocations: number;
  initialStock: number;
  finalAvailableStock: number;
  totalRequestedQuantity: number;
  totalAllocatedQuantity: number;
  oversoldQuantity: number;
  isOversold: boolean;
  elapsedMs: number;
  latency: LatencyMetrics;
}

export interface OccContentionResult {
  aggregateId: string;
  totalWriters: number;
  directSuccessCount: number;
  conflictCount: number;
  retriedSuccessCount: number;
  totalAttempts: number;
  maxRetriesObserved: number;
  elapsedMs: number;
  finalSequence: number;
  latency: LatencyMetrics;
}

export interface ScalingBenchmarkResult {
  aggregateCount: number;
  successfulAppends: number;
  failedAppends: number;
  conflictCount: number;
  throughputOpsPerSec: number;
  elapsedMs: number;
  latency: LatencyMetrics;
}

export interface MongoLatencyProfileResult {
  totalEvents: number;
  stage1EventStoreAppend: LatencyMetrics;
  stage2OutboxPublish: LatencyMetrics;
  stage3ProjectionCommit: LatencyMetrics;
  endToEndProjectionLag: LatencyMetrics;
  totalElapsedMs: number;
}

export function computeLatencyMetrics(latencies: number[]): LatencyMetrics {
  if (latencies.length === 0) {
    return { p50: 0, p95: 0, p99: 0, min: 0, max: 0, avg: 0 };
  }
  const sorted = [...latencies].sort((a, b) => a - b);
  const n = sorted.length;
  const p50 = sorted[Math.floor(n * 0.5)] ?? 0;
  const p95 = sorted[Math.floor(n * 0.95)] ?? 0;
  const p99 = sorted[Math.floor(n * 0.99)] ?? 0;
  const min = sorted[0] ?? 0;
  const max = sorted[n - 1] ?? 0;
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const avg = Math.round((sum / n) * 100) / 100;

  return {
    p50: Math.round(p50 * 100) / 100,
    p95: Math.round(p95 * 100) / 100,
    p99: Math.round(p99 * 100) / 100,
    min: Math.round(min * 100) / 100,
    max: Math.round(max * 100) / 100,
    avg,
  };
}
