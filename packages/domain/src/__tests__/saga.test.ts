import { describe, expect, it } from 'vitest';
import type { Command } from '../core/command.js';
import type { DomainEvent } from '../core/event.js';
import {
  executeOrderFulfillmentSaga,
  type CommandExecutor,
} from '../workflows/order-fulfillment-saga.js';
import type { OrderState } from '../aggregates/order/state.js';

describe('Dynamic Order Fulfillment Saga Orchestrator', () => {
  const timelineId = 'timeline-main';
  const orderId = 'order-999';
  const correlationId = 'corr-workflow-1';
  const actorId = 'user-1';

  const initialOrderState: OrderState = {
    timeline_id: timelineId,
    aggregate_id: orderId,
    customer_id: 'cust-1',
    currency: 'USD',
    status: 'CREATED',
    items: [
      { sku: 'SKU-SHIRT', quantity: 2, unitAmountMinor: 2500n, totalAmountMinor: 5000n },
      { sku: 'SKU-PANTS', quantity: 1, unitAmountMinor: 4000n, totalAmountMinor: 4000n },
    ],
    total_amount_minor: 9000n, // $90.00
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const destination = {
    address: '456 Market St',
    city: 'San Francisco',
    postal_code: '94103',
    country: 'USA',
  };

  it('completes the full fulfillment workflow on happy path', async () => {
    const executedCommands: Command[] = [];

    const mockExecutor: CommandExecutor = async (command) => {
      executedCommands.push(command);
      const mockEvent: DomainEvent = {
        event_id: `evt-${executedCommands.length}`,
        timeline_id: command.timeline_id,
        aggregate_id: command.aggregate_id,
        aggregate_type: command.aggregate_type,
        aggregate_sequence: command.expected_sequence + 1,
        event_type: `${command.aggregate_type}Handled`,
        schema_version: 1,
        payload: command.payload,
        event_hash: 'mock-hash',
        causation_id: command.causation_id,
        correlation_id: command.correlation_id,
        recorded_at: new Date().toISOString(),
      };
      return { success: true, events: [mockEvent] };
    };

    const result = await executeOrderFulfillmentSaga(
      {
        correlationId,
        timelineId,
        actorId,
        order: initialOrderState,
        destination,
        paymentMethod: 'CREDIT_CARD',
      },
      mockExecutor,
    );

    expect(result.status).toBe('COMPLETED');
    expect(result.compensations).toHaveLength(0);
    expect(result.steps.length).toBeGreaterThanOrEqual(6);

    // Verify all steps succeeded
    for (const step of result.steps) {
      expect(step.status).toBe('SUCCESS');
    }

    // Every command must target exactly one aggregate (Rule 7)
    for (const cmd of executedCommands) {
      expect(cmd.aggregate_id).toBeDefined();
      expect(typeof cmd.aggregate_id).toBe('string');
      expect(cmd.aggregate_type).toBeDefined();
    }
  });

  it('compensates properly when payment fails (counterfactual scenario / ForcePaymentFailure)', async () => {
    const executedCommands: Command[] = [];

    const mockExecutor: CommandExecutor = async (command) => {
      executedCommands.push(command);
      return {
        success: true,
        events: [
          {
            event_id: `evt-${executedCommands.length}`,
            timeline_id: command.timeline_id,
            aggregate_id: command.aggregate_id,
            aggregate_type: command.aggregate_type,
            aggregate_sequence: command.expected_sequence + 1,
            event_type: 'Handled',
            schema_version: 1,
            payload: {},
            event_hash: 'hash',
            causation_id: null,
            correlation_id: command.correlation_id,
            recorded_at: new Date().toISOString(),
          },
        ],
      };
    };

    const result = await executeOrderFulfillmentSaga(
      {
        correlationId,
        timelineId,
        actorId,
        order: initialOrderState,
        destination,
        paymentMethod: 'CREDIT_CARD',
        forcePaymentFailure: true, // Simulating counterfactual payment failure!
      },
      mockExecutor,
    );

    expect(result.status).toBe('COMPENSATED');
    expect(result.failureReason).toContain('Payment processing failed');

    // Compensations must include releasing inventory for both SKUs + cancelling order
    expect(result.compensations).toHaveLength(3);
    const compensationNames = result.compensations.map((c) => c.name);
    expect(compensationNames).toContain('ReleaseInventory_SKU-SHIRT');
    expect(compensationNames).toContain('ReleaseInventory_SKU-PANTS');
    expect(compensationNames).toContain('CancelOrder');

    for (const comp of result.compensations) {
      expect(comp.success).toBe(true);
    }
  });

  it('compensates properly when shipment fails', async () => {
    const mockExecutor: CommandExecutor = async (command) => {
      const payload = command.payload as Record<string, unknown>;
      if (command.aggregate_type === 'SHIPMENT' && payload['carrier']) {
        // Fail shipment dispatch
        return {
          success: false,
          events: [],
        };
      }
      return {
        success: true,
        events: [
          {
            event_id: `evt-comp`,
            timeline_id: command.timeline_id,
            aggregate_id: command.aggregate_id,
            aggregate_type: command.aggregate_type,
            aggregate_sequence: command.expected_sequence + 1,
            event_type: 'Handled',
            schema_version: 1,
            payload: {},
            event_hash: 'hash',
            causation_id: null,
            correlation_id: command.correlation_id,
            recorded_at: new Date().toISOString(),
          },
        ],
      };
    };

    const result = await executeOrderFulfillmentSaga(
      {
        correlationId,
        timelineId,
        actorId,
        order: initialOrderState,
        destination,
        paymentMethod: 'CREDIT_CARD',
      },
      mockExecutor,
    );

    expect(result.status).toBe('COMPENSATED');
    expect(result.failureReason).toContain('Shipment failed to dispatch');

    // Compensations: CancelShipment, RefundPayment, ReleaseInventory x2, CancelOrder
    const compNames = result.compensations.map((c) => c.name);
    expect(compNames).toContain('CancelShipment');
    expect(compNames).toContain('RefundPayment');
    expect(compNames).toContain('ReleaseInventory_SKU-SHIRT');
    expect(compNames).toContain('ReleaseInventory_SKU-PANTS');
    expect(compNames).toContain('CancelOrder');
  });
});
