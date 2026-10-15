/**
 * RabbitMQ contracts and interfaces — system-guarantees.md Rules 8, 10 and ADR-005.
 * RabbitMQ is the work queue delivering jobs; MySQL holds authoritative job state.
 */

export interface RabbitMqMessage<T = unknown> {
  id: string;
  queue: string;
  payload: T;
  attemptCount: number;
  headers?: Record<string, string>;
  timestamp?: string;
}

export interface RabbitMqDelivery<T = unknown> {
  message: RabbitMqMessage<T>;
  ack(): Promise<void>;
  nack(requeue?: boolean): Promise<void>;
  reject(): Promise<void>;
}

export type RabbitMqMessageHandler<T = unknown> = (delivery: RabbitMqDelivery<T>) => Promise<void>;

export interface IRabbitMqProducer {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  publish<T = unknown>(
    queue: string,
    payload: T,
    headers?: Record<string, string>,
  ): Promise<boolean>;
}

export interface IRabbitMqConsumer {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  consume<T = unknown>(queue: string, handler: RabbitMqMessageHandler<T>): Promise<void>;
}
