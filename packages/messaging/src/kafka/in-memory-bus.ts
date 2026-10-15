import type {
  IKafkaProducer,
  IKafkaConsumer,
  KafkaMessageEnvelope,
  MessageProcessor,
  PublishResult,
} from '../types.js';

interface PartitionQueue {
  messages: KafkaMessageEnvelope[];
  nextOffset: number;
}

/**
 * Deterministic partition index calculation from partition key.
 */
function hashPartitionKey(key: string, numPartitions: number): number {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash << 5) - hash + key.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % numPartitions;
}

export class InMemoryKafkaBus implements IKafkaProducer, IKafkaConsumer {
  private readonly topics = new Map<string, Map<number, PartitionQueue>>();
  private readonly committedOffsets = new Map<string, number>(); // `${topic}:${partition}` -> committed offset
  private readonly numPartitions: number;
  private processor: MessageProcessor | null = null;
  private subscribedTopics = new Set<string>();

  constructor(numPartitions: number = 4) {
    this.numPartitions = numPartitions;
  }

  private getPartitionQueue(topic: string, partition: number): PartitionQueue {
    let topicPartitions = this.topics.get(topic);
    if (!topicPartitions) {
      topicPartitions = new Map<number, PartitionQueue>();
      for (let p = 0; p < this.numPartitions; p++) {
        topicPartitions.set(p, { messages: [], nextOffset: 0 });
      }
      this.topics.set(topic, topicPartitions);
    }
    return topicPartitions.get(partition)!;
  }

  public async connect(): Promise<void> {}
  public async disconnect(): Promise<void> {}

  public async send(
    topic: string,
    key: string,
    value: unknown,
    headers?: Record<string, string>,
  ): Promise<PublishResult> {
    const partition = hashPartitionKey(key, this.numPartitions);
    const queue = this.getPartitionQueue(topic, partition);
    const offset = queue.nextOffset++;

    const envelope: KafkaMessageEnvelope = {
      topic,
      key,
      value,
      headers: headers ? { ...headers } : {},
      partition,
      offset,
      timestamp: new Date().toISOString(),
    };

    queue.messages.push(envelope);

    // If subscribed, deliver to processor
    if (this.subscribedTopics.has(topic) && this.processor) {
      // Deliver asynchronously
      queueMicrotask(async () => {
        if (this.processor) {
          try {
            await this.processor(envelope);
          } catch {
            // Processing failure in bus
          }
        }
      });
    }

    return { topic, partition, offset };
  }

  public async subscribe(topics: string[], processor: MessageProcessor): Promise<void> {
    this.processor = processor;
    for (const t of topics) {
      this.subscribedTopics.add(t);
    }
  }

  public async commitOffset(topic: string, partition: number, offset: number): Promise<void> {
    // Consumer commit convention: stores offset + 1 as the NEXT offset to read
    this.committedOffsets.set(`${topic}:${partition}`, offset + 1);
  }

  public getCommittedOffset(topic: string, partition: number): number | null {
    return this.committedOffsets.get(`${topic}:${partition}`) ?? null;
  }

  /**
   * Manually redelivers an existing message or batch to test redelivery idempotency.
   */
  public async deliverMessage(message: KafkaMessageEnvelope): Promise<void> {
    if (!this.processor) {
      throw new Error('No processor subscribed to InMemoryKafkaBus');
    }
    await this.processor(message);
  }

  public getMessages(topic: string, partition: number): KafkaMessageEnvelope[] {
    const queue = this.getPartitionQueue(topic, partition);
    return [...queue.messages];
  }

  public clear(): void {
    this.topics.clear();
    this.committedOffsets.clear();
    this.subscribedTopics.clear();
    this.processor = null;
  }
}
