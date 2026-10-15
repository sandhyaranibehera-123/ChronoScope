import { z } from 'zod';

/**
 * Zod schemas for Order Aggregate commands & outcomes — system-guarantees.md rules 7, 8, 16.
 */

export const CreateOrderPayloadSchema = z.object({
  customer_id: z.string().min(1, 'customer_id is required'),
  currency: z.string().length(3, 'currency must be a 3-letter ISO code'),
});

export const OrderItemSchema = z.object({
  sku: z.string().min(1, 'sku is required'),
  quantity: z.number().int().positive('quantity must be positive'),
  unitAmountMinor: z.union([z.string(), z.number(), z.bigint()]),
  totalAmountMinor: z.union([z.string(), z.number(), z.bigint()]),
});

export const AddOrderItemPayloadSchema = z.object({
  item: OrderItemSchema,
});

export const ConfirmOrderPayloadSchema = z.object({
  minimum_items: z.number().int().positive().optional(),
});

export const CancelOrderPayloadSchema = z.object({
  reason: z.string().optional(),
});

export const OrderCommandTypeSchema = z.enum([
  'CreateOrder',
  'AddOrderItem',
  'ConfirmOrder',
  'CancelOrder',
]);

export const OrderCommandRequestSchema = z.object({
  command_id: z.string().uuid('command_id must be a valid UUID'),
  request_id: z.string().min(1, 'request_id is required'),
  correlation_id: z.string().min(1, 'correlation_id is required'),
  causation_id: z.string().nullable().optional(),
  actor_id: z.string().min(1, 'actor_id is required'),
  timeline_id: z.string().min(1, 'timeline_id is required'),
  aggregate_id: z.string().min(1, 'aggregate_id is required'),
  expected_sequence: z.number().int().min(0, 'expected_sequence must be >= 0'),
  type: OrderCommandTypeSchema,
  payload: z.record(z.unknown()),
});

export type OrderCommandRequest = z.infer<typeof OrderCommandRequestSchema>;
export type OrderCommandType = z.infer<typeof OrderCommandTypeSchema>;

export const CommandSuccessResponseSchema = z.object({
  success: z.literal(true),
  command_id: z.string(),
  timeline_id: z.string(),
  aggregate_id: z.string(),
  resulting_sequence: z.number().int(),
  state_hash: z.string().optional(),
  events_produced: z.number().int(),
  deduplicated: z.boolean().default(false),
});

export const CommandFailureResponseSchema = z.object({
  success: z.literal(false),
  command_id: z.string(),
  timeline_id: z.string(),
  aggregate_id: z.string(),
  error: z.object({
    category: z.string(),
    code: z.string(),
    message: z.string(),
    retryable: z.boolean(),
  }),
  deduplicated: z.boolean().default(false),
});

export const CommandResultResponseSchema = z.union([
  CommandSuccessResponseSchema,
  CommandFailureResponseSchema,
]);

export type CommandSuccessResponse = z.infer<typeof CommandSuccessResponseSchema>;
export type CommandFailureResponse = z.infer<typeof CommandFailureResponseSchema>;
export type CommandResultResponse = z.infer<typeof CommandResultResponseSchema>;
