/**
 * Property 9: Correlation ID Propagation
 *
 * For any request processed through the system, the correlationId from the initial
 * event SHALL appear in all log entries, downstream events, and API responses
 * related to that request.
 *
 * @validates Requirements 4.6, 10.2
 * @file src/backend/event-integration/src/handlers/job-created-handler.ts
 * @file src/backend/event-integration/src/publishers/recommendation-publisher.ts
 */

import fc from 'fast-check';
import { describe, expect, it, beforeEach } from 'vitest';

import {
  JobCreatedHandler,
  InMemoryIdempotencyStore,
  generateRecommendationId,
  type ScoringService,
} from '../../src/backend/event-integration/src/handlers/job-created-handler.js';
import {
  RecommendationPublisher,
  InMemoryEventTransport,
  createRecommendationEvent,
} from '../../src/backend/event-integration/src/publishers/recommendation-publisher.js';
import type { JobCreatedEvent, VendorRecommendation } from '@retailfixit/shared';

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

const validScoreFactor = fc.record({
  name: fc.string({ minLength: 1, maxLength: 50 }),
  value: fc.double({ min: 0, max: 1, noNaN: true }),
  weight: fc.double({ min: 0, max: 1, noNaN: true }),
  contribution: fc.double({ min: 0, max: 1, noNaN: true }),
  explanation: fc.string({ minLength: 1, maxLength: 200 }),
});

const validVendorRecommendation: fc.Arbitrary<VendorRecommendation> = fc.record({
  rank: fc.integer({ min: 1, max: 5 }),
  vendorId: validUuid,
  vendorName: fc.string({ minLength: 1, maxLength: 100 }),
  overallScore: fc.double({ min: 0, max: 1, noNaN: true }),
  confidence: fc.double({ min: 0, max: 1, noNaN: true }),
  scoreBreakdown: fc.record({
    ruleBasedScore: fc.double({ min: 0, max: 1, noNaN: true }),
    mlScore: fc.double({ min: 0, max: 1, noNaN: true }),
    factors: fc.array(validScoreFactor, { minLength: 1, maxLength: 5 }),
  }),
  rationale: fc.string({ minLength: 1, maxLength: 500 }),
  riskFactors: fc.array(fc.string({ minLength: 1, maxLength: 100 }), { maxLength: 5 }),
  estimatedResponseTime: fc.string({ minLength: 1, maxLength: 50 }),
});

/**
 * Mock scoring service that captures correlation IDs
 */
class CorrelationTrackingScoringService implements ScoringService {
  public capturedCorrelationIds: string[] = [];

  async generateRecommendations(event: JobCreatedEvent): Promise<string> {
    // In a real implementation, the correlation ID would be passed through
    // For testing, we capture it from the event
    this.capturedCorrelationIds.push(event.correlationId);
    return generateRecommendationId(event.data.jobId);
  }

  reset(): void {
    this.capturedCorrelationIds = [];
  }
}

describe('Property 9: Correlation ID Propagation', () => {
  /**
   * **Validates: Requirements 4.6, 10.2**
   * 
   * Property: The correlation ID from the input event should be preserved
   * in the handler result.
   */
  describe('JobCreatedHandler Correlation ID Propagation', () => {
    let idempotencyStore: InMemoryIdempotencyStore;
    let scoringService: CorrelationTrackingScoringService;
    let handler: JobCreatedHandler;

    beforeEach(() => {
      idempotencyStore = new InMemoryIdempotencyStore();
      scoringService = new CorrelationTrackingScoringService();
      handler = new JobCreatedHandler(idempotencyStore, scoringService);
    });

    it('correlation ID should be preserved in handler result', async () => {
      await fc.assert(
        fc.asyncProperty(validJobCreatedEvent, async (event) => {
          idempotencyStore.clear();
          scoringService.reset();

          const result = await handler.handle(event);

          // Correlation ID should match the input event
          expect(result.correlationId).toBe(event.correlationId);
        }),
        propertyConfig
      );
    });

    it('correlation ID should be available to scoring service', async () => {
      await fc.assert(
        fc.asyncProperty(validJobCreatedEvent, async (event) => {
          idempotencyStore.clear();
          scoringService.reset();

          await handler.handle(event);

          // Scoring service should have received the correlation ID
          expect(scoringService.capturedCorrelationIds).toContain(event.correlationId);
        }),
        propertyConfig
      );
    });

    it('correlation ID should be preserved even for duplicate events', async () => {
      await fc.assert(
        fc.asyncProperty(validJobCreatedEvent, async (event) => {
          idempotencyStore.clear();
          scoringService.reset();

          // Process the same event twice
          const result1 = await handler.handle(event);
          const result2 = await handler.handle(event);

          // Both results should have the same correlation ID
          expect(result1.correlationId).toBe(event.correlationId);
          expect(result2.correlationId).toBe(event.correlationId);
        }),
        propertyConfig
      );
    });
  });

  /**
   * **Validates: Requirements 4.6, 10.2**
   * 
   * Property: The correlation ID should be propagated to published events.
   */
  describe('RecommendationPublisher Correlation ID Propagation', () => {
    let transport: InMemoryEventTransport;
    let publisher: RecommendationPublisher;

    beforeEach(() => {
      transport = new InMemoryEventTransport();
      publisher = new RecommendationPublisher(transport);
    });

    it('correlation ID should be included in published events', async () => {
      await fc.assert(
        fc.asyncProperty(
          validUuid, // jobId
          validUuid, // correlationId
          fc.array(validVendorRecommendation, { minLength: 1, maxLength: 5 }),
          fc.integer({ min: 100, max: 2000 }), // processingTimeMs
          fc.boolean(), // degradedMode
          async (jobId, correlationId, recommendations, processingTimeMs, degradedMode) => {
            transport.clear();

            const result = await publisher.publish({
              jobId,
              correlationId,
              recommendations,
              processingTimeMs,
              degradedMode,
            });

            // Publish should succeed
            expect(result.success).toBe(true);

            // Result should contain the correlation ID
            expect(result.correlationId).toBe(correlationId);

            // Published event should contain the correlation ID
            const events = transport.getEvents();
            expect(events.length).toBe(1);
            expect(events[0].correlationId).toBe(correlationId);
          }
        ),
        propertyConfig
      );
    });

    it('correlation ID should be retrievable by filtering published events', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.record({
              jobId: validUuid,
              correlationId: validUuid,
              recommendations: fc.array(validVendorRecommendation, { minLength: 1, maxLength: 3 }),
              processingTimeMs: fc.integer({ min: 100, max: 2000 }),
              degradedMode: fc.boolean(),
            }),
            { minLength: 2, maxLength: 5 }
          ),
          async (inputs) => {
            // Ensure unique correlation IDs
            const correlationIds = inputs.map((i) => i.correlationId);
            fc.pre(new Set(correlationIds).size === correlationIds.length);

            transport.clear();

            // Publish all events
            for (const input of inputs) {
              await publisher.publish(input);
            }

            // Each correlation ID should be retrievable
            for (const input of inputs) {
              const events = transport.getEventsByCorrelationId(input.correlationId);
              expect(events.length).toBe(1);
              expect(events[0].data.jobId).toBe(input.jobId);
            }
          }
        ),
        propertyConfig
      );
    });
  });

  /**
   * **Validates: Requirements 4.6, 10.2**
   * 
   * Property: The createRecommendationEvent utility should preserve correlation ID.
   */
  describe('createRecommendationEvent Correlation ID Propagation', () => {
    it('correlation ID should be included in created events', () => {
      fc.assert(
        fc.property(
          validUuid, // jobId
          validUuid, // correlationId
          fc.array(validVendorRecommendation, { minLength: 1, maxLength: 5 }),
          fc.integer({ min: 100, max: 2000 }), // processingTimeMs
          fc.boolean(), // degradedMode
          (jobId, correlationId, recommendations, processingTimeMs, degradedMode) => {
            const event = createRecommendationEvent({
              jobId,
              correlationId,
              recommendations,
              processingTimeMs,
              degradedMode,
            });

            // Event should have the correlation ID
            expect(event.correlationId).toBe(correlationId);

            // Event should have the correct job ID
            expect(event.data.jobId).toBe(jobId);

            // Event should have a unique event ID
            expect(event.eventId).toBeDefined();
            expect(event.eventId.length).toBeGreaterThan(0);
          }
        ),
        propertyConfig
      );
    });

    it('different inputs should produce events with different event IDs but same correlation ID', () => {
      fc.assert(
        fc.property(
          validUuid, // correlationId (shared)
          fc.array(validUuid, { minLength: 2, maxLength: 5 }), // jobIds
          fc.array(validVendorRecommendation, { minLength: 1, maxLength: 3 }),
          (correlationId, jobIds, recommendations) => {
            // Ensure unique job IDs
            fc.pre(new Set(jobIds).size === jobIds.length);

            const events = jobIds.map((jobId) =>
              createRecommendationEvent({
                jobId,
                correlationId, // Same correlation ID for all
                recommendations,
                processingTimeMs: 500,
                degradedMode: false,
              })
            );

            // All events should have the same correlation ID
            expect(events.every((e) => e.correlationId === correlationId)).toBe(true);

            // All events should have unique event IDs
            const eventIds = events.map((e) => e.eventId);
            expect(new Set(eventIds).size).toBe(events.length);
          }
        ),
        propertyConfig
      );
    });
  });

  /**
   * **Validates: Requirements 4.6, 10.2**
   * 
   * Property: End-to-end correlation ID propagation through handler and publisher.
   */
  describe('End-to-End Correlation ID Propagation', () => {
    it('correlation ID should flow from input event through to published event', async () => {
      await fc.assert(
        fc.asyncProperty(
          validJobCreatedEvent,
          fc.array(validVendorRecommendation, { minLength: 1, maxLength: 5 }),
          async (inputEvent, recommendations) => {
            const idempotencyStore = new InMemoryIdempotencyStore();
            const scoringService = new CorrelationTrackingScoringService();
            const handler = new JobCreatedHandler(idempotencyStore, scoringService);

            const transport = new InMemoryEventTransport();
            const publisher = new RecommendationPublisher(transport);

            // Process the input event
            const handlerResult = await handler.handle(inputEvent);

            // Handler should preserve correlation ID
            expect(handlerResult.correlationId).toBe(inputEvent.correlationId);

            // Publish the recommendation using the same correlation ID
            const publishResult = await publisher.publish({
              jobId: inputEvent.data.jobId,
              correlationId: handlerResult.correlationId,
              recommendations,
              processingTimeMs: 500,
              degradedMode: false,
            });

            // Publisher should preserve correlation ID
            expect(publishResult.correlationId).toBe(inputEvent.correlationId);

            // Published event should have the same correlation ID
            const publishedEvents = transport.getEvents();
            expect(publishedEvents.length).toBe(1);
            expect(publishedEvents[0].correlationId).toBe(inputEvent.correlationId);

            // Should be able to trace back using correlation ID
            const tracedEvents = transport.getEventsByCorrelationId(inputEvent.correlationId);
            expect(tracedEvents.length).toBe(1);
            expect(tracedEvents[0].data.jobId).toBe(inputEvent.data.jobId);
          }
        ),
        propertyConfig
      );
    });
  });
});
