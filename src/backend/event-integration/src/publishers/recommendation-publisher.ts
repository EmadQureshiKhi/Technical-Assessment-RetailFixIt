/**
 * Recommendation Publisher
 *
 * Publishes VendorRecommendationGenerated events to Azure Event Grid.
 * Implements correlation ID propagation for end-to-end tracing.
 *
 * @requirement 4.2 - Publish VendorRecommendationGenerated events
 * @requirement 4.6 - Correlation ID propagation
 * @property Property 9: Correlation ID Propagation
 */

import {
  type VendorRecommendationGeneratedEvent,
  type VendorRecommendation,
  createEventId,
} from '@retailfixit/shared';

/**
 * Result of publishing a recommendation event
 */
export interface PublishResult {
  success: boolean;
  eventId: string;
  correlationId: string;
  error?: string;
  publishedAt: Date;
}

/**
 * Interface for event transport
 * Implementations can use Azure Event Grid, Service Bus, or in-memory for testing
 */
export interface EventTransport {
  /**
   * Publish an event to the transport
   * @param event - The event to publish
   * @returns Promise resolving when published
   */
  publish(event: VendorRecommendationGeneratedEvent): Promise<void>;
}

/**
 * In-memory event transport for testing
 */
export class InMemoryEventTransport implements EventTransport {
  private events: VendorRecommendationGeneratedEvent[] = [];

  async publish(event: VendorRecommendationGeneratedEvent): Promise<void> {
    this.events.push(event);
  }

  /** Get all published events (for testing) */
  getEvents(): VendorRecommendationGeneratedEvent[] {
    return [...this.events];
  }

  /** Get events by correlation ID (for testing) */
  getEventsByCorrelationId(correlationId: string): VendorRecommendationGeneratedEvent[] {
    return this.events.filter((e) => e.correlationId === correlationId);
  }

  /** Clear all events (for testing) */
  clear(): void {
    this.events = [];
  }

  /** Get event count (for testing) */
  count(): number {
    return this.events.length;
  }
}

/**
 * Configuration for the recommendation publisher
 */
export interface RecommendationPublisherConfig {
  /** Model version to include in events */
  modelVersion: string;
  /** Default automation level */
  defaultAutomationLevel: 'auto' | 'advisory' | 'manual';
  /** Confidence threshold for advisory mode */
  advisoryConfidenceThreshold: number;
}

/**
 * Default publisher configuration
 */
export const DEFAULT_PUBLISHER_CONFIG: RecommendationPublisherConfig = {
  modelVersion: '1.0.0',
  defaultAutomationLevel: 'advisory',
  advisoryConfidenceThreshold: 0.7,
};

/**
 * Input for publishing a recommendation
 */
export interface PublishRecommendationInput {
  jobId: string;
  correlationId: string;
  recommendations: VendorRecommendation[];
  processingTimeMs: number;
  degradedMode: boolean;
  modelVersion?: string;
  automationLevel?: 'auto' | 'advisory' | 'manual';
}

/**
 * Recommendation Publisher
 *
 * Publishes VendorRecommendationGenerated events with correlation ID propagation.
 *
 * @requirement 4.2 - Publish VendorRecommendationGenerated events
 * @requirement 4.6 - Correlation ID propagation
 * @property Property 9: Correlation ID Propagation
 */
export class RecommendationPublisher {
  private transport: EventTransport;
  private config: RecommendationPublisherConfig;

  constructor(
    transport: EventTransport,
    config: Partial<RecommendationPublisherConfig> = {}
  ) {
    this.transport = transport;
    this.config = { ...DEFAULT_PUBLISHER_CONFIG, ...config };
  }

  /**
   * Publish a VendorRecommendationGenerated event
   *
   * @param input - The recommendation data to publish
   * @returns Publish result with event details
   *
   * @requirement 4.2 - Publish VendorRecommendationGenerated events
   * @requirement 4.6 - Include correlation ID propagation
   * @property Property 9: Correlation ID Propagation
   */
  async publish(input: PublishRecommendationInput): Promise<PublishResult> {
    const eventId = createEventId();
    const timestamp = new Date();

    // Determine automation level based on confidence
    let automationLevel = input.automationLevel ?? this.config.defaultAutomationLevel;

    // If any recommendation has low confidence, switch to advisory
    if (automationLevel === 'auto') {
      const hasLowConfidence = input.recommendations.some(
        (r) => r.confidence < this.config.advisoryConfidenceThreshold
      );
      if (hasLowConfidence || input.degradedMode) {
        automationLevel = 'advisory';
      }
    }

    // Build the event with correlation ID propagation
    const event: VendorRecommendationGeneratedEvent = {
      eventType: 'VendorRecommendationGenerated',
      eventId,
      timestamp,
      correlationId: input.correlationId, // Propagate correlation ID
      data: {
        jobId: input.jobId,
        recommendations: input.recommendations,
        modelVersion: input.modelVersion ?? this.config.modelVersion,
        processingTimeMs: input.processingTimeMs,
        automationLevel,
        degradedMode: input.degradedMode,
      },
    };

    try {
      await this.transport.publish(event);

      return {
        success: true,
        eventId,
        correlationId: input.correlationId,
        publishedAt: timestamp,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      return {
        success: false,
        eventId,
        correlationId: input.correlationId,
        error: `Failed to publish event: ${errorMessage}`,
        publishedAt: timestamp,
      };
    }
  }

  /**
   * Publish multiple recommendation events (batch)
   *
   * @param inputs - Array of recommendation data to publish
   * @returns Array of publish results
   */
  async publishBatch(inputs: PublishRecommendationInput[]): Promise<PublishResult[]> {
    const results: PublishResult[] = [];

    for (const input of inputs) {
      const result = await this.publish(input);
      results.push(result);
    }

    return results;
  }

  /**
   * Get the current model version
   */
  getModelVersion(): string {
    return this.config.modelVersion;
  }

  /**
   * Update the model version
   */
  setModelVersion(version: string): void {
    this.config.modelVersion = version;
  }
}

/**
 * Creates a VendorRecommendationGenerated event
 * Utility function for creating events without a publisher
 *
 * @property Property 9: Correlation ID Propagation
 */
export function createRecommendationEvent(
  input: PublishRecommendationInput
): VendorRecommendationGeneratedEvent {
  return {
    eventType: 'VendorRecommendationGenerated',
    eventId: createEventId(),
    timestamp: new Date(),
    correlationId: input.correlationId,
    data: {
      jobId: input.jobId,
      recommendations: input.recommendations,
      modelVersion: input.modelVersion ?? DEFAULT_PUBLISHER_CONFIG.modelVersion,
      processingTimeMs: input.processingTimeMs,
      automationLevel: input.automationLevel ?? DEFAULT_PUBLISHER_CONFIG.defaultAutomationLevel,
      degradedMode: input.degradedMode,
    },
  };
}
