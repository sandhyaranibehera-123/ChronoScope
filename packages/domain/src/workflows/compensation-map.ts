/**
 * Compensation Map — system-guarantees.md rule 15:
 * "One aggregate = one ordered event stream; compensation map specified,
 * PaymentRefunded/ShipmentCancelled built only when needed."
 *
 * Explicit mapping between forward actions and their corresponding
 * compensating actions across aggregates.
 */

export interface CompensationDefinition {
  readonly forwardAction: string;
  readonly targetAggregateType: string;
  readonly compensationAction: string;
  readonly compensationAggregateType: string;
  readonly description: string;
}

export const COMPENSATION_MAP: readonly CompensationDefinition[] = [
  {
    forwardAction: 'ReserveInventory',
    targetAggregateType: 'INVENTORY',
    compensationAction: 'ReleaseInventory',
    compensationAggregateType: 'INVENTORY',
    description: 'Releases previously reserved inventory units back to available stock.',
  },
  {
    forwardAction: 'CapturePayment',
    targetAggregateType: 'PAYMENT',
    compensationAction: 'RefundPayment',
    compensationAggregateType: 'PAYMENT',
    description: 'Issues a full or partial refund for a captured payment.',
  },
  {
    forwardAction: 'CreateShipment',
    targetAggregateType: 'SHIPMENT',
    compensationAction: 'CancelShipment',
    compensationAggregateType: 'SHIPMENT',
    description: 'Cancels an undelivered shipment manifest.',
  },
  {
    forwardAction: 'ConfirmOrder',
    targetAggregateType: 'ORDER',
    compensationAction: 'CancelOrder',
    compensationAggregateType: 'ORDER',
    description: 'Transitions order to CANCELLED state.',
  },
] as const;

export function getCompensationAction(forwardAction: string): CompensationDefinition | undefined {
  return COMPENSATION_MAP.find((entry) => entry.forwardAction === forwardAction);
}
