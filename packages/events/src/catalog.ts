/**
 * Event Catalog and Schema Version Registry — system-guarantees.md rules 3 & 4:
 * "Every event carries schema_version; upcasters are mandatory before replaying historical payloads.
 * application_version, event_schema_version, and domain_logic_version are tracked as three separate axes."
 */

export interface EventDefinition {
  readonly eventType: string;
  readonly aggregateType: string;
  readonly currentSchemaVersion: number;
  readonly description: string;
}

export const DOMAIN_EVENT_CATALOG: Readonly<Record<string, EventDefinition>> = Object.freeze({
  // Order aggregate events
  OrderCreated: {
    eventType: 'OrderCreated',
    aggregateType: 'Order',
    currentSchemaVersion: 1,
    description: 'Emitted when a new order is initialized with customer and currency',
  },
  OrderConfirmed: {
    eventType: 'OrderConfirmed',
    aggregateType: 'Order',
    currentSchemaVersion: 1,
    description: 'Emitted when items are locked and total amount is confirmed',
  },
  OrderPaid: {
    eventType: 'OrderPaid',
    aggregateType: 'Order',
    currentSchemaVersion: 1,
    description: 'Emitted when payment for order is verified',
  },
  OrderAllocated: {
    eventType: 'OrderAllocated',
    aggregateType: 'Order',
    currentSchemaVersion: 1,
    description: 'Emitted when inventory is reserved for the order',
  },
  OrderShipped: {
    eventType: 'OrderShipped',
    aggregateType: 'Order',
    currentSchemaVersion: 1,
    description: 'Emitted when order items are physically dispatched',
  },
  OrderCancelled: {
    eventType: 'OrderCancelled',
    aggregateType: 'Order',
    currentSchemaVersion: 1,
    description: 'Emitted when order is cancelled before fulfillment',
  },

  // Payment aggregate events
  PaymentAuthorized: {
    eventType: 'PaymentAuthorized',
    aggregateType: 'Payment',
    currentSchemaVersion: 1,
    description: 'Emitted when customer payment method is authorized',
  },
  PaymentCaptured: {
    eventType: 'PaymentCaptured',
    aggregateType: 'Payment',
    currentSchemaVersion: 1,
    description: 'Emitted when authorized funds are captured',
  },
  PaymentFailed: {
    eventType: 'PaymentFailed',
    aggregateType: 'Payment',
    currentSchemaVersion: 1,
    description: 'Emitted when payment attempt fails or is declined',
  },
  PaymentRefunded: {
    eventType: 'PaymentRefunded',
    aggregateType: 'Payment',
    currentSchemaVersion: 1,
    description: 'Emitted when captured payment is refunded (compensation)',
  },

  // Inventory aggregate events
  InventoryStockReserved: {
    eventType: 'InventoryStockReserved',
    aggregateType: 'Inventory',
    currentSchemaVersion: 1,
    description: 'Emitted when available stock is allocated to an order',
  },
  InventoryStockReleased: {
    eventType: 'InventoryStockReleased',
    aggregateType: 'Inventory',
    currentSchemaVersion: 1,
    description: 'Emitted when reserved stock is released back (compensation)',
  },
  InventoryStockDeducted: {
    eventType: 'InventoryStockDeducted',
    aggregateType: 'Inventory',
    currentSchemaVersion: 1,
    description: 'Emitted when reserved stock is permanently deducted on shipment',
  },

  // Shipment aggregate events
  ShipmentCreated: {
    eventType: 'ShipmentCreated',
    aggregateType: 'Shipment',
    currentSchemaVersion: 1,
    description: 'Emitted when shipment booking is created',
  },
  ShipmentDispatched: {
    eventType: 'ShipmentDispatched',
    aggregateType: 'Shipment',
    currentSchemaVersion: 1,
    description: 'Emitted when carrier picks up shipment with tracking number',
  },
  ShipmentDelivered: {
    eventType: 'ShipmentDelivered',
    aggregateType: 'Shipment',
    currentSchemaVersion: 1,
    description: 'Emitted when carrier confirms delivery to recipient',
  },
  ShipmentCancelled: {
    eventType: 'ShipmentCancelled',
    aggregateType: 'Shipment',
    currentSchemaVersion: 1,
    description: 'Emitted when undelivered shipment is cancelled (compensation)',
  },
});

export function getEventDefinition(eventType: string): EventDefinition | undefined {
  return DOMAIN_EVENT_CATALOG[eventType];
}

export function isKnownEventType(eventType: string): boolean {
  return eventType in DOMAIN_EVENT_CATALOG;
}
