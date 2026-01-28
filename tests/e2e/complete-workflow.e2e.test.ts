/**
 * E2E Tests for Complete Workflow
 *
 * Tests the full flow from job creation to vendor assignment,
 * including the override workflow.
 *
 * @requirement 14.3 - E2E tests for complete workflow
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import express, { Express } from 'express';
import request from 'supertest';

import { createApp } from '../../src/backend/api/src/index.js';
import {
  JobCreatedHandler,
  InMemoryIdempotencyStore,
  generateRecommendationId,
  type ScoringService,
} from '../../src/backend/event-integration/src/handlers/job-created-handler.js';
import {
  RecommendationPublisher,
  InMemoryEventTransport,
} from '../../src/backend/event-integration/src/publishers/recommendation-publisher.js';
import {
  clearAuditLog,
  getAuditLog,
} from '../../src/backend/api/src/routes/overrides.js';
import type { JobCreatedEvent, VendorRecommendation } from '@retailfixit/shared';

// Test fixtures
const createJobCreatedEvent = (overrides: Partial<JobCreatedEvent['data']> = {}): JobCreatedEvent => ({
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
    slaDeadline: new Date(Date.now() + 86400000),
    requiredCertifications: ['HVAC'],
    customerDetails: {
      customerId: crypto.randomUUID(),
      tier: 'standard',
    },
    ...overrides,
  },
});

const createMockVendorRecommendations = (): VendorRecommendation[] => [
  {
    rank: 1,
    vendorId: crypto.randomUUID(),
    vendorName: 'Premier Repair Services',
    overallScore: 0.92,
    confidence: 0.88,
    scoreBreakdown: {
      ruleBasedScore: 0.9,
      mlScore: 0.94,
      factors: [
        { name: 'availability', value: 0.95, weight: 0.25, contribution: 0.2375, explanation: 'Vendor is available' },
        { name: 'proximity', value: 0.88, weight: 0.2, contribution: 0.176, explanation: '5 miles away' },
        { name: 'certification', value: 1.0, weight: 0.2, contribution: 0.2, explanation: 'All certs met' },
        { name: 'capacity', value: 0.8, weight: 0.15, contribution: 0.12, explanation: '80% capacity' },
        { name: 'historicalCompletion', value: 0.93, weight: 0.2, contribution: 0.186, explanation: '93% completion' },
      ],
    },
    rationale: 'Best match based on availability and proximity',
    riskFactors: [],
    estimatedResponseTime: '1-2 hours',
  },
  {
    rank: 2,
    vendorId: crypto.randomUUID(),
    vendorName: 'QuickFix Solutions',
    overallScore: 0.85,
    confidence: 0.82,
    scoreBreakdown: {
      ruleBasedScore: 0.83,
      mlScore: 0.87,
      factors: [
        { name: 'availability', value: 0.9, weight: 0.25, contribution: 0.225, explanation: 'Vendor is available' },
        { name: 'proximity', value: 0.75, weight: 0.2, contribution: 0.15, explanation: '12 miles away' },
        { name: 'certification', value: 1.0, weight: 0.2, contribution: 0.2, explanation: 'All certs met' },
        { name: 'capacity', value: 0.7, weight: 0.15, contribution: 0.105, explanation: '70% capacity' },
        { name: 'historicalCompletion', value: 0.88, weight: 0.2, contribution: 0.176, explanation: '88% completion' },
      ],
    },
    rationale: 'Good alternative with slightly lower score',
    riskFactors: ['Distance may affect response time'],
    estimatedResponseTime: '2-4 hours',
  },
  {
    rank: 3,
    vendorId: crypto.randomUUID(),
    vendorName: 'Reliable Maintenance Co',
    overallScore: 0.78,
    confidence: 0.75,
    scoreBreakdown: {
      ruleBasedScore: 0.76,
      mlScore: 0.8,
      factors: [
        { name: 'availability', value: 0.85, weight: 0.25, contribution: 0.2125, explanation: 'Vendor is available' },
        { name: 'proximity', value: 0.65, weight: 0.2, contribution: 0.13, explanation: '18 miles away' },
        { name: 'certification', value: 0.9, weight: 0.2, contribution: 0.18, explanation: 'Most certs met' },
        { name: 'capacity', value: 0.75, weight: 0.15, contribution: 0.1125, explanation: '75% capacity' },
        { name: 'historicalCompletion', value: 0.82, weight: 0.2, contribution: 0.164, explanation: '82% completion' },
      ],
    },
    rationale: 'Third option with acceptable score',
    riskFactors: ['Distance may affect response time', 'Missing some certifications'],
    estimatedResponseTime: '2-4 hours',
  },
];

/**
 * Mock scoring service that generates recommendations
 */
class MockScoringService implements ScoringService {
  public recommendations: VendorRecommendation[] = createMockVendorRecommendations();
  public callCount = 0;

  async generateRecommendations(event: JobCreatedEvent): Promise<string> {
    this.callCount++;
    return generateRecommendationId(event.data.jobId);
  }

  reset(): void {
    this.callCount = 0;
    this.recommendations = createMockVendorRecommendations();
  }
}

describe('Complete Workflow E2E Tests', () => {
  let app: Express;
  let idempotencyStore: InMemoryIdempotencyStore;
  let scoringService: MockScoringService;
  let eventHandler: JobCreatedHandler;
  let eventTransport: InMemoryEventTransport;
  let publisher: RecommendationPublisher;

  beforeEach(() => {
    // Set up API
    app = createApp({
      enableSwagger: false,
      enableRateLimiting: false,
      auth: {
        tenantId: 'test-tenant',
        clientId: 'test-client',
        audience: 'api://retailfixit',
        skipAuth: true,
      },
    });

    // Set up event processing
    idempotencyStore = new InMemoryIdempotencyStore();
    scoringService = new MockScoringService();
    eventHandler = new JobCreatedHandler(idempotencyStore, scoringService);
    eventTransport = new InMemoryEventTransport();
    publisher = new RecommendationPublisher(eventTransport);

    // Clear audit log
    clearAuditLog();
  });

  describe('Job Creation to Vendor Assignment Flow', () => {
    it('completes full flow from job creation to recommendation', async () => {
      // Step 1: Create a job event
      const jobEvent = createJobCreatedEvent();
      const correlationId = jobEvent.correlationId;

      // Step 2: Process the job event
      const handlerResult = await eventHandler.handle(jobEvent);
      expect(handlerResult.success).toBe(true);
      expect(handlerResult.skipped).toBe(false);
      expect(handlerResult.correlationId).toBe(correlationId);

      // Step 3: Publish recommendation event
      const recommendations = scoringService.recommendations;
      const publishResult = await publisher.publish({
        jobId: jobEvent.data.jobId,
        correlationId,
        recommendations,
        modelVersion: '1.0.0',
        processingTimeMs: 150,
        automationLevel: 'advisory',
        degradedMode: false,
      });

      expect(publishResult.success).toBe(true);
      expect(publishResult.correlationId).toBe(correlationId);

      // Step 4: Verify recommendation event was published
      const publishedEvents = eventTransport.getEvents();
      expect(publishedEvents).toHaveLength(1);
      expect(publishedEvents[0].data.jobId).toBe(jobEvent.data.jobId);
      expect(publishedEvents[0].data.recommendations).toHaveLength(3);
      expect(publishedEvents[0].correlationId).toBe(correlationId);
    });

    it('maintains correlation ID throughout the entire flow', async () => {
      const jobEvent = createJobCreatedEvent();
      const correlationId = jobEvent.correlationId;

      // Process event
      const handlerResult = await eventHandler.handle(jobEvent);
      expect(handlerResult.correlationId).toBe(correlationId);

      // Publish recommendation
      await publisher.publish({
        jobId: jobEvent.data.jobId,
        correlationId,
        recommendations: scoringService.recommendations,
        modelVersion: '1.0.0',
        processingTimeMs: 100,
        automationLevel: 'auto',
        degradedMode: false,
      });

      // Verify correlation ID in published event
      const publishedEvents = eventTransport.getEvents();
      expect(publishedEvents[0].correlationId).toBe(correlationId);

      // Make API call with same correlation ID
      const apiResponse = await request(app)
        .post('/api/v1/recommendations')
        .send({
          jobId: jobEvent.data.jobId,
          jobType: jobEvent.data.jobType,
          location: jobEvent.data.location,
          urgencyLevel: jobEvent.data.urgencyLevel,
          slaDeadline: jobEvent.data.slaDeadline.toISOString(),
          requiredCertifications: jobEvent.data.requiredCertifications,
          customerTier: jobEvent.data.customerDetails.tier,
        })
        .set('Content-Type', 'application/json')
        .set('X-Correlation-ID', correlationId);

      expect(apiResponse.status).toBe(200);
      expect(apiResponse.headers['x-correlation-id']).toBe(correlationId);
    });

    it('handles multiple jobs in parallel', async () => {
      const jobs = [
        createJobCreatedEvent(),
        createJobCreatedEvent(),
        createJobCreatedEvent(),
      ];

      // Process all jobs in parallel
      const results = await Promise.all(jobs.map((job) => eventHandler.handle(job)));

      // All should succeed
      expect(results.every((r) => r.success)).toBe(true);
      expect(results.every((r) => !r.skipped)).toBe(true);

      // Each should have unique recommendation ID
      const recommendationIds = results.map((r) => r.recommendationId);
      expect(new Set(recommendationIds).size).toBe(3);
    });
  });

  describe('Override Workflow', () => {
    it('completes override workflow with audit logging', async () => {
      // Step 1: Create job and get recommendations
      const jobEvent = createJobCreatedEvent();
      await eventHandler.handle(jobEvent);

      const recommendations = scoringService.recommendations;
      const originalVendorId = recommendations[0].vendorId;
      const selectedVendorId = recommendations[1].vendorId;

      // Step 2: Submit override via API
      const overrideResponse = await request(app)
        .post('/api/v1/overrides')
        .send({
          jobId: jobEvent.data.jobId,
          originalVendorId,
          selectedVendorId,
          overrideReason: 'Customer has existing relationship with this vendor and prefers them',
          overrideCategory: 'relationship',
        })
        .set('Content-Type', 'application/json')
        .set('X-Correlation-ID', jobEvent.correlationId);

      expect(overrideResponse.status).toBe(201);
      expect(overrideResponse.body.jobId).toBe(jobEvent.data.jobId);
      expect(overrideResponse.body.originalVendorId).toBe(originalVendorId);
      expect(overrideResponse.body.selectedVendorId).toBe(selectedVendorId);

      // Step 3: Verify audit log
      const auditLog = getAuditLog();
      expect(auditLog).toHaveLength(1);
      expect(auditLog[0].jobId).toBe(jobEvent.data.jobId);
      expect(auditLog[0].originalVendorId).toBe(originalVendorId);
      expect(auditLog[0].selectedVendorId).toBe(selectedVendorId);
      expect(auditLog[0].correlationId).toBe(jobEvent.correlationId);
    });

    it('retrieves override history for a job', async () => {
      const jobEvent = createJobCreatedEvent();
      await eventHandler.handle(jobEvent);

      const recommendations = scoringService.recommendations;

      // Create multiple overrides for the same job
      await request(app)
        .post('/api/v1/overrides')
        .send({
          jobId: jobEvent.data.jobId,
          originalVendorId: recommendations[0].vendorId,
          selectedVendorId: recommendations[1].vendorId,
          overrideReason: 'First override - customer preference',
          overrideCategory: 'preference',
        })
        .set('Content-Type', 'application/json');

      await request(app)
        .post('/api/v1/overrides')
        .send({
          jobId: jobEvent.data.jobId,
          originalVendorId: recommendations[1].vendorId,
          selectedVendorId: recommendations[2].vendorId,
          overrideReason: 'Second override - availability issue',
          overrideCategory: 'availability',
        })
        .set('Content-Type', 'application/json');

      // Retrieve override history
      const historyResponse = await request(app)
        .get(`/api/v1/overrides/${jobEvent.data.jobId}`);

      expect(historyResponse.status).toBe(200);
      expect(historyResponse.body.overrides).toHaveLength(2);
    });

    it('rejects override without reason', async () => {
      const jobEvent = createJobCreatedEvent();
      await eventHandler.handle(jobEvent);

      const recommendations = scoringService.recommendations;

      const response = await request(app)
        .post('/api/v1/overrides')
        .send({
          jobId: jobEvent.data.jobId,
          originalVendorId: recommendations[0].vendorId,
          selectedVendorId: recommendations[1].vendorId,
          overrideReason: '', // Empty reason
          overrideCategory: 'preference',
        })
        .set('Content-Type', 'application/json');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('ValidationError');

      // Verify no audit log entry
      const auditLog = getAuditLog();
      expect(auditLog).toHaveLength(0);
    });
  });

  describe('Idempotency in Complete Flow', () => {
    it('prevents duplicate processing when same job is submitted multiple times', async () => {
      const jobEvent = createJobCreatedEvent();

      // Process the same event multiple times
      const result1 = await eventHandler.handle(jobEvent);
      const result2 = await eventHandler.handle(jobEvent);
      const result3 = await eventHandler.handle(jobEvent);

      // First should process, others should skip
      expect(result1.success).toBe(true);
      expect(result1.skipped).toBe(false);

      expect(result2.success).toBe(true);
      expect(result2.skipped).toBe(true);

      expect(result3.success).toBe(true);
      expect(result3.skipped).toBe(true);

      // All should have same recommendation ID
      expect(result1.recommendationId).toBe(result2.recommendationId);
      expect(result2.recommendationId).toBe(result3.recommendationId);

      // Scoring service should only be called once
      expect(scoringService.callCount).toBe(1);
    });
  });

  describe('Error Handling in Complete Flow', () => {
    it('handles invalid job event gracefully', async () => {
      const invalidEvent = {
        eventId: crypto.randomUUID(),
        eventType: 'JobCreated',
        timestamp: new Date(),
        correlationId: crypto.randomUUID(),
        data: {
          // Missing required fields
          jobType: 'repair',
        },
      };

      const result = await eventHandler.handle(invalidEvent);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Validation failed');
    });

    it('handles API validation errors gracefully', async () => {
      const response = await request(app)
        .post('/api/v1/recommendations')
        .send({
          // Invalid request
          jobId: 'not-a-uuid',
          jobType: 'invalid_type',
        })
        .set('Content-Type', 'application/json');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('ValidationError');
      expect(response.body.details).toBeDefined();
    });
  });

  describe('Automation Level Handling', () => {
    it('sets advisory mode for low confidence recommendations', async () => {
      const jobEvent = createJobCreatedEvent();
      await eventHandler.handle(jobEvent);

      // Create low confidence recommendations
      const lowConfidenceRecommendations = scoringService.recommendations.map((r) => ({
        ...r,
        confidence: 0.5, // Below 70% threshold
      }));

      await publisher.publish({
        jobId: jobEvent.data.jobId,
        correlationId: jobEvent.correlationId,
        recommendations: lowConfidenceRecommendations,
        modelVersion: '1.0.0',
        processingTimeMs: 100,
        automationLevel: 'auto', // Request auto, but should be downgraded
        degradedMode: false,
      });

      const publishedEvents = eventTransport.getEvents();
      expect(publishedEvents[0].data.automationLevel).toBe('advisory');
    });

    it('sets advisory mode for degraded mode', async () => {
      const jobEvent = createJobCreatedEvent();
      await eventHandler.handle(jobEvent);

      await publisher.publish({
        jobId: jobEvent.data.jobId,
        correlationId: jobEvent.correlationId,
        recommendations: scoringService.recommendations,
        modelVersion: '1.0.0',
        processingTimeMs: 100,
        automationLevel: 'auto',
        degradedMode: true, // ML fallback mode
      });

      const publishedEvents = eventTransport.getEvents();
      expect(publishedEvents[0].data.automationLevel).toBe('advisory');
      expect(publishedEvents[0].data.degradedMode).toBe(true);
    });
  });
});
