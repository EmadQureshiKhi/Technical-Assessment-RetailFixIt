/**
 * Integration Tests for Event Flow
 *
 * Tests the complete event flow from JobCreated to VendorRecommendationGenerated.
 * Tests dead-letter handling and retry logic.
 *
 * @requirement 14.2 - Integration tests for event processing workflows
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';

import {
  JobCreatedHandler,
  InMemoryIdempotencyStore,
  generateRecommendationId,
  type ScoringService,
} from '../../src/backend/event-integration/src/handlers/job-created-handler.js';
import {
  DeadLetterHandler,
  InMemoryRetryQueue,
  calculateBackoffDelay,
  shouldRetry,
  createDeadLetterMessage,
  type EventReprocessor,
  type DeadLetterMessage,
  DEFAULT_BACKOFF_CONFIG,
} from '../../src/backend/event-integration/src/handlers/dead-letter-handler.js';
import {
  RecommendationPublisher,
  InMemoryEventTransport,
} from '../../src/backend/event-integration/src/publishers/recommendation-publisher.js';
import type { JobCreatedEvent, VendorRecommendationGeneratedEvent } from '@retailfixit/shared';

// Test fixtures
const createValidJobCreatedEvent = (overrides: Partial<JobCreatedEvent['data']> = {}): JobCreatedEvent => ({
  eventId: crypto.randomUUID(),
  eventType: 'JobCreated',
  timestamp: new Date(),
  correlationId: crypto.randomUUID(),
  data: {
    jobId: crypto.randomUUID(),
    jobType: 'repair',
    location: {
      latitude: 40.7128,
      longitude: -74.006,
      address: '123 Main St',
      city: 'New York',
      state: 'NY',
      zipCode: '10001',
      serviceRegion: 'northeast',
    },
    urgencyLevel: 'medium',
    slaDeadline: new Date(Date.now() + 86400000), // 24 hours from now
    requiredCertifications: ['HVAC'],
    customerDetails: {
      customerId: crypto.randomUUID(),
      tier: 'standard',
    },
    ...overrides,
  },
});

const createMockVendorRecommendation = () => ({
  rank: 1,
  vendorId: crypto.randomUUID(),
  vendorName: 'Test Vendor',
  overallScore: 0.85,
  confidence: 0.9,
  scoreBreakdown: {
    ruleBasedScore: 0.8,
    mlScore: 0.9,
    factors: [
      {
        name: 'availability',
        value: 1.0,
        weight: 0.25,
        contribution: 0.25,
        explanation: 'Vendor is available',
      },
    ],
  },
  rationale: 'Best match based on availability and proximity',
  riskFactors: [],
  estimatedResponseTime: '2 hours',
});

/**
 * Mock scoring service that tracks calls and can simulate failures
 */
class MockScoringService implements ScoringService {
  public callCount = 0;
  public processedJobs: string[] = [];
  public shouldFail = false;
  public failureMessage = 'Scoring service error';

  async generateRecommendations(event: JobCreatedEvent): Promise<string> {
    this.callCount++;
    this.processedJobs.push(event.data.jobId);

    if (this.shouldFail) {
      throw new Error(this.failureMessage);
    }

    return generateRecommendationId(event.data.jobId);
  }

  reset(): void {
    this.callCount = 0;
    this.processedJobs = [];
    this.shouldFail = false;
  }
}

/**
 * Mock event reprocessor for dead-letter testing
 */
class MockEventReprocessor implements EventReprocessor {
  public callCount = 0;
  public processedEvents: JobCreatedEvent[] = [];
  public shouldFail = false;
  public failureMessage = 'Reprocessing failed';

  async reprocess(event: JobCreatedEvent): Promise<void> {
    this.callCount++;
    this.processedEvents.push(event);

    if (this.shouldFail) {
      throw new Error(this.failureMessage);
    }
  }

  reset(): void {
    this.callCount = 0;
    this.processedEvents = [];
    this.shouldFail = false;
  }
}

describe('Event Flow Integration Tests', () => {
  describe('JobCreated → Scoring → VendorRecommendationGenerated Flow', () => {
    let idempotencyStore: InMemoryIdempotencyStore;
    let scoringService: MockScoringService;
    let handler: JobCreatedHandler;
    let eventBus: InMemoryEventTransport;
    let publisher: RecommendationPublisher;

    beforeEach(() => {
      idempotencyStore = new InMemoryIdempotencyStore();
      scoringService = new MockScoringService();
      handler = new JobCreatedHandler(idempotencyStore, scoringService);
      eventBus = new InMemoryEventTransport();
      publisher = new RecommendationPublisher(eventBus);
    });

    it('processes JobCreated event and generates recommendation', async () => {
      const event = createValidJobCreatedEvent();

      // Process the event
      const result = await handler.handle(event);

      // Verify successful processing
      expect(result.success).toBe(true);
      expect(result.skipped).toBe(false);
      expect(result.jobId).toBe(event.data.jobId);
      expect(result.correlationId).toBe(event.correlationId);
      expect(result.recommendationId).toBe(generateRecommendationId(event.data.jobId));

      // Verify scoring service was called
      expect(scoringService.callCount).toBe(1);
      expect(scoringService.processedJobs).toContain(event.data.jobId);
    });

    it('publishes VendorRecommendationGenerated event after scoring', async () => {
      const event = createValidJobCreatedEvent();
      const recommendations = [createMockVendorRecommendation()];

      // Publish recommendation event
      await publisher.publish({
        jobId: event.data.jobId,
        correlationId: event.correlationId,
        recommendations,
        modelVersion: '1.0.0',
        processingTimeMs: 150,
        automationLevel: 'advisory',
        degradedMode: false,
      });

      // Verify event was published
      const publishedEvents = eventBus.getEvents();
      expect(publishedEvents).toHaveLength(1);

      const publishedEvent = publishedEvents[0] as VendorRecommendationGeneratedEvent;
      expect(publishedEvent.eventType).toBe('VendorRecommendationGenerated');
      expect(publishedEvent.data.jobId).toBe(event.data.jobId);
      expect(publishedEvent.correlationId).toBe(event.correlationId);
      expect(publishedEvent.data.recommendations).toHaveLength(1);
      expect(publishedEvent.data.modelVersion).toBe('1.0.0');
    });

    it('maintains correlation ID throughout the flow', async () => {
      const event = createValidJobCreatedEvent();
      const correlationId = event.correlationId;

      // Process event
      const result = await handler.handle(event);
      expect(result.correlationId).toBe(correlationId);

      // Publish recommendation
      await publisher.publish({
        jobId: event.data.jobId,
        correlationId,
        recommendations: [createMockVendorRecommendation()],
        modelVersion: '1.0.0',
        processingTimeMs: 100,
        automationLevel: 'auto',
        degradedMode: false,
      });

      // Verify correlation ID is preserved
      const publishedEvents = eventBus.getEvents();
      expect(publishedEvents[0].correlationId).toBe(correlationId);
    });

    it('handles multiple jobs in sequence', async () => {
      const events = [
        createValidJobCreatedEvent(),
        createValidJobCreatedEvent(),
        createValidJobCreatedEvent(),
      ];

      // Process all events
      const results = await Promise.all(events.map((e) => handler.handle(e)));

      // All should succeed
      expect(results.every((r) => r.success)).toBe(true);
      expect(results.every((r) => !r.skipped)).toBe(true);

      // Each should have unique recommendation ID
      const recommendationIds = results.map((r) => r.recommendationId);
      expect(new Set(recommendationIds).size).toBe(3);

      // Scoring service should be called for each
      expect(scoringService.callCount).toBe(3);
    });

    it('handles scoring service failure gracefully', async () => {
      const event = createValidJobCreatedEvent();
      scoringService.shouldFail = true;
      scoringService.failureMessage = 'ML endpoint unavailable';

      // Process the event
      const result = await handler.handle(event);

      // Should fail but not throw
      expect(result.success).toBe(false);
      expect(result.error).toContain('Scoring failed');
      expect(result.error).toContain('ML endpoint unavailable');
    });
  });

  describe('Dead-Letter Handling and Retry', () => {
    let reprocessor: MockEventReprocessor;
    let retryQueue: InMemoryRetryQueue;
    let deadLetterHandler: DeadLetterHandler;

    beforeEach(() => {
      reprocessor = new MockEventReprocessor();
      retryQueue = new InMemoryRetryQueue();
      deadLetterHandler = new DeadLetterHandler(reprocessor, retryQueue);
    });

    it('successfully reprocesses valid dead-letter message', async () => {
      const event = createValidJobCreatedEvent();
      const deadLetterMessage = createDeadLetterMessage(
        event,
        event.eventId,
        event.correlationId,
        'Initial processing failed'
      );

      // Process dead-letter message
      const result = await deadLetterHandler.handle(deadLetterMessage);

      // Should succeed
      expect(result.success).toBe(true);
      expect(result.action).toBe('reprocessed');
      expect(result.retryCount).toBe(0);

      // Reprocessor should be called
      expect(reprocessor.callCount).toBe(1);
    });

    it('schedules retry with exponential backoff on failure', async () => {
      const event = createValidJobCreatedEvent();
      const deadLetterMessage = createDeadLetterMessage(
        event,
        event.eventId,
        event.correlationId,
        'Initial processing failed'
      );

      // Make reprocessor fail
      reprocessor.shouldFail = true;

      // Process dead-letter message
      const result = await deadLetterHandler.handle(deadLetterMessage);

      // Should schedule retry
      expect(result.success).toBe(false);
      expect(result.action).toBe('scheduled_retry');
      expect(result.retryCount).toBe(1);
      expect(result.nextRetryAt).toBeDefined();

      // Verify retry was scheduled
      const scheduledRetries = retryQueue.getScheduledRetries();
      expect(scheduledRetries).toHaveLength(1);
      expect(scheduledRetries[0].message.metadata.retryCount).toBe(1);
    });

    it('abandons message after max retries', async () => {
      const event = createValidJobCreatedEvent();
      const deadLetterMessage: DeadLetterMessage = {
        metadata: {
          originalEventId: event.eventId,
          correlationId: event.correlationId,
          failureReason: 'Repeated failures',
          failedAt: new Date(),
          retryCount: DEFAULT_BACKOFF_CONFIG.maxRetries, // Already at max
        },
        originalEvent: event,
      };

      // Process dead-letter message
      const result = await deadLetterHandler.handle(deadLetterMessage);

      // Should abandon
      expect(result.success).toBe(false);
      expect(result.action).toBe('abandoned');
      expect(result.error).toContain('Abandoned');

      // Verify message was abandoned
      const abandonedMessages = retryQueue.getAbandonedMessages();
      expect(abandonedMessages).toHaveLength(1);
    });

    it('rejects invalid event format', async () => {
      const invalidEvent = { invalid: 'data' };
      const deadLetterMessage = createDeadLetterMessage(
        invalidEvent,
        crypto.randomUUID(),
        crypto.randomUUID(),
        'Invalid event'
      );

      // Process dead-letter message
      const result = await deadLetterHandler.handle(deadLetterMessage);

      // Should mark as invalid
      expect(result.success).toBe(false);
      expect(result.action).toBe('invalid');
      expect(result.error).toContain('validation failed');

      // Reprocessor should not be called
      expect(reprocessor.callCount).toBe(0);
    });

    it('calculates exponential backoff delays correctly', () => {
      const config = DEFAULT_BACKOFF_CONFIG;

      // First retry: 1s
      const delay0 = calculateBackoffDelay(0, { ...config, jitterFactor: 0 });
      expect(delay0).toBe(config.initialDelayMs);

      // Second retry: 2s
      const delay1 = calculateBackoffDelay(1, { ...config, jitterFactor: 0 });
      expect(delay1).toBe(config.initialDelayMs * config.multiplier);

      // Third retry: 4s
      const delay2 = calculateBackoffDelay(2, { ...config, jitterFactor: 0 });
      expect(delay2).toBe(config.initialDelayMs * Math.pow(config.multiplier, 2));
    });

    it('caps delay at maxDelayMs', () => {
      const config = { ...DEFAULT_BACKOFF_CONFIG, jitterFactor: 0 };

      // Very high retry count should be capped
      const delay = calculateBackoffDelay(100, config);
      expect(delay).toBe(config.maxDelayMs);
    });

    it('shouldRetry returns false after max retries', () => {
      expect(shouldRetry(0)).toBe(true);
      expect(shouldRetry(DEFAULT_BACKOFF_CONFIG.maxRetries - 1)).toBe(true);
      expect(shouldRetry(DEFAULT_BACKOFF_CONFIG.maxRetries)).toBe(false);
      expect(shouldRetry(DEFAULT_BACKOFF_CONFIG.maxRetries + 1)).toBe(false);
    });

    it('processes batch of dead-letter messages', async () => {
      const messages = [
        createDeadLetterMessage(
          createValidJobCreatedEvent(),
          crypto.randomUUID(),
          crypto.randomUUID(),
          'Failure 1'
        ),
        createDeadLetterMessage(
          createValidJobCreatedEvent(),
          crypto.randomUUID(),
          crypto.randomUUID(),
          'Failure 2'
        ),
      ];

      // Process batch
      const results = await deadLetterHandler.handleBatch(messages);

      // All should succeed
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.success)).toBe(true);
      expect(reprocessor.callCount).toBe(2);
    });
  });

  describe('Idempotency Integration', () => {
    let idempotencyStore: InMemoryIdempotencyStore;
    let scoringService: MockScoringService;
    let handler: JobCreatedHandler;

    beforeEach(() => {
      idempotencyStore = new InMemoryIdempotencyStore();
      scoringService = new MockScoringService();
      handler = new JobCreatedHandler(idempotencyStore, scoringService);
    });

    it('prevents duplicate processing of same job', async () => {
      const event = createValidJobCreatedEvent();

      // Process same event multiple times
      const result1 = await handler.handle(event);
      const result2 = await handler.handle(event);
      const result3 = await handler.handle(event);

      // First should process, others should skip
      expect(result1.success).toBe(true);
      expect(result1.skipped).toBe(false);

      expect(result2.success).toBe(true);
      expect(result2.skipped).toBe(true);
      expect(result2.skipReason).toContain('idempotency');

      expect(result3.success).toBe(true);
      expect(result3.skipped).toBe(true);

      // All should have same recommendation ID
      expect(result1.recommendationId).toBe(result2.recommendationId);
      expect(result2.recommendationId).toBe(result3.recommendationId);

      // Scoring service should only be called once
      expect(scoringService.callCount).toBe(1);
    });

    it('allows processing of different jobs', async () => {
      const event1 = createValidJobCreatedEvent();
      const event2 = createValidJobCreatedEvent();

      // Process different events
      const result1 = await handler.handle(event1);
      const result2 = await handler.handle(event2);

      // Both should process
      expect(result1.success).toBe(true);
      expect(result1.skipped).toBe(false);

      expect(result2.success).toBe(true);
      expect(result2.skipped).toBe(false);

      // Different recommendation IDs
      expect(result1.recommendationId).not.toBe(result2.recommendationId);

      // Scoring service called twice
      expect(scoringService.callCount).toBe(2);
    });
  });

  describe('Event Validation Integration', () => {
    let idempotencyStore: InMemoryIdempotencyStore;
    let scoringService: MockScoringService;
    let handler: JobCreatedHandler;

    beforeEach(() => {
      idempotencyStore = new InMemoryIdempotencyStore();
      scoringService = new MockScoringService();
      handler = new JobCreatedHandler(idempotencyStore, scoringService);
    });

    it('rejects event with missing required fields', async () => {
      const invalidEvent = {
        eventId: crypto.randomUUID(),
        eventType: 'JobCreated',
        timestamp: new Date(),
        correlationId: crypto.randomUUID(),
        data: {
          // Missing jobId and other required fields
          jobType: 'repair',
        },
      };

      const result = await handler.handle(invalidEvent);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Validation failed');
    });

    it('rejects event with invalid job type', async () => {
      const event = createValidJobCreatedEvent();
      (event.data as any).jobType = 'invalid_type';

      const result = await handler.handle(event);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Validation failed');
    });

    it('rejects event with invalid urgency level', async () => {
      const event = createValidJobCreatedEvent();
      (event.data as any).urgencyLevel = 'super_urgent';

      const result = await handler.handle(event);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Validation failed');
    });

    it('rejects event with invalid location coordinates', async () => {
      const event = createValidJobCreatedEvent();
      event.data.location.latitude = 200; // Invalid latitude

      const result = await handler.handle(event);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Validation failed');
    });
  });
});
