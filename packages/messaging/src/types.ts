/**
 * Messaging Contracts — Kafka Event Backbone.
 * Governed by system-guarantees.md Rules 8, 10 and ADR-004.
 *
 * All domain events are keyed by partition key `${timelineId}:${aggregateId}`.
 */

export interface KafkaMessageEnvelope<T = unknown> {
  topic: string;
  key: string; // `${timelineId}:${aggregateId}`
  value: T;
  headers?: Record<string, string>;
  partition: number;
  offset: number;
  timestamp?: string;
}

export interface PublishResult {
  topic: string;
  partition: number;
  offset: number;
}

export interface IKafkaProducer {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(
    topic: string,
    key: string,
    value: unknown,
    headers?: Record<string, string>,
  ): Promise<PublishResult>;
}

export type MessageProcessor = (message: KafkaMessageEnvelope) => Promise<void>;

export interface IKafkaConsumer {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  subscribe(topics: string[], processor: MessageProcessor): Promise<void>;
  commitOffset(topic: string, partition: number, offset: number): Promise<void>;
}
