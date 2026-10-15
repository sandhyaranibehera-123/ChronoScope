import type { DomainEvent } from '@chronoscope/domain';

export interface ForkBaseOrderSummary {
  readonly status: string;
  readonly items: Array<{ sku: string; quantity: number; amountMinor: number }>;
  readonly totalAmountMinor: number;
  readonly currency: string;
}

export interface IForkBaseStateResolver {
  resolveForkBaseState(
    timelineId: string,
    aggregateId: string,
  ): Promise<ForkBaseOrderSummary | null>;
}

export interface ITimelineHistoryReader {
  getTimeline(timelineId: string): Promise<{
    timelineId: string;
    parentTimelineId: string | null;
    forkPosition: number;
  } | null>;
  getEffectiveEvents(timelineId: string, aggregateId?: string): Promise<readonly DomainEvent[]>;
}

/**
 * Derives fork-base state for read models (Rule 13).
 *
 * "The first time the projection worker processes an event for a branch's (timeline_id, aggregate_id) pair,
 * it must derive the same fork-base state from MySQL's ancestor history (the same EffectiveHistory logic,
 * not a Mongo-side shortcut) before folding in the branch-local event."
 */
export class ForkBaseStateResolver implements IForkBaseStateResolver {
  constructor(private readonly historyReader: ITimelineHistoryReader) {}

  public async resolveForkBaseState(
    timelineId: string,
    aggregateId: string,
  ): Promise<ForkBaseOrderSummary | null> {
    const timeline = await this.historyReader.getTimeline(timelineId);
    if (!timeline || !timeline.parentTimelineId || timeline.forkPosition <= 0) {
      return null;
    }

    // Load effective events from parent ancestor up to forkPosition
    const events = await this.historyReader.getEffectiveEvents(
      timeline.parentTimelineId,
      aggregateId,
    );

    const eligibleEvents = events.filter(
      (e) => (e.timeline_position ?? 0) <= timeline.forkPosition,
    );

    if (eligibleEvents.length === 0) {
      return null;
    }

    let status = 'CREATED';
    const items: Array<{ sku: string; quantity: number; amountMinor: number }> = [];
    let totalAmountMinor = 0;
    let currency = 'INR';

    for (const event of eligibleEvents) {
      const payload = event.payload as Record<string, unknown>;
      if (event.event_type === 'OrderCreated') {
        status = 'CREATED';
        currency = String(payload['currency'] ?? payload['currency_id'] ?? 'INR');
      } else if (event.event_type === 'OrderItemAdded') {
        const itemObj = (payload['item'] ?? payload) as Record<string, unknown>;
        const sku = String(itemObj['sku'] ?? 'DEFAULT-SKU');
        const quantity = Number(itemObj['quantity'] ?? 1);
        const amountMinor = Number(
          itemObj['unitAmountMinor'] ?? itemObj['amountMinor'] ?? itemObj['unit_amount_minor'] ?? 0,
        );
        items.push({ sku, quantity, amountMinor });
        totalAmountMinor += amountMinor * quantity;
      } else if (event.event_type === 'OrderConfirmed') {
        status = 'CONFIRMED';
      } else if (event.event_type === 'OrderPaid') {
        status = 'PAID';
      } else if (event.event_type === 'OrderCancelled') {
        status = 'CANCELLED';
      }
    }

    return {
      status,
      items,
      totalAmountMinor,
      currency,
    };
  }
}
