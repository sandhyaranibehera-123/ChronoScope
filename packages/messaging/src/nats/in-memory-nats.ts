import type { INatsClient, NatsMessage, NatsMessageHandler, NatsSubscription } from './types.js';

interface SubscriptionEntry {
  id: string;
  pattern: string;
  handler: NatsMessageHandler;
}

export function matchesNatsSubject(pattern: string, subject: string): boolean {
  if (pattern === subject) return true;
  const patternTokens = pattern.split('.');
  const subjectTokens = subject.split('.');

  for (let i = 0; i < patternTokens.length; i++) {
    const p = patternTokens[i];
    if (p === '>') {
      return i < subjectTokens.length;
    }
    if (i >= subjectTokens.length) {
      return false;
    }
    if (p !== '*' && p !== subjectTokens[i]) {
      return false;
    }
  }
  return patternTokens.length === subjectTokens.length;
}

export class InMemoryNatsClient implements INatsClient {
  private isConnected = false;
  private nextSubId = 1;
  private readonly subscriptions = new Map<string, SubscriptionEntry>();
  private readonly publishedHistory: NatsMessage[] = [];
  private packetLossFilter: ((subject: string) => boolean) | null = null;

  public async connect(): Promise<void> {
    this.isConnected = true;
  }

  public async disconnect(): Promise<void> {
    this.isConnected = false;
  }

  public async publish<T = unknown>(subject: string, data: T): Promise<void> {
    const message: NatsMessage<T> = {
      subject,
      data,
      timestamp: new Date().toISOString(),
    };

    this.publishedHistory.push(message as NatsMessage);

    // If packet loss filter matches, drop message without delivering to subscribers
    if (this.packetLossFilter && this.packetLossFilter(subject)) {
      return;
    }

    const matchingHandlers: NatsMessageHandler[] = [];
    for (const sub of this.subscriptions.values()) {
      if (matchesNatsSubject(sub.pattern, subject)) {
        matchingHandlers.push(sub.handler);
      }
    }

    // Dispatch concurrently to matching subscriptions
    await Promise.all(
      matchingHandlers.map(async (handler) => {
        try {
          await handler(message);
        } catch {
          // Unhandled handler errors do not break NATS publisher
        }
      }),
    );
  }

  public subscribe<T = unknown>(subject: string, handler: NatsMessageHandler<T>): NatsSubscription {
    const subId = `sub-${this.nextSubId++}`;
    const entry: SubscriptionEntry = {
      id: subId,
      pattern: subject,
      handler: handler as NatsMessageHandler,
    };

    this.subscriptions.set(subId, entry);

    return {
      subject,
      unsubscribe: () => {
        this.subscriptions.delete(subId);
      },
    };
  }

  // Test & Fault Injection Helpers
  public simulatePacketLoss(filter: (subject: string) => boolean): void {
    this.packetLossFilter = filter;
  }

  public dropAllPackets(): void {
    this.packetLossFilter = () => true;
  }

  public clearPacketLoss(): void {
    this.packetLossFilter = null;
  }

  public getPublishedMessages(subjectFilter?: string): NatsMessage[] {
    if (!subjectFilter) {
      return [...this.publishedHistory];
    }
    return this.publishedHistory.filter((m) => matchesNatsSubject(subjectFilter, m.subject));
  }

  public clearPublishedMessages(): void {
    this.publishedHistory.length = 0;
  }

  public clear(): void {
    this.subscriptions.clear();
    this.publishedHistory.length = 0;
    this.packetLossFilter = null;
  }
}
