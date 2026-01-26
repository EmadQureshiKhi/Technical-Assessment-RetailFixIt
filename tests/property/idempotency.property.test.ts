/**
 * Property 8: Event Processing Idempotency
 *
 * For any JobCreated event processed multiple times (due to retry or replay),
 * the system SHALL produce exactly one recommendation, identified by the same
 * recommendationId derived from the jobId.
 *
 * @validates Requirements 4.5
 * @file src/backend/event-integration/src/handlers/job-created-handler.ts
 */

import fc from 'fast-check';
import { describe, expect, it, beforeEach } from 'vitest';

import {
  JobCreatedHandler,
  InMemoryIdempotencyStore,
  generateRecommendationId,
  type ScoringService,
  type JobCreatedHandlerResult,
} from '../../src/backend/event-integration/src/handlers/job-created-handler.js';
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

/**
 * Mock scoring service that tracks calls
 */
class MockScoringService implements ScoringService {
  public callCount = 0;
  public processedJobs: string[] = [];

  async generateRecommendations(event: JobCreatedEvent): Promise<string> {
    this.callCount++;
    this.processedJobs.push(event.data.jobId);
    return generateRecommendationId(event.data.jobId);
  }

  reset(): void {
    this.callCount = 0;
    this.processedJobs = [];
  }
}

describe('Property 8: Event Processing Idempotency', () => {
  let idempotencyStore: InMemoryIdempotencyStore;
  let scoringService: MockScoringService;
  let handler: JobCreatedHandler;

  beforeEach(() => {
    idempotencyStore = new InMemoryIdempotencyStore();
    scoringService = new MockScoringService();
    handler = new JobCreatedHandler(idempotencyStore, scoringService);
  });

  /**
   * **Validates: Requirements 4.5**
   * 
   * Property: For any valid JobCreated event, processing it multiple times
   * should produce exactly one recommendation (scoring service called once).
   */
  it('duplicate events should produce single recommendation', async () => {
    await fc.assert(
      fc.asyncProperty(
        validJobCreatedEvent,
        fc.integer({ min: 2, max: 10 }),
        async (event, duplicateCount) => {
          // Reset state
          idempotencyStore.clear();
          scoringService.reset();

          // Process the same event multiple times
          const results: JobCreatedHandlerResult[] = [];
          for (let i = 0; i < duplicateCount; i++) {
            const result = await handler.handle(event);
            results.push(result);
          }

          // All results should be successful
          expect(results.every((r) => r.success)).toBe(true);

          // Scoring service should only be called once
          expect(scoringService.callCount).toBe(1);

          // All results should have the same recommendation ID
          const recommendationIds = results.map((r) => r.recommendationId);
          const uniqueIds = new Set(recommendationIds);
          expect(uniqueIds.size).toBe(1);

          // First result should not be skipped, subsequent should be skipped
          expect(results[0].skipped).toBe(false);
          for (let i = 1; i < results.length; i++) {
            expect(results[i].skipped).toBe(true);
            expect(results[i].skipReason).toContain('idempotency');
          }
        }
      ),
      propertyConfig
    );
  });

  /**
   * **Validates: Requirements 4.5**
   * 
   * Property: The recommendation ID should be deterministically derived from jobId,
   * ensuring the same jobId always produces the same recommendationId.
   */
  it('recommendation ID should be deterministic based on jobId', () => {
    fc.assert(
      fc.property(validUuid, (jobId) => {
        // Generate recommendation ID multiple times
        const id1 = generateRecommendationId(jobId);
        const id2 = generateRecommendationId(jobId);
        const id3 = generateRecommendationId(jobId);

        // All should be identical
        expect(id1).toBe(id2);
        expect(id2).toBe(id3);

        // Should contain the jobId
        expect(id1).toContain(jobId);
      }),
      propertyConfig
    );
  });

  /**
   * **Validates: Requirements 4.5**
   * 
   * Property: Different jobIds should produce different recommendationIds.
   */
  it('different jobIds should produce different recommendationIds', () => {
    fc.assert(
      fc.property(validUuid, validUuid, (jobId1, jobId2) => {
        fc.pre(jobId1 !== jobId2);

        const recId1 = generateRecommendationId(jobId1);
        const recId2 = generateRecommendationId(jobId2);

        expect(recId1).not.toBe(recId2);
      }),
      propertyConfig
    );
  });

  /**
   * **Validates: Requirements 4.5**
   * 
   * Property: Events with different jobIds should each be processed independently.
   */
  it('different jobs should each be processed independently', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(validJobCreatedEvent, { minLength: 2, maxLength: 5 }),
        async (events) => {
          // Ensure all events have unique jobIds
          const jobIds = events.map((e) => e.data.jobId);
          fc.pre(new Set(jobIds).size === jobIds.length);

          // Reset state
          idempotencyStore.clear();
          scoringService.reset();

          // Process all events
          const results = await Promise.all(events.map((e) => handler.handle(e)));

          // All should succeed
          expect(results.every((r) => r.success)).toBe(true);

          // None should be skipped (all unique)
          expect(results.every((r) => !r.skipped)).toBe(true);

          // Scoring service should be called once per unique job
          expect(scoringService.callCount).toBe(events.length);

          // Each should have a unique recommendation ID
          const recommendationIds = results.map((r) => r.recommendationId);
          expect(new Set(recommendationIds).size).toBe(events.length);
        }
      ),
      propertyConfig
    );
  });

  /**
   * **Validates: Requirements 4.5**
   * 
   * Property: The idempotency store should correctly track processed jobs.
   */
  it('idempotency store should track processed jobs correctly', async () => {
    await fc.assert(
      fc.asyncProperty(validJobCreatedEvent, async (event) => {
        // Reset state
        idempotencyStore.clear();
        scoringService.reset();

        const jobId = event.data.jobId;

        // Before processing, job should not be in store
        const beforeProcessing = await idempotencyStore.getProcessedJob(jobId);
        expect(beforeProcessing).toBeNull();

        // Process the event
        await handler.handle(event);

        // After processing, job should be in store
        const afterProcessing = await idempotencyStore.getProcessedJob(jobId);
        expect(afterProcessing).not.toBeNull();
        expect(afterProcessing).toBe(generateRecommendationId(jobId));
      }),
      propertyConfig
    );
  });

  /**
   * **Validates: Requirements 4.5**
   * 
   * Property: Correlation ID should be preserved in the result.
   */
  it('correlation ID should be preserved in handler result', async () => {
    await fc.assert(
      fc.asyncProperty(validJobCreatedEvent, async (event) => {
        idempotencyStore.clear();
        scoringService.reset();

        const result = await handler.handle(event);

        expect(result.correlationId).toBe(event.correlationId);
      }),
      propertyConfig
    );
  });

  /**
   * **Validates: Requirements 4.5**
   * 
   * Property: Invalid events should be rejected without affecting idempotency store.
   */
  it('invalid events should not affect idempotency store', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          eventId: validUuid,
          eventType: fc.constant('JobCreated'),
          timestamp: fc.date(),
          correlationId: validUuid,
          data: fc.record({
            jobId: fc.constant('not-a-valid-uuid'), // Invalid UUID
            jobType: fc.constant('repair'),
            location: validGeoLocation,
            urgencyLevel: fc.constant('medium'),
            slaDeadline: fc.date(),
            requiredCertifications: fc.array(fc.string()),
            customerDetails: validCustomerDetails,
          }),
        }),
        async (invalidEvent) => {
          idempotencyStore.clear();
          scoringService.reset();

          const initialSize = idempotencyStore.size();

          const result = await handler.handle(invalidEvent);

          // Should fail validation
          expect(result.success).toBe(false);
          expect(result.error).toContain('Validation failed');

          // Store should not be modified
          expect(idempotencyStore.size()).toBe(initialSize);

          // Scoring service should not be called
          expect(scoringService.callCount).toBe(0);
        }
      ),
      propertyConfig
    );
  });
});
