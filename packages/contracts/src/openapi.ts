/**
 * Light OpenAPI 3.1 Contract Specification — Phase 5 CQRS
 */

export interface OpenApiSpec {
  openapi: string;
  info: {
    title: string;
    version: string;
    description: string;
  };
  paths: Record<string, unknown>;
  components: {
    schemas: Record<string, unknown>;
  };
}

export function getOpenApiSpec(): OpenApiSpec {
  return {
    openapi: '3.1.0',
    info: {
      title: 'CHRONOSCOPE Core & CQRS API',
      version: '0.1.0',
      description:
        'Deterministic distributed-systems laboratory API. Write path targets MySQL with row-locked OCC; read path targets MongoDB with sequence-guarded projections.',
    },
    paths: {
      '/health/live': {
        get: {
          summary: 'Liveness probe',
          responses: {
            '200': { description: 'Process is alive' },
          },
        },
      },
      '/health/ready/write': {
        get: {
          summary: 'Write-path readiness probe (MySQL + Redis)',
          responses: {
            '200': { description: 'Write-path dependencies healthy' },
            '503': { description: 'Write-path dependencies unavailable' },
          },
        },
      },
      '/health/ready/read': {
        get: {
          summary: 'Read-path readiness probe (MongoDB)',
          responses: {
            '200': { description: 'Read-path dependencies healthy' },
            '503': { description: 'Read-path dependencies unavailable' },
          },
        },
      },
      '/api/v1/commands/order': {
        post: {
          summary: 'Dispatch Order Aggregate Command (CQRS Write Path)',
          description:
            'Dispatches an explicit command to the Order aggregate. Idempotent by command_id via chronoscope_ops.command_deduplication.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/OrderCommandRequest',
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Command executed or returned from deduplication cache',
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/CommandResultResponse',
                  },
                },
              },
            },
            '400': { description: 'Validation error or invalid command format' },
            '409': { description: 'Concurrency conflict (OCC failure)' },
          },
        },
      },
      '/api/v1/orders/{timelineId}/{aggregateId}': {
        get: {
          summary: 'Fetch Order Read Model Summary (CQRS Read Path)',
          description:
            'Fetches denormalized order summary document directly from MongoDB chronoscope_read.order_summary.',
          parameters: [
            {
              name: 'timelineId',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
            {
              name: 'aggregateId',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
          responses: {
            '200': {
              description: 'Order summary document',
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/OrderSummaryResponse',
                  },
                },
              },
            },
            '404': { description: 'Order read model document not found' },
          },
        },
      },
    },
    components: {
      schemas: {
        OrderCommandRequest: {
          type: 'object',
          required: [
            'command_id',
            'request_id',
            'correlation_id',
            'actor_id',
            'timeline_id',
            'aggregate_id',
            'expected_sequence',
            'type',
            'payload',
          ],
          properties: {
            command_id: { type: 'string', format: 'uuid' },
            request_id: { type: 'string' },
            correlation_id: { type: 'string' },
            causation_id: { type: 'string', nullable: true },
            actor_id: { type: 'string' },
            timeline_id: { type: 'string' },
            aggregate_id: { type: 'string' },
            expected_sequence: { type: 'integer', minimum: 0 },
            type: {
              type: 'string',
              enum: ['CreateOrder', 'AddOrderItem', 'ConfirmOrder', 'CancelOrder'],
            },
            payload: { type: 'object' },
          },
        },
        CommandResultResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            command_id: { type: 'string' },
            timeline_id: { type: 'string' },
            aggregate_id: { type: 'string' },
            resulting_sequence: { type: 'integer' },
            state_hash: { type: 'string' },
            deduplicated: { type: 'boolean' },
          },
        },
        OrderSummaryResponse: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            timelineId: { type: 'string' },
            aggregateId: { type: 'string' },
            status: { type: 'string' },
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  sku: { type: 'string' },
                  quantity: { type: 'integer' },
                  amountMinor: { type: 'integer' },
                },
              },
            },
            totalAmountMinor: { type: 'integer' },
            currency: { type: 'string' },
            appliedSequence: { type: 'integer' },
            appliedTimelinePosition: { type: 'integer' },
            sourceStateHash: { type: 'string' },
            projectionHash: { type: 'string' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
  };
}
