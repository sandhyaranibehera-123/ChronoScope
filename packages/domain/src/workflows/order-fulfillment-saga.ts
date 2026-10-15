import type { Command } from '../core/command.js';
import type { DomainError } from '../core/errors.js';
import type { DomainEvent } from '../core/event.js';
import {
  ORDER_AGGREGATE_TYPE,
  type CancelOrderCommand,
  type ConfirmOrderCommand,
  type MarkOrderAllocatedCommand,
  type MarkOrderPaidCommand,
  type MarkOrderShippedCommand,
  type OrderState,
} from '../aggregates/order/index.js';
import {
  PAYMENT_AGGREGATE_TYPE,
  type AuthorizePaymentCommand,
  type CapturePaymentCommand,
  type RefundPaymentCommand,
} from '../aggregates/payment/index.js';
import {
  INVENTORY_AGGREGATE_TYPE,
  type DeductInventoryCommand,
  type ReleaseInventoryCommand,
  type ReserveInventoryCommand,
} from '../aggregates/inventory/index.js';
import {
  SHIPMENT_AGGREGATE_TYPE,
  type CancelShipmentCommand,
  type CreateShipmentCommand,
  type DispatchShipmentCommand,
  type ShippingDestination,
} from '../aggregates/shipment/index.js';

export type SagaStepStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'COMPENSATED';

export interface SagaStep {
  readonly stepNumber: number;
  readonly name: string;
  readonly targetAggregateType: string;
  readonly targetAggregateId: string;
  readonly status: SagaStepStatus;
  readonly command: Command;
  readonly events: readonly DomainEvent[];
  readonly error?: DomainError | undefined;
}

export interface CompensationStep {
  readonly compensatingForStep: number;
  readonly name: string;
  readonly targetAggregateType: string;
  readonly targetAggregateId: string;
  readonly command: Command;
  readonly events: readonly DomainEvent[];
  readonly success: boolean;
}

export interface SagaExecutionResult {
  readonly correlationId: string;
  readonly timelineId: string;
  readonly orderId: string;
  readonly status: 'COMPLETED' | 'COMPENSATED' | 'FAILED';
  readonly steps: readonly SagaStep[];
  readonly compensations: readonly CompensationStep[];
  readonly failureReason?: string | undefined;
}

export interface FulfillmentSagaInput {
  readonly correlationId: string;
  readonly timelineId: string;
  readonly actorId: string;
  readonly order: OrderState;
  readonly destination: ShippingDestination;
  readonly paymentMethod: string;
  /**
   * Simulation flag for counterfactual executions (Phase 7 / ScenarioInput: ForcePaymentFailure)
   */
  readonly forcePaymentFailure?: boolean | undefined;
}

export type CommandExecutor = (command: Command) => Promise<{
  success: boolean;
  events: readonly DomainEvent[];
  error?: DomainError | undefined;
}>;

/**
 * Dynamic Order Fulfillment Saga Orchestrator.
 *
 * Coordinates multi-aggregate fulfillment strictly conforming to:
 * - Rule 7: "A command targets exactly one aggregate."
 * - Rule 15: "One aggregate = one ordered event stream; compensation map specified."
 *
 * Sequence:
 * 1. Confirm Order (Order)
 * 2. Reserve Inventory for each item (Inventory per SKU)
 * 3. Authorize & Capture Payment (Payment)
 * 4. Mark Order Paid & Allocated (Order)
 * 5. Create & Dispatch Shipment (Shipment)
 * 6. Mark Order Shipped & Deduct Inventory (Order + Inventory)
 *
 * Rollback on failure: executes backwards compensation steps.
 */
export async function executeOrderFulfillmentSaga(
  input: FulfillmentSagaInput,
  executor: CommandExecutor,
): Promise<SagaExecutionResult> {
  const steps: SagaStep[] = [];
  const compensations: CompensationStep[] = [];
  let causationId: string | null = null;
  let stepIndex = 1;

  const {
    correlationId,
    timelineId,
    actorId,
    order,
    destination,
    paymentMethod,
    forcePaymentFailure,
  } = input;

  // Helper to run a forward step
  async function runStep(
    name: string,
    targetType: string,
    targetId: string,
    command: Command,
  ): Promise<boolean> {
    const result = await executor(command);
    const step: SagaStep = {
      stepNumber: stepIndex++,
      name,
      targetAggregateType: targetType,
      targetAggregateId: targetId,
      status: result.success ? 'SUCCESS' : 'FAILED',
      command,
      events: result.events,
      ...(result.error ? { error: result.error } : {}),
    };
    steps.push(step);

    const lastEvent = result.events[result.events.length - 1];
    if (result.success && lastEvent) {
      causationId = lastEvent.event_id as string;
      return true;
    }
    return false;
  }

  // --- Step 1: Confirm Order ---
  const confirmCmd: ConfirmOrderCommand = {
    command_id: crypto.randomUUID(),
    request_id: crypto.randomUUID(),
    correlation_id: correlationId,
    causation_id: causationId,
    actor_id: actorId,
    timeline_id: timelineId,
    aggregate_id: order.aggregate_id,
    aggregate_type: ORDER_AGGREGATE_TYPE,
    expected_sequence: 1, // assumes order created at seq 1
    payload: { minimum_items: 1 },
  };

  const confirmOk = await runStep(
    'ConfirmOrder',
    ORDER_AGGREGATE_TYPE,
    order.aggregate_id,
    confirmCmd,
  );
  if (!confirmOk) {
    return {
      correlationId,
      timelineId,
      orderId: order.aggregate_id,
      status: 'FAILED',
      steps,
      compensations,
      failureReason: 'Failed to confirm order',
    };
  }

  // --- Step 2: Reserve Inventory for each item ---
  const reservedItems: Array<{ sku: string; quantity: number }> = [];
  let inventoryOk = true;

  for (const item of order.items) {
    const reserveCmd: ReserveInventoryCommand = {
      command_id: crypto.randomUUID(),
      request_id: crypto.randomUUID(),
      correlation_id: correlationId,
      causation_id: causationId,
      actor_id: actorId,
      timeline_id: timelineId,
      aggregate_id: item.sku,
      aggregate_type: INVENTORY_AGGREGATE_TYPE,
      expected_sequence: 1, // assumes inventory initialized at seq 1
      payload: {
        order_id: order.aggregate_id,
        quantity: item.quantity,
      },
    };

    const ok = await runStep(
      `ReserveInventory_${item.sku}`,
      INVENTORY_AGGREGATE_TYPE,
      item.sku,
      reserveCmd,
    );
    if (!ok) {
      inventoryOk = false;
      break;
    }
    reservedItems.push({ sku: item.sku, quantity: item.quantity });
  }

  if (!inventoryOk) {
    // Compensate: release already reserved items and cancel order
    for (const res of reservedItems) {
      const releaseCmd: ReleaseInventoryCommand = {
        command_id: crypto.randomUUID(),
        request_id: crypto.randomUUID(),
        correlation_id: correlationId,
        causation_id: causationId,
        actor_id: actorId,
        timeline_id: timelineId,
        aggregate_id: res.sku,
        aggregate_type: INVENTORY_AGGREGATE_TYPE,
        expected_sequence: 2,
        payload: {
          order_id: order.aggregate_id,
          quantity: res.quantity,
          reason: 'Inventory reservation failed for subsequent item',
        },
      };
      const resRelease = await executor(releaseCmd);
      compensations.push({
        compensatingForStep: 2,
        name: `ReleaseInventory_${res.sku}`,
        targetAggregateType: INVENTORY_AGGREGATE_TYPE,
        targetAggregateId: res.sku,
        command: releaseCmd,
        events: resRelease.events,
        success: resRelease.success,
      });
    }

    const cancelCmd: CancelOrderCommand = {
      command_id: crypto.randomUUID(),
      request_id: crypto.randomUUID(),
      correlation_id: correlationId,
      causation_id: causationId,
      actor_id: actorId,
      timeline_id: timelineId,
      aggregate_id: order.aggregate_id,
      aggregate_type: ORDER_AGGREGATE_TYPE,
      expected_sequence: 2,
      payload: { reason: 'Inventory unavailable' },
    };
    const cancelRes = await executor(cancelCmd);
    compensations.push({
      compensatingForStep: 1,
      name: 'CancelOrder',
      targetAggregateType: ORDER_AGGREGATE_TYPE,
      targetAggregateId: order.aggregate_id,
      command: cancelCmd,
      events: cancelRes.events,
      success: cancelRes.success,
    });

    return {
      correlationId,
      timelineId,
      orderId: order.aggregate_id,
      status: 'COMPENSATED',
      steps,
      compensations,
      failureReason: 'Insufficient inventory for order items',
    };
  }

  // --- Step 3: Payment (Authorize & Capture) ---
  const paymentId = `pay_${order.aggregate_id}`;
  let paymentCaptured = false;

  if (forcePaymentFailure) {
    // Simulate payment failure for counterfactual branching experiments
    steps.push({
      stepNumber: stepIndex++,
      name: 'ProcessPayment',
      targetAggregateType: PAYMENT_AGGREGATE_TYPE,
      targetAggregateId: paymentId,
      status: 'FAILED',
      command: {
        command_id: crypto.randomUUID(),
        request_id: crypto.randomUUID(),
        correlation_id: correlationId,
        causation_id: causationId,
        actor_id: actorId,
        timeline_id: timelineId,
        aggregate_id: paymentId,
        aggregate_type: PAYMENT_AGGREGATE_TYPE,
        expected_sequence: 0,
        payload: {},
      },
      events: [],
    });
  } else {
    const authCmd: AuthorizePaymentCommand = {
      command_id: crypto.randomUUID(),
      request_id: crypto.randomUUID(),
      correlation_id: correlationId,
      causation_id: causationId,
      actor_id: actorId,
      timeline_id: timelineId,
      aggregate_id: paymentId,
      aggregate_type: PAYMENT_AGGREGATE_TYPE,
      expected_sequence: 0,
      payload: {
        order_id: order.aggregate_id,
        currency: order.currency,
        amount_minor: order.total_amount_minor,
        payment_method: paymentMethod,
      },
    };
    const authOk = await runStep('AuthorizePayment', PAYMENT_AGGREGATE_TYPE, paymentId, authCmd);

    if (authOk) {
      const capCmd: CapturePaymentCommand = {
        command_id: crypto.randomUUID(),
        request_id: crypto.randomUUID(),
        correlation_id: correlationId,
        causation_id: causationId,
        actor_id: actorId,
        timeline_id: timelineId,
        aggregate_id: paymentId,
        aggregate_type: PAYMENT_AGGREGATE_TYPE,
        expected_sequence: 1,
        payload: { transaction_reference: `tx_${crypto.randomUUID()}` },
      };
      paymentCaptured = await runStep('CapturePayment', PAYMENT_AGGREGATE_TYPE, paymentId, capCmd);
    }
  }

  if (!paymentCaptured) {
    // Compensate: release all reserved items and cancel order
    for (const res of reservedItems) {
      const releaseCmd: ReleaseInventoryCommand = {
        command_id: crypto.randomUUID(),
        request_id: crypto.randomUUID(),
        correlation_id: correlationId,
        causation_id: causationId,
        actor_id: actorId,
        timeline_id: timelineId,
        aggregate_id: res.sku,
        aggregate_type: INVENTORY_AGGREGATE_TYPE,
        expected_sequence: 2,
        payload: {
          order_id: order.aggregate_id,
          quantity: res.quantity,
          reason: 'Payment failed compensation',
        },
      };
      const releaseRes = await executor(releaseCmd);
      compensations.push({
        compensatingForStep: 2,
        name: `ReleaseInventory_${res.sku}`,
        targetAggregateType: INVENTORY_AGGREGATE_TYPE,
        targetAggregateId: res.sku,
        command: releaseCmd,
        events: releaseRes.events,
        success: releaseRes.success,
      });
    }

    const cancelCmd: CancelOrderCommand = {
      command_id: crypto.randomUUID(),
      request_id: crypto.randomUUID(),
      correlation_id: correlationId,
      causation_id: causationId,
      actor_id: actorId,
      timeline_id: timelineId,
      aggregate_id: order.aggregate_id,
      aggregate_type: ORDER_AGGREGATE_TYPE,
      expected_sequence: 2,
      payload: { reason: 'Payment authorization or capture failed' },
    };
    const cancelRes = await executor(cancelCmd);
    compensations.push({
      compensatingForStep: 1,
      name: 'CancelOrder',
      targetAggregateType: ORDER_AGGREGATE_TYPE,
      targetAggregateId: order.aggregate_id,
      command: cancelCmd,
      events: cancelRes.events,
      success: cancelRes.success,
    });

    return {
      correlationId,
      timelineId,
      orderId: order.aggregate_id,
      status: 'COMPENSATED',
      steps,
      compensations,
      failureReason: 'Payment processing failed',
    };
  }

  // --- Step 4: Mark Order Paid & Allocated ---
  const markPaidCmd: MarkOrderPaidCommand = {
    command_id: crypto.randomUUID(),
    request_id: crypto.randomUUID(),
    correlation_id: correlationId,
    causation_id: causationId,
    actor_id: actorId,
    timeline_id: timelineId,
    aggregate_id: order.aggregate_id,
    aggregate_type: ORDER_AGGREGATE_TYPE,
    expected_sequence: 2,
    payload: {
      payment_id: paymentId,
      amount_minor: order.total_amount_minor,
      currency: order.currency,
    },
  };
  await runStep('MarkOrderPaid', ORDER_AGGREGATE_TYPE, order.aggregate_id, markPaidCmd);

  const markAllocatedCmd: MarkOrderAllocatedCommand = {
    command_id: crypto.randomUUID(),
    request_id: crypto.randomUUID(),
    correlation_id: correlationId,
    causation_id: causationId,
    actor_id: actorId,
    timeline_id: timelineId,
    aggregate_id: order.aggregate_id,
    aggregate_type: ORDER_AGGREGATE_TYPE,
    expected_sequence: 3,
    payload: { allocation_id: `alloc_${order.aggregate_id}` },
  };
  await runStep('MarkOrderAllocated', ORDER_AGGREGATE_TYPE, order.aggregate_id, markAllocatedCmd);

  // --- Step 5: Shipment (Create & Dispatch) ---
  const shipmentId = `ship_${order.aggregate_id}`;
  const createShipCmd: CreateShipmentCommand = {
    command_id: crypto.randomUUID(),
    request_id: crypto.randomUUID(),
    correlation_id: correlationId,
    causation_id: causationId,
    actor_id: actorId,
    timeline_id: timelineId,
    aggregate_id: shipmentId,
    aggregate_type: SHIPMENT_AGGREGATE_TYPE,
    expected_sequence: 0,
    payload: {
      order_id: order.aggregate_id,
      items: order.items.map((i) => ({ sku: i.sku, quantity: i.quantity })),
      destination,
    },
  };
  const shipCreated = await runStep(
    'CreateShipment',
    SHIPMENT_AGGREGATE_TYPE,
    shipmentId,
    createShipCmd,
  );

  let shipDispatched = false;
  if (shipCreated) {
    const dispatchCmd: DispatchShipmentCommand = {
      command_id: crypto.randomUUID(),
      request_id: crypto.randomUUID(),
      correlation_id: correlationId,
      causation_id: causationId,
      actor_id: actorId,
      timeline_id: timelineId,
      aggregate_id: shipmentId,
      aggregate_type: SHIPMENT_AGGREGATE_TYPE,
      expected_sequence: 1,
      payload: {
        tracking_number: `TRK_${crypto.randomUUID().slice(0, 8)}`,
        carrier: 'CHRONO_EXPRESS',
      },
    };
    shipDispatched = await runStep(
      'DispatchShipment',
      SHIPMENT_AGGREGATE_TYPE,
      shipmentId,
      dispatchCmd,
    );
  }

  if (!shipDispatched) {
    // Compensate: cancel shipment, refund payment, release inventory, cancel order
    if (shipCreated) {
      const cancelShipCmd: CancelShipmentCommand = {
        command_id: crypto.randomUUID(),
        request_id: crypto.randomUUID(),
        correlation_id: correlationId,
        causation_id: causationId,
        actor_id: actorId,
        timeline_id: timelineId,
        aggregate_id: shipmentId,
        aggregate_type: SHIPMENT_AGGREGATE_TYPE,
        expected_sequence: 1,
        payload: { reason: 'Shipment dispatch failed' },
      };
      const shipCancelRes = await executor(cancelShipCmd);
      compensations.push({
        compensatingForStep: 5,
        name: 'CancelShipment',
        targetAggregateType: SHIPMENT_AGGREGATE_TYPE,
        targetAggregateId: shipmentId,
        command: cancelShipCmd,
        events: shipCancelRes.events,
        success: shipCancelRes.success,
      });
    }

    const refundCmd: RefundPaymentCommand = {
      command_id: crypto.randomUUID(),
      request_id: crypto.randomUUID(),
      correlation_id: correlationId,
      causation_id: causationId,
      actor_id: actorId,
      timeline_id: timelineId,
      aggregate_id: paymentId,
      aggregate_type: PAYMENT_AGGREGATE_TYPE,
      expected_sequence: 2,
      payload: {
        reason: 'Shipment failed compensation',
        refund_reference: `ref_${crypto.randomUUID()}`,
      },
    };
    const refundRes = await executor(refundCmd);
    compensations.push({
      compensatingForStep: 3,
      name: 'RefundPayment',
      targetAggregateType: PAYMENT_AGGREGATE_TYPE,
      targetAggregateId: paymentId,
      command: refundCmd,
      events: refundRes.events,
      success: refundRes.success,
    });

    for (const res of reservedItems) {
      const releaseCmd: ReleaseInventoryCommand = {
        command_id: crypto.randomUUID(),
        request_id: crypto.randomUUID(),
        correlation_id: correlationId,
        causation_id: causationId,
        actor_id: actorId,
        timeline_id: timelineId,
        aggregate_id: res.sku,
        aggregate_type: INVENTORY_AGGREGATE_TYPE,
        expected_sequence: 2,
        payload: {
          order_id: order.aggregate_id,
          quantity: res.quantity,
          reason: 'Shipment failed compensation',
        },
      };
      const releaseRes = await executor(releaseCmd);
      compensations.push({
        compensatingForStep: 2,
        name: `ReleaseInventory_${res.sku}`,
        targetAggregateType: INVENTORY_AGGREGATE_TYPE,
        targetAggregateId: res.sku,
        command: releaseCmd,
        events: releaseRes.events,
        success: releaseRes.success,
      });
    }

    const cancelCmd: CancelOrderCommand = {
      command_id: crypto.randomUUID(),
      request_id: crypto.randomUUID(),
      correlation_id: correlationId,
      causation_id: causationId,
      actor_id: actorId,
      timeline_id: timelineId,
      aggregate_id: order.aggregate_id,
      aggregate_type: ORDER_AGGREGATE_TYPE,
      expected_sequence: 4,
      payload: { reason: 'Shipment failed' },
    };
    const cancelRes = await executor(cancelCmd);
    compensations.push({
      compensatingForStep: 1,
      name: 'CancelOrder',
      targetAggregateType: ORDER_AGGREGATE_TYPE,
      targetAggregateId: order.aggregate_id,
      command: cancelCmd,
      events: cancelRes.events,
      success: cancelRes.success,
    });

    return {
      correlationId,
      timelineId,
      orderId: order.aggregate_id,
      status: 'COMPENSATED',
      steps,
      compensations,
      failureReason: 'Shipment failed to dispatch',
    };
  }

  // --- Step 6: Mark Order Shipped & Deduct Inventory ---
  const markShippedCmd: MarkOrderShippedCommand = {
    command_id: crypto.randomUUID(),
    request_id: crypto.randomUUID(),
    correlation_id: correlationId,
    causation_id: causationId,
    actor_id: actorId,
    timeline_id: timelineId,
    aggregate_id: order.aggregate_id,
    aggregate_type: ORDER_AGGREGATE_TYPE,
    expected_sequence: 4,
    payload: { shipment_id: shipmentId },
  };
  await runStep('MarkOrderShipped', ORDER_AGGREGATE_TYPE, order.aggregate_id, markShippedCmd);

  for (const item of order.items) {
    const deductCmd: DeductInventoryCommand = {
      command_id: crypto.randomUUID(),
      request_id: crypto.randomUUID(),
      correlation_id: correlationId,
      causation_id: causationId,
      actor_id: actorId,
      timeline_id: timelineId,
      aggregate_id: item.sku,
      aggregate_type: INVENTORY_AGGREGATE_TYPE,
      expected_sequence: 2,
      payload: {
        order_id: order.aggregate_id,
        quantity: item.quantity,
      },
    };
    await runStep(`DeductInventory_${item.sku}`, INVENTORY_AGGREGATE_TYPE, item.sku, deductCmd);
  }

  return {
    correlationId,
    timelineId,
    orderId: order.aggregate_id,
    status: 'COMPLETED',
    steps,
    compensations,
  };
}
