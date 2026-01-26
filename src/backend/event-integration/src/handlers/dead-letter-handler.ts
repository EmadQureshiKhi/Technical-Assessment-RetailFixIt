/**
 * Dead-Letter Handler
 *
 * Processes failed events from the dead-letter queue.
 * Implements retry logic with exponential backoff.
 *
 * @requirement 4.3 - Dead-letter handling for failed event processing
 * @requirement 4.4 - Event replay for reprocessing failed recommendations
 * @requirement 13.5 - Retry logic with exponential backoff
 * @property Property 26: Retry with Exponential Backoff
 */

import { type JobCreatedEvent, safeValidateJobCreatedEvent } from '@retailfixit/shared';

/**
 * Dead-letter message metadata
 */
export interface DeadLetterMetadata {
  originalEventId: string;
  correlationId: string;
  failureReason: string;
  failedAt: Date;
  retryCount: number;
  lastRetryAt?: Date;
  nextRetryAt?: Date;
}

/**
 * Dead-letter message wrapping the original event
 */
export interface DeadLetterMessage {
  metadata: DeadLetterMetadata;
  originalEvent: unknown;
}

/**
 * Result of processing a dead-letter message
 */
export interface DeadLetterHandlerResult {
  success: boolean;
  eventId: string;
  correlationId: string;
  action: 'reprocessed' | 'scheduled_retry' | 'abandoned' | 'invalid';
  retryCount: number;
  nextRetryAt?: Date;
  error?: string;
}

/**
 * Configuration for exponential backoff
 *
 * @property Property 26: Retry with Exponential Backoff
 */
export interface ExponentialBackoffConfig {
  /** Initial delay in milliseconds (default: 1000ms = 1s) */
  initialDelayMs: number;
  /** Maximum delay in milliseconds (default: 60000ms = 60s) */
  maxDelayMs: number;
  /** Multiplier for each retry (default: 2) */
  multiplier: number;
  /** Maximum number of retries before abandoning (default: 5) */
  maxRetries: number;
  /** Jitter factor (0-1) to add randomness (default: 0.1) */
  jitterFactor: number;
}

/**
 * Default exponential backoff configuration
 * Delays: 1s, 2s, 4s, 8s, 16s (capped at maxDelayMs)
 */
export const DEFAULT_BACKOFF_CONFIG: ExponentialBackoffConfig = {
  initialDelayMs: 1000,
  maxDelayMs: 60000,
  multiplier: 2,
  maxRetries: 5,
  jitterFactor: 0.1,
};

/**
 * Calculates the delay for the next retry using exponential backoff
 *
 * @param retryCount - Current retry count (0-based)
 * @param config - Backoff configuration
 * @returns Delay in milliseconds
 *
 * @property Property 26: Retry with Exponential Backoff
 */
export function calculateBackoffDelay(
  retryCount: number,
  config: ExponentialBackoffConfig = DEFAULT_BACKOFF_CONFIG
): number {
  // Calculate base delay: initialDelay * multiplier^retryCount
  const baseDelay = config.initialDelayMs * Math.pow(config.multiplier, retryCount);

  // Cap at maximum delay
  const cappedDelay = Math.min(baseDelay, config.maxDelayMs);

  // Add jitter to prevent thundering herd
  const jitter = cappedDelay * config.jitterFactor * Math.random();

  return Math.floor(cappedDelay + jitter);
}

/**
 * Calculates the next retry time
 *
 * @param retryCount - Current retry count
 * @param config - Backoff configuration
 * @returns Date for next retry
 */
export function calculateNextRetryTime(
  retryCount: number,
  config: ExponentialBackoffConfig = DEFAULT_BACKOFF_CONFIG
): Date {
  const delayMs = calculateBackoffDelay(retryCount, config);
  return new Date(Date.now() + delayMs);
}

/**
 * Checks if a message should be retried based on retry count
 *
 * @param retryCount - Current retry count
 * @param config - Backoff configuration
 * @returns true if should retry, false if should abandon
 */
export function shouldRetry(
  retryCount: number,
  config: ExponentialBackoffConfig = DEFAULT_BACKOFF_CONFIG
): boolean {
  return retryCount < config.maxRetries;
}

/**
 * Interface for event reprocessor
 */
export interface EventReprocessor {
  /**
   * Reprocess a failed event
   * @param event - The validated event to reprocess
   * @returns Promise resolving when reprocessed
   */
  reprocess(event: JobCreatedEvent): Promise<void>;
}

/**
 * Interface for retry queue
 */
export interface RetryQueue {
  /**
   * Schedule a message for retry
   * @param message - The dead-letter message
   * @param retryAt - When to retry
   */
  scheduleRetry(message: DeadLetterMessage, retryAt: Date): Promise<void>;

  /**
   * Move a message to permanent failure storage
   * @param message - The dead-letter message
   * @param reason - Reason for abandonment
   */
  abandon(message: DeadLetterMessage, reason: string): Promise<void>;
}

/**
 * In-memory retry queue for testing
 */
export class InMemoryRetryQueue implements RetryQueue {
  private scheduledRetries: Array<{ message: DeadLetterMessage; retryAt: Date }> = [];
  private abandonedMessages: Array<{ message: DeadLetterMessage; reason: string }> = [];

  async scheduleRetry(message: DeadLetterMessage, retryAt: Date): Promise<void> {
    this.scheduledRetries.push({ message, retryAt });
  }

  async abandon(message: DeadLetterMessage, reason: string): Promise<void> {
    this.abandonedMessages.push({ message, reason });
  }

  /** Get scheduled retries (for testing) */
  getScheduledRetries(): Array<{ message: DeadLetterMessage; retryAt: Date }> {
    return [...this.scheduledRetries];
  }

  /** Get abandoned messages (for testing) */
  getAbandonedMessages(): Array<{ message: DeadLetterMessage; reason: string }> {
    return [...this.abandonedMessages];
  }

  /** Get messages due for retry (for testing) */
  getDueRetries(asOf: Date = new Date()): DeadLetterMessage[] {
    return this.scheduledRetries
      .filter((r) => r.retryAt <= asOf)
      .map((r) => r.message);
  }

  /** Clear all (for testing) */
  clear(): void {
    this.scheduledRetries = [];
    this.abandonedMessages = [];
  }
}

/**
 * Dead-Letter Handler
 *
 * Processes failed events from the dead-letter queue with retry logic.
 *
 * @requirement 4.3 - Dead-letter handling
 * @requirement 4.4 - Event replay
 * @requirement 13.5 - Retry with exponential backoff
 * @property Property 26: Retry with Exponential Backoff
 */
export class DeadLetterHandler {
  private reprocessor: EventReprocessor;
  private retryQueue: RetryQueue;
  private backoffConfig: ExponentialBackoffConfig;

  constructor(
    reprocessor: EventReprocessor,
    retryQueue: RetryQueue,
    backoffConfig: Partial<ExponentialBackoffConfig> = {}
  ) {
    this.reprocessor = reprocessor;
    this.retryQueue = retryQueue;
    this.backoffConfig = { ...DEFAULT_BACKOFF_CONFIG, ...backoffConfig };
  }

  /**
   * Handle a dead-letter message
   *
   * @param message - The dead-letter message to process
   * @returns Handler result with action taken
   *
   * @requirement 4.3 - Process failed events from dead-letter queue
   * @requirement 13.5 - Implement retry logic with exponential backoff
   * @property Property 26: Retry with Exponential Backoff
   */
  async handle(message: DeadLetterMessage): Promise<DeadLetterHandlerResult> {
    const { metadata, originalEvent } = message;

    // Validate the original event
    const validationResult = safeValidateJobCreatedEvent(originalEvent);

    if (!validationResult.success) {
      // Invalid event - cannot retry, abandon immediately
      await this.retryQueue.abandon(message, 'Invalid event format');

      return {
        success: false,
        eventId: metadata.originalEventId,
        correlationId: metadata.correlationId,
        action: 'invalid',
        retryCount: metadata.retryCount,
        error: 'Event validation failed - cannot retry',
      };
    }

    const event = validationResult.data;

    // Check if we should retry
    if (!shouldRetry(metadata.retryCount, this.backoffConfig)) {
      // Max retries exceeded - abandon
      await this.retryQueue.abandon(
        message,
        `Max retries (${this.backoffConfig.maxRetries}) exceeded`
      );

      return {
        success: false,
        eventId: metadata.originalEventId,
        correlationId: metadata.correlationId,
        action: 'abandoned',
        retryCount: metadata.retryCount,
        error: `Abandoned after ${metadata.retryCount} retries`,
      };
    }

    try {
      // Attempt to reprocess the event
      await this.reprocessor.reprocess(event);

      return {
        success: true,
        eventId: metadata.originalEventId,
        correlationId: metadata.correlationId,
        action: 'reprocessed',
        retryCount: metadata.retryCount,
      };
    } catch (error) {
      // Reprocessing failed - schedule retry with exponential backoff
      const nextRetryAt = calculateNextRetryTime(metadata.retryCount, this.backoffConfig);

      const updatedMessage: DeadLetterMessage = {
        metadata: {
          ...metadata,
          retryCount: metadata.retryCount + 1,
          lastRetryAt: new Date(),
          nextRetryAt,
          failureReason: error instanceof Error ? error.message : 'Unknown error',
        },
        originalEvent,
      };

      await this.retryQueue.scheduleRetry(updatedMessage, nextRetryAt);

      return {
        success: false,
        eventId: metadata.originalEventId,
        correlationId: metadata.correlationId,
        action: 'scheduled_retry',
        retryCount: metadata.retryCount + 1,
        nextRetryAt,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Process multiple dead-letter messages
   *
   * @param messages - Array of dead-letter messages
   * @returns Array of handler results
   */
  async handleBatch(messages: DeadLetterMessage[]): Promise<DeadLetterHandlerResult[]> {
    const results: DeadLetterHandlerResult[] = [];

    for (const message of messages) {
      const result = await this.handle(message);
      results.push(result);
    }

    return results;
  }

  /**
   * Get the current backoff configuration
   */
  getBackoffConfig(): ExponentialBackoffConfig {
    return { ...this.backoffConfig };
  }
}

/**
 * Creates a dead-letter message from a failed event
 *
 * @param originalEvent - The original event that failed
 * @param eventId - The event ID
 * @param correlationId - The correlation ID
 * @param failureReason - Reason for failure
 * @returns DeadLetterMessage
 */
export function createDeadLetterMessage(
  originalEvent: unknown,
  eventId: string,
  correlationId: string,
  failureReason: string
): DeadLetterMessage {
  return {
    metadata: {
      originalEventId: eventId,
      correlationId,
      failureReason,
      failedAt: new Date(),
      retryCount: 0,
    },
    originalEvent,
  };
}

/**
 * Calculates all retry delays for visualization/debugging
 *
 * @param config - Backoff configuration
 * @returns Array of delays in milliseconds for each retry
 */
export function getRetrySchedule(
  config: ExponentialBackoffConfig = DEFAULT_BACKOFF_CONFIG
): number[] {
  const delays: number[] = [];
  for (let i = 0; i < config.maxRetries; i++) {
    // Use base calculation without jitter for predictable schedule
    const baseDelay = config.initialDelayMs * Math.pow(config.multiplier, i);
    delays.push(Math.min(baseDelay, config.maxDelayMs));
  }
  return delays;
}
