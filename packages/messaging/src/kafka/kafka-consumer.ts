import { Kafka, type Consumer } from 'kafkajs';
import type { IKafkaConsumer, MessageProcessor } from '../types.js';

export interface KafkaConsumerConfig {
  brokers?: string[];
  clientId?: string;
  groupId?: string;
}

export class KafkaJsConsumer implements IKafkaConsumer {
  private readonly kafka: Kafka;
  private readonly consumer: Consumer;
  private isConnected = false;

  constructor(config?: KafkaConsumerConfig) {
    const brokers =
      config?.brokers ??
      (process.env['KAFKA_BROKERS'] ? process.env['KAFKA_BROKERS'].split(',') : ['localhost:9092']);
    const clientId = config?.clientId ?? process.env['KAFKA_CLIENT_ID'] ?? 'chronoscope-consumer';
    const groupId =
      config?.groupId ?? process.env['KAFKA_GROUP_ID'] ?? 'chronoscope-projection-group';

    this.kafka = new Kafka({
      clientId,
      brokers,
    });

    this.consumer = this.kafka.consumer({
      groupId,
    });
  }

  public async connect(): Promise<void> {
    if (!this.isConnected) {
      await this.consumer.connect();
      this.isConnected = true;
    }
  }

  public async disconnect(): Promise<void> {
    if (this.isConnected) {
      await this.consumer.disconnect();
      this.isConnected = false;
    }
  }

  public async subscribe(topics: string[], processor: MessageProcessor): Promise<void> {
    if (!this.isConnected) {
      await this.connect();
    }

    for (const topic of topics) {
      await this.consumer.subscribe({ topic, fromBeginning: false });
    }

    await this.consumer.run({
      autoCommit: false,
      eachMessage: async ({ topic, partition, message }) => {
        const offset = Number(message.offset);
        const key = message.key ? message.key.toString('utf-8') : '';
        const valueRaw = message.value ? message.value.toString('utf-8') : '{}';

        let parsedValue: unknown;
        try {
          parsedValue = JSON.parse(valueRaw);
        } catch {
          parsedValue = valueRaw;
        }

        const headers: Record<string, string> = {};
        if (message.headers) {
          for (const [k, v] of Object.entries(message.headers)) {
            if (v !== undefined) {
              headers[k] = v.toString();
            }
          }
        }

        await processor({
          topic,
          partition,
          offset,
          key,
          value: parsedValue,
          headers,
          timestamp: message.timestamp,
        });
      },
    });
  }

  public async commitOffset(topic: string, partition: number, offset: number): Promise<void> {
    // Note: Kafka consumer offset commits conventionally indicate the NEXT offset to read (offset + 1)
    await this.consumer.commitOffsets([
      {
        topic,
        partition,
        offset: String(offset + 1),
      },
    ]);
  }
}
