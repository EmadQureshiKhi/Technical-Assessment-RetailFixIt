/**
 * Property 26: Retry with Exponential Backoff
 *
 * For any transient failure (network timeout, 503 response), the system SHALL
 * retry with exponentially increasing delays (1s, 2s, 4s) up to the configured
 * maximum retries before failing.
 *
 * @validates Requirements 13.5
 * @file src/backend/event-integration/src/handlers/dead-letter-handler.ts
 */

import fc from 'fast-check';
import { describe, expect, it, beforeEach } from 'vitest';

import {
  DeadLetterHandler,
  InMemoryRetryQueue,
  calculateBackoffDelay,
  calculateNextRetryTime,
  shouldRetry,
  getRetrySchedule,
  createDeadLetterMessage,
  type EventReprocessor,
  type DeadLetterMessage,
  type ExponentialBackoffConfig,
  DEFAULT_BACKOFF_CONFIG,
} from '../../src/backend/event-integration/src/handlers/dead-letter-handler.js';
import type { JobCreatedEvent } from '@retailfixit/shared';

// Property test configuration
const propertyConfig = {
  numRuns: 100,
  verbose: false,
};

// Arbitraries for valid data generation
const validUuid = fc.uuid();

const validGeoLocation = fc.record({
  latitude: fc.double({ min: -90, max: 90, noNaN: true }),
  longitude: fc.double({ min: -180, max: 180, noNaN: true }),
  address: fc.string({ minLength: 1, maxLength: 200 }),
  city: fc.string({ minLength: 1, maxLength: 100 }),
  state: fc.stringOf(fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')), {
    minLength: 2,
    maxLength: 2,
  }),
  zipCode: fc.stringOf(fc.constantFrom(...'0123456789'.split('')), { minLength: 5, maxLength: 5 }),
  serviceRegion: fc.string({ minLength: 1, maxLength: 50 }),
});

const validCustomerDetails = fc.record({
  customerId: validUuid,
  tier: fc.constantFrom('standard' as const, 'premium' as const, 'enterprise' as const),
  preferredVendors: fc.option(fc.array(validUuid, { maxLength: 5 }), { nil: undefined }),
  blockedVendors: fc.option(fc.array(validUuid, { maxLength: 5 }), { nil: undefined }),
});

const validJobCreatedEvent = fc.record({
  eventId: validUuid,
  eventType: fc.constant('JobCreated' as const),
  timestamp: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') }),
  correlationId: validUuid,
  data: fc.record({
    jobId: validUuid,
    jobType: fc.constantFrom('repair' as const, 'installation' as const, 'maintenance' as const, 'inspection' as const),
    location: validGeoLocation,
    urgencyLevel: fc.constantFrom('low' as const, 'medium' as const, 'high' as const, 'critical' as const),
    slaDeadline: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') }),
    requiredCertifications: fc.array(fc.string({ minLength: 1, maxLength: 100 }), { maxLength: 5 }),
    customerDetails: validCustomerDetails,
  }),
});

const validBackoffConfig: fc.Arbitrary<ExponentialBackoffConfig> = fc.record({
  initialDelayMs: fc.integer({ min: 100, max: 5000 }),
  maxDelayMs: fc.integer({ min: 10000, max: 120000 }),
  multiplier: fc.double({ min: 1.5, max: 3, noNaN: true }),
  maxRetries: fc.integer({ min: 1, max: 10 }),
  jitterFactor: fc.double({ min: 0, max: 0.5, noNaN: true }),
});

/**
 * Mock reprocessor that always fails
 */
class FailingReprocessor implements EventReprocessor {
  public failureCount = 0;

  async reprocess(_event: JobCreatedEvent): Promise<void> {
    this.failureCount++;
    throw new Error('Simulated transient failure');
  }

  reset(): void {
    this.failureCount = 0;
  }
}

/**
 * Mock reprocessor that succeeds after N failures
 */
class EventuallySucceedingReprocessor implements EventReprocessor {
  public attemptCount = 0;
  private failuresBeforeSuccess: number;

  constructor(failuresBeforeSuccess: number) {
    this.failuresBeforeSuccess = failuresBeforeSuccess;
  }

  async reprocess(_event: JobCreatedEvent): Promise<void> {
    this.attemptCount++;
    if (this.attemptCount <= this.failuresBeforeSuccess) {
      throw new Error(`Simulated failure ${this.attemptCount}`);
    }
    // Success!
  }

  reset(): void {
    this.attemptCount = 0;
  }
}

describe('Property 26: Retry with Exponential Backoff', () => {
  /**
   * **Validates: Requirements 13.5**
   * 
   * Property: Backoff delays should increase exponentially with each retry.
   */
  describe('Exponential Backoff Calculation', () => {
    it('delays should increase exponentially with retry count', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 8 }),
          validBackoffConfig,
          (retryCount, config) => {
            // Ensure maxDelayMs is greater than initialDelayMs
            fc.pre(config.maxDelayMs > config.initialDelayMs);

            const delay = calculateBackoffDelay(retryCount, { ...config, jitterFactor: 0 });

            // Expected delay without jitter
            const expectedBase = config.initialDelayMs * Math.pow(config.multiplier, retryCount);
            const expectedDelay = Math.min(expectedBase, config.maxDelayMs);

            // Should match expected (without jitter)
            expect(delay).toBe(Math.floor(expectedDelay));
          }
        ),
        propertyConfig
      );
    });

    it('delays should be capped at maxDelayMs', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 20 }),
          validBackoffConfig,
          (retryCount, config) => {
            const delay = calculateBackoffDelay(retryCount, config);

            // Delay should never exceed maxDelayMs (plus jitter)
            const maxWithJitter = config.maxDelayMs * (1 + config.jitterFactor);
            expect(delay).toBeLessThanOrEqual(maxWithJitter);
          }
        ),
        propertyConfig
      );
    });

    it('delays should be non-negative', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 20 }),
          validBackoffConfig,
          (retryCount, config) => {
            const delay = calculateBackoffDelay(retryCount, config);
            expect(delay).toBeGreaterThanOrEqual(0);
          }
        ),
        propertyConfig
      );
    });

    it('higher retry counts should produce equal or higher delays', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 10 }),
          fc.integer({ min: 1, max: 10 }),
          (retryCount, increment) => {
            // Use config without jitter for deterministic comparison
            const config = { ...DEFAULT_BACKOFF_CONFIG, jitterFactor: 0 };

            const delay1 = calculateBackoffDelay(retryCount, config);
            const delay2 = calculateBackoffDelay(retryCount + increment, config);

            // Later retries should have equal or higher delays (capped at max)
            expect(delay2).toBeGreaterThanOrEqual(delay1);
          }
        ),
        propertyConfig
      );
    });

    it('default config should produce delays of 1s, 2s, 4s, 8s, 16s pattern', () => {
      const config = { ...DEFAULT_BACKOFF_CONFIG, jitterFactor: 0 };
      const expectedDelays = [1000, 2000, 4000, 8000, 16000];

      for (let i = 0; i < expectedDelays.length; i++) {
        const delay = calculateBackoffDelay(i, config);
        expect(delay).toBe(Math.min(expectedDelays[i], config.maxDelayMs));
      }
    });
  });

  /**
   * **Validates: Requirements 13.5**
   * 
   * Property: shouldRetry should correctly determine if more retries are allowed.
   */
  describe('Retry Decision Logic', () => {
    it('should allow retry when retryCount < maxRetries', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 10 }),
          (maxRetries) => {
            const config = { ...DEFAULT_BACKOFF_CONFIG, maxRetries };

            for (let i = 0; i < maxRetries; i++) {
              expect(shouldRetry(i, config)).toBe(true);
            }
          }
        ),
        propertyConfig
      );
    });

    it('should not allow retry when retryCount >= maxRetries', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 10 }),
          fc.integer({ min: 0, max: 5 }),
          (maxRetries, extra) => {
            const config = { ...DEFAULT_BACKOFF_CONFIG, maxRetries };

            expect(shouldRetry(maxRetries, config)).toBe(false);
            expect(shouldRetry(maxRetries + extra, config)).toBe(false);
          }
        ),
        propertyConfig
      );
    });
  });

  /**
   * **Validates: Requirements 13.5**
   * 
   * Property: getRetrySchedule should return correct number of delays.
   */
  describe('Retry Schedule Generation', () => {
    it('should return maxRetries number of delays', () => {
      fc.assert(
        fc.property(validBackoffConfig, (config) => {
          const schedule = getRetrySchedule(config);
          expect(schedule.length).toBe(config.maxRetries);
        }),
        propertyConfig
      );
    });

    it('schedule delays should be monotonically non-decreasing', () => {
      fc.assert(
        fc.property(validBackoffConfig, (config) => {
          const schedule = getRetrySchedule(config);

          for (let i = 1; i < schedule.length; i++) {
            expect(schedule[i]).toBeGreaterThanOrEqual(schedule[i - 1]);
          }
        }),
        propertyConfig
      );
    });
  });

  /**
   * **Validates: Requirements 13.5**
   * 
   * Property: DeadLetterHandler should schedule retries with exponential backoff.
   */
  describe('DeadLetterHandler Retry Behavior', () => {
    let retryQueue: InMemoryRetryQueue;
    let failingReprocessor: FailingReprocessor;
    let handler: DeadLetterHandler;

    beforeEach(() => {
      retryQueue = new InMemoryRetryQueue();
      failingReprocessor = new FailingReprocessor();
      handler = new DeadLetterHandler(failingReprocessor, retryQueue);
    });

    it('failed processing should schedule retry with backoff', async () => {
      await fc.assert(
        fc.asyncProperty(validJobCreatedEvent, async (event) => {
          retryQueue.clear();
          failingReprocessor.reset();

          const message = createDeadLetterMessage(
            event,
            event.eventId,
            event.correlationId,
            'Initial failure'
          );

          const result = await handler.handle(message);

          // Should schedule a retry
          expect(result.action).toBe('scheduled_retry');
          expect(result.retryCount).toBe(1);
          expect(result.nextRetryAt).toBeDefined();

          // Retry should be scheduled in the queue
          const scheduled = retryQueue.getScheduledRetries();
          expect(scheduled.length).toBe(1);
        }),
        propertyConfig
      );
    });

    it('retry count should increment with each failure', async () => {
      await fc.assert(
        fc.asyncProperty(
          validJobCreatedEvent,
          fc.integer({ min: 1, max: 4 }),
          async (event, failureCount) => {
            retryQueue.clear();
            failingReprocessor.reset();

            let message = createDeadLetterMessage(
              event,
              event.eventId,
              event.correlationId,
              'Initial failure'
            );

            // Process multiple times
            for (let i = 0; i < failureCount; i++) {
              const result = await handler.handle(message);

              if (result.action === 'scheduled_retry') {
                // Get the updated message from the queue
                const scheduled = retryQueue.getScheduledRetries();
                message = scheduled[scheduled.length - 1].message;
              }
            }

            // Final retry count should match failure count
            expect(message.metadata.retryCount).toBe(failureCount);
          }
        ),
        propertyConfig
      );
    });

    it('should abandon after max retries exceeded', async () => {
      const maxRetries = 3;
      const customHandler = new DeadLetterHandler(failingReprocessor, retryQueue, { maxRetries });

      await fc.assert(
        fc.asyncProperty(validJobCreatedEvent, async (event) => {
          retryQueue.clear();
          failingReprocessor.reset();

          // Create message that has already been retried maxRetries times
          const message: DeadLetterMessage = {
            metadata: {
              originalEventId: event.eventId,
              correlationId: event.correlationId,
              failureReason: 'Previous failure',
              failedAt: new Date(),
              retryCount: maxRetries, // Already at max
            },
            originalEvent: event,
          };

          const result = await customHandler.handle(message);

          // Should be abandoned
          expect(result.action).toBe('abandoned');
          expect(result.success).toBe(false);

          // Should be in abandoned queue
          const abandoned = retryQueue.getAbandonedMessages();
          expect(abandoned.length).toBe(1);
        }),
        propertyConfig
      );
    });

    it('successful reprocessing should not schedule retry', async () => {
      const succeedingReprocessor = new EventuallySucceedingReprocessor(0); // Succeeds immediately
      const successHandler = new DeadLetterHandler(succeedingReprocessor, retryQueue);

      await fc.assert(
        fc.asyncProperty(validJobCreatedEvent, async (event) => {
          retryQueue.clear();

          const message = createDeadLetterMessage(
            event,
            event.eventId,
            event.correlationId,
            'Initial failure'
          );

          const result = await successHandler.handle(message);

          // Should be reprocessed successfully
          expect(result.action).toBe('reprocessed');
          expect(result.success).toBe(true);

          // No retries should be scheduled
          const scheduled = retryQueue.getScheduledRetries();
          expect(scheduled.length).toBe(0);
        }),
        propertyConfig
      );
    });
  });

  /**
   * **Validates: Requirements 13.5**
   * 
   * Property: Next retry time should be in the future.
   */
  describe('Next Retry Time Calculation', () => {
    it('next retry time should be in the future', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 10 }),
          validBackoffConfig,
          (retryCount, config) => {
            const now = Date.now();
            const nextRetry = calculateNextRetryTime(retryCount, config);

            expect(nextRetry.getTime()).toBeGreaterThan(now);
          }
        ),
        propertyConfig
      );
    });

    it('next retry time should increase with retry count', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 5 }),
          (retryCount) => {
            // Use config without jitter for deterministic comparison
            const config = { ...DEFAULT_BACKOFF_CONFIG, jitterFactor: 0 };

            const now = Date.now();
            const nextRetry1 = calculateNextRetryTime(retryCount, config);
            const nextRetry2 = calculateNextRetryTime(retryCount + 1, config);

            // Later retry should be scheduled further in the future
            // (relative to now, accounting for the delay difference)
            const delay1 = nextRetry1.getTime() - now;
            const delay2 = nextRetry2.getTime() - now;

            expect(delay2).toBeGreaterThanOrEqual(delay1);
          }
        ),
        propertyConfig
      );
    });
  });

  /**
   * **Validates: Requirements 13.5**
   * 
   * Property: Invalid events should be abandoned immediately without retry.
   */
  describe('Invalid Event Handling', () => {
    it('invalid events should be abandoned without retry', async () => {
      const retryQueue = new InMemoryRetryQueue();
      const failingReprocessor = new FailingReprocessor();
      const handler = new DeadLetterHandler(failingReprocessor, retryQueue);

      await fc.assert(
        fc.asyncProperty(
          fc.record({
            eventId: validUuid,
            eventType: fc.constant('JobCreated'),
            timestamp: fc.date(),
            correlationId: validUuid,
            data: fc.record({
              jobId: fc.constant('invalid-uuid'), // Invalid UUID
              jobType: fc.constant('repair'),
              location: validGeoLocation,
              urgencyLevel: fc.constant('medium'),
              slaDeadline: fc.date(),
              requiredCertifications: fc.array(fc.string()),
              customerDetails: validCustomerDetails,
            }),
          }),
          async (invalidEvent) => {
            retryQueue.clear();
            failingReprocessor.reset();

            const message = createDeadLetterMessage(
              invalidEvent,
              invalidEvent.eventId,
              invalidEvent.correlationId,
              'Initial failure'
            );

            const result = await handler.handle(message);

            // Should be marked as invalid
            expect(result.action).toBe('invalid');
            expect(result.success).toBe(false);

            // Should be abandoned, not scheduled for retry
            const scheduled = retryQueue.getScheduledRetries();
            expect(scheduled.length).toBe(0);

            const abandoned = retryQueue.getAbandonedMessages();
            expect(abandoned.length).toBe(1);

            // Reprocessor should not have been called
            expect(failingReprocessor.failureCount).toBe(0);
          }
        ),
        propertyConfig
      );
    });
  });
});
