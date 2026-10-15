import amqp from 'amqplib';
import { createLogger } from '@chronoscope/observability';
import type {
  IRabbitMqProducer,
  IRabbitMqConsumer,
  RabbitMqDelivery,
  RabbitMqMessageHandler,
  RabbitMqMessage,
} from './types.js';

const logger = createLogger({ name: 'rabbitmq-client' });

export interface RabbitMqClientOptions {
  url?: string;
  prefetch?: number;
  dlxExchange?: string;
}

export class RabbitMqClient implements IRabbitMqProducer, IRabbitMqConsumer {
  private connection: amqp.ChannelModel | null = null;
  private channel: amqp.Channel | null = null;
  private readonly url: string;
  private readonly prefetch: number;
  private readonly dlxExchange: string;

  constructor(options?: RabbitMqClientOptions) {
    this.url = options?.url ?? process.env['RABBITMQ_URL'] ?? 'amqp://guest:guest@localhost:5672';
    this.prefetch = options?.prefetch ?? 10;
    this.dlxExchange = options?.dlxExchange ?? 'chronoscope.dlx';
  }

  public async connect(): Promise<void> {
    if (this.connection && this.channel) return;

    logger.info({ url: this.url }, 'Connecting to RabbitMQ...');
    this.connection = await amqp.connect(this.url);
    this.channel = await this.connection.createChannel();
    await this.channel.prefetch(this.prefetch);

    // Setup dead letter exchange
    await this.channel.assertExchange(this.dlxExchange, 'direct', { durable: true });
    logger.info('Connected to RabbitMQ successfully.');
  }

  public async disconnect(): Promise<void> {
    if (this.channel) {
      await this.channel.close();
      this.channel = null;
    }
    if (this.connection) {
      await this.connection.close();
      this.connection = null;
    }
  }

  private async assertWorkQueue(queue: string): Promise<void> {
    if (!this.channel) throw new Error('RabbitMQ channel not connected');

    const dlq = `${queue}.dlq`;
    await this.channel.assertQueue(dlq, { durable: true });
    await this.channel.bindQueue(dlq, this.dlxExchange, queue);

    await this.channel.assertQueue(queue, {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': this.dlxExchange,
        'x-dead-letter-routing-key': queue,
      },
    });
  }

  public async publish<T = unknown>(
    queue: string,
    payload: T,
    headers: Record<string, string> = {},
  ): Promise<boolean> {
    if (!this.channel) {
      await this.connect();
    }
    await this.assertWorkQueue(queue);

    const content = Buffer.from(JSON.stringify(payload));
    const publishOptions: amqp.Options.Publish = {
      persistent: true,
      headers,
      timestamp: Date.now(),
    };
    const messageId = headers['jobId'] ?? headers['jobOutboxId'];
    if (messageId) {
      publishOptions.messageId = messageId;
    }
    return this.channel!.sendToQueue(queue, content, publishOptions);
  }

  public async consume<T = unknown>(
    queue: string,
    handler: RabbitMqMessageHandler<T>,
  ): Promise<void> {
    if (!this.channel) {
      await this.connect();
    }
    await this.assertWorkQueue(queue);

    await this.channel!.consume(queue, async (msg: amqp.ConsumeMessage | null) => {
      if (!msg) return;

      const rawPayload = JSON.parse(msg.content.toString('utf-8')) as T;
      const attemptCount = Number(msg.properties.headers?.['attemptCount'] ?? 1);

      const message: RabbitMqMessage<T> = {
        id: msg.properties.messageId ?? msg.fields.deliveryTag.toString(),
        queue,
        payload: rawPayload,
        attemptCount,
        headers: (msg.properties.headers as Record<string, string>) ?? {},
        timestamp: new Date(msg.properties.timestamp ?? Date.now()).toISOString(),
      };

      const delivery: RabbitMqDelivery<T> = {
        message,
        ack: async () => {
          this.channel?.ack(msg);
        },
        nack: async (requeue: boolean = true) => {
          this.channel?.nack(msg, false, requeue);
        },
        reject: async () => {
          // Reject without requeue sends message to DLX
          this.channel?.reject(msg, false);
        },
      };

      try {
        await handler(delivery);
      } catch (err) {
        logger.error({ err, messageId: message.id }, 'Unhandled error in RabbitMQ message handler');
        // Default to nack with requeue if unhandled error
        this.channel?.nack(msg, false, true);
      }
    });
  }
}
