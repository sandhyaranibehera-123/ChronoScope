import { z } from 'zod';

/**
 * Zod schemas for MongoDB Read Model Queries — system-guarantees.md rules 10, 11.
 */

export const OrderSummaryItemSchema = z.object({
  sku: z.string(),
  quantity: z.number().int().positive(),
  amountMinor: z.number(),
});

export const OrderSummaryResponseSchema = z.object({
  _id: z.string(),
  timelineId: z.string(),
  aggregateId: z.string(),
  status: z.string(),
  items: z.array(OrderSummaryItemSchema),
  totalAmountMinor: z.number(),
  currency: z.string(),
  appliedSequence: z.number().int(),
  appliedTimelinePosition: z.number().int(),
  appliedKafkaTopic: z.string().optional(),
  appliedKafkaPartition: z.number().int().optional(),
  appliedKafkaOffset: z.union([z.number(), z.string()]).optional(),
  appliedEventId: z.string().optional(),
  sourceAggregateSequence: z.number().int(),
  sourceStateHash: z.string(),
  projectionHash: z.string(),
  updatedAt: z.union([z.string(), z.date()]),
});

export type OrderSummaryResponse = z.infer<typeof OrderSummaryResponseSchema>;
