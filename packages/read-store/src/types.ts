/**
 * MongoDB Read Model Types — chronoscope_read database.
 * Governed by system-guarantees.md Rules 5, 10, 11 and database-ownership.md.
 *
 * CRITICAL: Document _id is strictly `${timelineId}:${aggregateId}`, NEVER aggregateId alone.
 * A branch timeline can hold the same aggregateId as MAIN representing different state.
 */

export interface OrderItemSummary {
  sku: string;
  quantity: number;
  amountMinor: number;
}

export interface OrderSummaryDocument {
  /** Composite key `${timelineId}:${aggregateId}` (Rule 5) */
  _id: string;
  timelineId: string;
  aggregateId: string;
  status: string;
  items: OrderItemSummary[];
  totalAmountMinor: number;
  currency: string;

  /** Idempotency guard: highest aggregate_sequence folded into this document (Rule 10) */
  appliedSequence: number;
  appliedTimelinePosition: number;

  /** Kafka transport audit coordinates (Rule 24) */
  appliedKafkaTopic: string;
  appliedKafkaPartition: number;
  appliedKafkaOffset: number;
  appliedEventId: string;

  /** Canonical hash tracking (Rule 11) */
  sourceAggregateSequence: number;
  sourceStateHash: string;
  projectionHash: string;

  updatedAt: Date;
}

export interface PaymentSummaryDocument {
  _id: string;
  timelineId: string;
  aggregateId: string;
  orderId: string;
  amountMinor: number;
  currency: string;
  status: string;

  appliedSequence: number;
  appliedTimelinePosition: number;
  appliedKafkaTopic: string;
  appliedKafkaPartition: number;
  appliedKafkaOffset: number;
  appliedEventId: string;
  sourceAggregateSequence: number;
  sourceStateHash: string;
  projectionHash: string;

  updatedAt: Date;
}

export interface ShipmentSummaryDocument {
  _id: string;
  timelineId: string;
  aggregateId: string;
  orderId: string;
  status: string;
  carrier: string | null;
  trackingNumber: string | null;

  appliedSequence: number;
  appliedTimelinePosition: number;
  appliedKafkaTopic: string;
  appliedKafkaPartition: number;
  appliedKafkaOffset: number;
  appliedEventId: string;
  sourceAggregateSequence: number;
  sourceStateHash: string;
  projectionHash: string;

  updatedAt: Date;
}

export type ReadModelDocument =
  OrderSummaryDocument | PaymentSummaryDocument | ShipmentSummaryDocument;

export interface ProjectionUpsertResult {
  readonly status: 'APPLIED' | 'NOOP_STALE_SEQUENCE' | 'NOOP_ALREADY_APPLIED';
  readonly appliedSequence: number;
  readonly documentId: string;
}
