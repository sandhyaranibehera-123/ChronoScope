import { Kafka, type Producer, type RecordMetadata } from 'kafkajs';
import type { IKafkaProducer, PublishResult } from '../types.js';

export interface KafkaProducerConfig {
  brokers?: string[];
  clientId?: string;
}

export class KafkaJsProducer implements IKafkaProducer {
  private readonly kafka: Kafka;
  private readonly producer: Producer;
  private isConnected = false;

  constructor(config?: KafkaProducerConfig) {
    const brokers =
      config?.brokers ??
      (process.env['KAFKA_BROKERS'] ? process.env['KAFKA_BROKERS'].split(',') : ['localhost:9092']);
    const clientId = config?.clientId ?? process.env['KAFKA_CLIENT_ID'] ?? 'chronoscope-producer';

    this.kafka = new Kafka({
      clientId,
      brokers,
    });

    this.producer = this.kafka.producer({
      allowAutoTopicCreation: true,
    });
  }

  public async connect(): Promise<void> {
    if (!this.isConnected) {
      await this.producer.connect();
      this.isConnected = true;
    }
  }

  public async disconnect(): Promise<void> {
    if (this.isConnected) {
      await this.producer.disconnect();
      this.isConnected = false;
    }
  }

  public async send(
    topic: string,
    key: string,
    value: unknown,
    headers?: Record<string, string>,
  ): Promise<PublishResult> {
    if (!this.isConnected) {
      await this.connect();
    }

    const payloadString = typeof value === 'string' ? value : JSON.stringify(value);

    const recordHeaders: Record<string, string> = {};
    if (headers) {
      for (const [k, v] of Object.entries(headers)) {
        recordHeaders[k] = String(v);
      }
    }

    const [metadata]: RecordMetadata[] = await this.producer.send({
      topic,
      messages: [
        {
          key,
          value: payloadString,
          headers: recordHeaders,
        },
      ],
    });

    return {
      topic: metadata?.topicName ?? topic,
      partition: metadata?.partition ?? 0,
      offset: Number(metadata?.baseOffset ?? 0),
    };
  }
}
