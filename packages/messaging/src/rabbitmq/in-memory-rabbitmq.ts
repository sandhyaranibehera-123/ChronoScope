import { randomUUID } from 'node:crypto';
import type {
  IRabbitMqProducer,
  IRabbitMqConsumer,
  RabbitMqMessage,
  RabbitMqDelivery,
  RabbitMqMessageHandler,
} from './types.js';

export class InMemoryRabbitMqBus implements IRabbitMqProducer, IRabbitMqConsumer {
  private readonly queues = new Map<string, RabbitMqMessage[]>();
  private readonly dlqs = new Map<string, RabbitMqMessage[]>();
  private readonly handlers = new Map<string, RabbitMqMessageHandler[]>();
  private readonly inFlight = new Map<string, RabbitMqMessage>();

  public async connect(): Promise<void> {}
  public async disconnect(): Promise<void> {}

  public async publish<T = unknown>(
    queue: string,
    payload: T,
    headers: Record<string, string> = {},
  ): Promise<boolean> {
    const id = headers['jobId'] ?? headers['jobOutboxId'] ?? randomUUID();
    const msg: RabbitMqMessage<T> = {
      id,
      queue,
      payload,
      attemptCount: Number(headers['attemptCount'] ?? 1),
      headers,
      timestamp: new Date().toISOString(),
    };

    if (!this.queues.has(queue)) {
      this.queues.set(queue, []);
    }
    this.queues.get(queue)!.push(msg as RabbitMqMessage);

    // If consumer registered, trigger delivery asynchronously
    this.dispatchNext(queue);
    return true;
  }

  public async consume<T = unknown>(
    queue: string,
    handler: RabbitMqMessageHandler<T>,
  ): Promise<void> {
    if (!this.handlers.has(queue)) {
      this.handlers.set(queue, []);
    }
    this.handlers.get(queue)!.push(handler as RabbitMqMessageHandler);

    // Process any backlog in the queue
    this.dispatchNext(queue);
  }

  private dispatchNext(queue: string): void {
    const handlers = this.handlers.get(queue);
    const msgs = this.queues.get(queue);

    if (!handlers || handlers.length === 0 || !msgs || msgs.length === 0) {
      return;
    }

    const handler = handlers[0]!;
    const msg = msgs.shift()!;
    this.inFlight.set(msg.id, msg);

    const delivery: RabbitMqDelivery = {
      message: msg,
      ack: async () => {
        this.inFlight.delete(msg.id);
      },
      nack: async (requeue: boolean = true) => {
        this.inFlight.delete(msg.id);
        if (requeue) {
          msg.attemptCount += 1;
          this.queues.get(queue)!.unshift(msg);
        } else {
          this.sendToDlq(queue, msg);
        }
      },
      reject: async () => {
        this.inFlight.delete(msg.id);
        this.sendToDlq(queue, msg);
      },
    };

    // Dispatch asynchronously
    queueMicrotask(async () => {
      try {
        await handler(delivery);
      } catch {
        // Auto nack with requeue on error
        await delivery.nack(true);
      }
    });
  }

  private sendToDlq(queue: string, msg: RabbitMqMessage): void {
    const dlqKey = `${queue}.dlq`;
    if (!this.dlqs.has(dlqKey)) {
      this.dlqs.set(dlqKey, []);
    }
    this.dlqs.get(dlqKey)!.push(msg);
  }

  public getQueueMessages(queue: string): RabbitMqMessage[] {
    return [...(this.queues.get(queue) ?? [])];
  }

  public getDlqMessages(queue: string): RabbitMqMessage[] {
    return [...(this.dlqs.get(`${queue}.dlq`) ?? [])];
  }

  /**
   * Simulates a worker crashing mid-processing:
   * The message was in-flight, never acked, and RabbitMQ redelivers it!
   */
  public async simulateCrashRedelivery(messageId: string): Promise<boolean> {
    const msg = this.inFlight.get(messageId);
    if (!msg) return false;

    this.inFlight.delete(messageId);
    msg.attemptCount += 1;
    this.queues.get(msg.queue)!.unshift(msg);
    this.dispatchNext(msg.queue);
    return true;
  }

  public clear(): void {
    this.queues.clear();
    this.dlqs.clear();
    this.handlers.clear();
    this.inFlight.clear();
  }
}
