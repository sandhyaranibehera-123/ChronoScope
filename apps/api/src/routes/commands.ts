import type { FastifyPluginAsync } from 'fastify';
import {
  OrderCommandRequestSchema,
  type CommandSuccessResponse,
  type CommandFailureResponse,
} from '@chronoscope/contracts';
import {
  ORDER_AGGREGATE_TYPE,
  type OrderState,
  type AggregateRepository,
  decideCreateOrder,
  decideAddOrderItem,
  decideConfirmOrder,
  decideCancelOrder,
  orderReducer,
  DomainError,
  computeStateHash,
} from '@chronoscope/domain';
import {
  type ICommandDeduplicationManager,
  MysqlCommandDeduplicationManager,
  MySqlAggregateRepository,
} from '@chronoscope/database';
import { getMysqlPool } from '../lib/mysql.js';

export interface CommandRouteOptions {
  orderRepository?: AggregateRepository<OrderState> | undefined;
  commandDedupManager?: ICommandDeduplicationManager | undefined;
}

export const commandRoutes: FastifyPluginAsync<CommandRouteOptions> = async (app, opts) => {
  const dedupManager: ICommandDeduplicationManager =
    opts.commandDedupManager ?? new MysqlCommandDeduplicationManager(getMysqlPool());
  const orderRepo: AggregateRepository<OrderState> =
    opts.orderRepository ??
    new MySqlAggregateRepository<OrderState>(getMysqlPool(), ORDER_AGGREGATE_TYPE);

  app.post('/api/v1/commands/order', async (req, reply) => {
    const parseResult = OrderCommandRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        success: false,
        error: {
          category: 'VALIDATION_ERROR',
          code: 'INVALID_REQUEST_BODY',
          message: parseResult.error.message,
          retryable: false,
        },
      });
    }

    const command = parseResult.data;

    // Idempotency check: duplicate command_id returns original result with zero re-execution (Rule 8)
    const existing = await dedupManager.findCommandResult(command.command_id);
    if (existing) {
      const cached = existing.resultPayload as Record<string, unknown>;
      const status = existing.success ? 200 : 400;
      return reply.status(status).send({
        ...cached,
        deduplicated: true,
      });
    }

    try {
      const snapshot = await orderRepo.load(command.timeline_id, command.aggregate_id);
      const currentState = snapshot?.state ?? null;

      let event;
      if (command.type === 'CreateOrder') {
        event = decideCreateOrder(
          {
            command_id: command.command_id,
            request_id: command.request_id,
            correlation_id: command.correlation_id,
            causation_id: command.causation_id ?? null,
            actor_id: command.actor_id,
            timeline_id: command.timeline_id,
            aggregate_id: command.aggregate_id,
            aggregate_type: ORDER_AGGREGATE_TYPE,
            expected_sequence: command.expected_sequence,
            payload: {
              customer_id: String(command.payload['customer_id'] ?? ''),
              currency: String(command.payload['currency'] ?? 'INR'),
            },
          },
          currentState,
        );
      } else if (command.type === 'AddOrderItem') {
        const itemObj = (command.payload['item'] ?? {}) as Record<string, unknown>;
        event = decideAddOrderItem(
          {
            command_id: command.command_id,
            request_id: command.request_id,
            correlation_id: command.correlation_id,
            causation_id: command.causation_id ?? null,
            actor_id: command.actor_id,
            timeline_id: command.timeline_id,
            aggregate_id: command.aggregate_id,
            aggregate_type: ORDER_AGGREGATE_TYPE,
            expected_sequence: command.expected_sequence,
            payload: {
              item: {
                sku: String(itemObj['sku'] ?? ''),
                quantity: Number(itemObj['quantity'] ?? 1),
                unitAmountMinor: BigInt(String(itemObj['unitAmountMinor'] ?? 0)),
                totalAmountMinor: BigInt(String(itemObj['totalAmountMinor'] ?? 0)),
              },
            },
          },
          currentState,
        );
      } else if (command.type === 'ConfirmOrder') {
        const minItems = command.payload['minimum_items'];
        event = decideConfirmOrder(
          {
            command_id: command.command_id,
            request_id: command.request_id,
            correlation_id: command.correlation_id,
            causation_id: command.causation_id ?? null,
            actor_id: command.actor_id,
            timeline_id: command.timeline_id,
            aggregate_id: command.aggregate_id,
            aggregate_type: ORDER_AGGREGATE_TYPE,
            expected_sequence: command.expected_sequence,
            payload:
              minItems !== undefined && minItems !== null
                ? { minimum_items: Number(minItems) }
                : {},
          },
          currentState,
        );
      } else if (command.type === 'CancelOrder') {
        event = decideCancelOrder(
          {
            command_id: command.command_id,
            request_id: command.request_id,
            correlation_id: command.correlation_id,
            causation_id: command.causation_id ?? null,
            actor_id: command.actor_id,
            timeline_id: command.timeline_id,
            aggregate_id: command.aggregate_id,
            aggregate_type: ORDER_AGGREGATE_TYPE,
            expected_sequence: command.expected_sequence,
            payload: {
              reason: command.payload['reason']
                ? String(command.payload['reason'])
                : 'User cancelled',
            },
          },
          currentState,
        );
      } else {
        return reply.status(400).send({
          success: false,
          error: {
            category: 'VALIDATION_ERROR',
            code: 'UNSUPPORTED_COMMAND_TYPE',
            message: `Unsupported command type: ${String(command.type)}`,
            retryable: false,
          },
        });
      }

      const newState = orderReducer(currentState, event);
      const stateHash = computeStateHash(newState);

      const saveResult = await orderRepo.save(
        command.timeline_id,
        command.aggregate_id,
        command.expected_sequence,
        [event],
        newState,
        stateHash,
      );

      const successResponse: CommandSuccessResponse = {
        success: true,
        command_id: command.command_id,
        timeline_id: command.timeline_id,
        aggregate_id: command.aggregate_id,
        resulting_sequence: saveResult.newSequence,
        state_hash: saveResult.stateHash,
        events_produced: 1,
        deduplicated: false,
      };

      await dedupManager.recordCommandResult({
        commandId: command.command_id,
        timelineId: command.timeline_id,
        aggregateId: command.aggregate_id,
        success: true,
        resultPayload: successResponse,
      });

      return reply.status(200).send(successResponse);
    } catch (error) {
      if (error instanceof DomainError) {
        const statusCode = error.category === 'CONCURRENCY_CONFLICT' ? 409 : 400;
        const failureResponse: CommandFailureResponse = {
          success: false,
          command_id: command.command_id,
          timeline_id: command.timeline_id,
          aggregate_id: command.aggregate_id,
          error: {
            category: error.category,
            code: error.code,
            message: error.message,
            retryable: error.retryClassification === 'RETRYABLE',
          },
          deduplicated: false,
        };

        await dedupManager.recordCommandResult({
          commandId: command.command_id,
          timelineId: command.timeline_id,
          aggregateId: command.aggregate_id,
          success: false,
          resultPayload: failureResponse,
        });

        return reply.status(statusCode).send(failureResponse);
      }

      throw error;
    }
  });
};
