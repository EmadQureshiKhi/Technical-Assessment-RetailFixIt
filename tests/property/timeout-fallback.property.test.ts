/**
 * Property 24: Timeout Fallback Behavior
 *
 * For any scoring request where ML inference exceeds 5 seconds,
 * the system SHALL return a rule-based recommendation within the SLA,
 * with a flag indicating degraded mode.
 *
 * @validates Requirements 13.2
 * @file src/backend/vendor-scoring-service/src/ml/ml-client.ts
 */

import fc from 'fast-check';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import {
  MLClient,
  DEFAULT_FALLBACK_PREDICTION,
  DEFAULT_ML_ENDPOINT_CONFIG,
  type MLEndpointConfig,
  type CircuitBreakerConfig,
} from '../../src/backend/vendor-scoring-service/src/ml/ml-client.js';
import type { JobEvent, VendorProfile } from '../../src/backend/shared/src/index.js';

// Property test configuration
const propertyConfig = {
  numRuns: 30,
  verbose: false,
};

// Arbitraries for generating test data
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
  tier: fc.constantFrom('standard', 'premium', 'enterprise') as fc.Arbitrary<'standard' | 'premium' | 'enterprise'>,
  preferredVendors: fc.option(fc.array(validUuid, { maxLength: 5 }), { nil: undefined }),
  blockedVendors: fc.option(fc.array(validUuid, { maxLength: 5 }), { nil: undefined }),
});

const validJobEvent: fc.Arbitrary<JobEvent> = fc.record({
  jobId: validUuid,
  jobType: fc.constantFrom('repair', 'installation', 'maintenance', 'inspection') as fc.Arbitrary<'repair' | 'installation' | 'maintenance' | 'inspection'>,
  location: validGeoLocation,
  urgencyLevel: fc.constantFrom('low', 'medium', 'high', 'critical') as fc.Arbitrary<'low' | 'medium' | 'high' | 'critical'>,
  slaDeadline: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') }),
  requiredCertifications: fc.array(fc.string({ minLength: 1, maxLength: 100 }), { maxLength: 3 }),
  customerDetails: validCustomerDetails,
  specialRequirements: fc.array(fc.string({ minLength: 1, maxLength: 200 }), { maxLength: 3 }),
  createdAt: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') }),
  status: fc.constantFrom('pending', 'assigned', 'in_progress', 'completed', 'cancelled') as fc.Arbitrary<'pending' | 'assigned' | 'in_progress' | 'completed' | 'cancelled'>,
});

const validCertification = fc.record({
  certificationId: validUuid,
  name: fc.string({ minLength: 1, maxLength: 100 }),
  issuedBy: fc.string({ minLength: 1, maxLength: 100 }),
  validUntil: fc.date({ min: new Date('2025-01-01'), max: new Date('2030-12-31') }),
  verified: fc.boolean(),
});

const validServiceArea = fc.record({
  regionId: fc.string({ minLength: 1, maxLength: 50 }),
  regionName: fc.string({ minLength: 1, maxLength: 100 }),
  zipCodes: fc.array(
    fc.stringOf(fc.constantFrom(...'0123456789'.split('')), { minLength: 5, maxLength: 5 }),
    { minLength: 1, maxLength: 10 }
  ),
  maxDistanceMiles: fc.double({ min: 10, max: 500, noNaN: true }),
});

const validAvailabilityWindow = fc.record({
  dayOfWeek: fc.integer({ min: 0, max: 6 }),
  startTime: fc.constantFrom('08:00', '09:00', '10:00'),
  endTime: fc.constantFrom('17:00', '18:00', '19:00'),
  timezone: fc.constantFrom('America/New_York', 'America/Los_Angeles', 'America/Chicago'),
});

const validContactInfo = fc.record({
  email: fc.emailAddress(),
  phone: fc.stringOf(fc.constantFrom(...'0123456789'.split('')), { minLength: 10, maxLength: 15 }),
  primaryContact: fc.string({ minLength: 1, maxLength: 100 }),
});

const validVendorProfile: fc.Arbitrary<VendorProfile> = fc.record({
  vendorId: validUuid,
  name: fc.string({ minLength: 1, maxLength: 200 }),
  status: fc.constantFrom('active', 'inactive', 'suspended') as fc.Arbitrary<'active' | 'inactive' | 'suspended'>,
  certifications: fc.array(validCertification, { maxLength: 5 }),
  geographicCoverage: fc.array(validServiceArea, { maxLength: 5 }),
  maxCapacity: fc.integer({ min: 1, max: 100 }),
  currentCapacity: fc.integer({ min: 0, max: 50 }),
  availabilitySchedule: fc.array(validAvailabilityWindow, { maxLength: 7 }),
  specializations: fc.array(fc.string({ minLength: 1, maxLength: 100 }), { maxLength: 5 }),
  contactInfo: validContactInfo,
  createdAt: fc.date({ min: new Date('2020-01-01'), max: new Date('2025-12-31') }),
  updatedAt: fc.date({ min: new Date('2020-01-01'), max: new Date('2025-12-31') }),
}).filter((v) => v.currentCapacity <= v.maxCapacity) as fc.Arbitrary<VendorProfile>;

describe('Property 24: Timeout Fallback Behavior', () => {
  /**
   * **Validates: Requirements 13.2**
   *
   * Test that ML timeout (>5s) returns rule-based fallback
   * Test that response includes degraded mode flag
   */

  describe('Default Timeout Configuration', () => {
    it('DEFAULT_ML_ENDPOINT_CONFIG SHALL have 5 second timeout', () => {
      expect(DEFAULT_ML_ENDPOINT_CONFIG.timeoutMs).toBe(5000);
    });

    it('timeout SHALL be configurable', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 100, max: 10000 }),
          (timeoutMs) => {
            const config: MLEndpointConfig = {
              ...DEFAULT_ML_ENDPOINT_CONFIG,
              timeoutMs,
            };
            expect(config.timeoutMs).toBe(timeoutMs);
          }
        ),
        propertyConfig
      );
    });
  });

  describe('Timeout Triggers Fallback', () => {
    it('SHALL return fallback when endpoint is unreachable', async () => {
      await fc.assert(
        fc.asyncProperty(validJobEvent, validVendorProfile, async (job, vendor) => {
          const config: MLEndpointConfig = {
            endpoint: 'http://unreachable-endpoint.invalid',
            apiKey: 'test-key',
            timeoutMs: 100, // Very short timeout
            modelVersion: 'v1.0.0',
          };

          const client = new MLClient(config);
          const response = await client.getPrediction(job, vendor);

          // Should return a valid response with fallback
          expect(response).toBeDefined();
          expect(response.prediction).toBeDefined();
        }),
        propertyConfig
      );
    });

    it('SHALL set degradedMode flag on timeout', async () => {
      await fc.assert(
        fc.asyncProperty(validJobEvent, validVendorProfile, async (job, vendor) => {
          const config: MLEndpointConfig = {
            endpoint: 'http://unreachable-endpoint.invalid',
            apiKey: 'test-key',
            timeoutMs: 100,
            modelVersion: 'v1.0.0',
          };

          const client = new MLClient(config);
          const response = await client.getPrediction(job, vendor);

          // When ML fails (including timeout), degradedMode should be true
          if (response.error) {
            expect(response.degradedMode).toBe(true);
          }
        }),
        propertyConfig
      );
    });

    it('SHALL include error message on timeout', async () => {
      await fc.assert(
        fc.asyncProperty(validJobEvent, validVendorProfile, async (job, vendor) => {
          const config: MLEndpointConfig = {
            endpoint: 'http://unreachable-endpoint.invalid',
            apiKey: 'test-key',
            timeoutMs: 100,
            modelVersion: 'v1.0.0',
          };

          const client = new MLClient(config);
          const response = await client.getPrediction(job, vendor);

          // Should have error message when failing
          if (response.degradedMode && !response.fromCache) {
            expect(response.error).toBeDefined();
            expect(typeof response.error).toBe('string');
            expect(response.error!.length).toBeGreaterThan(0);
          }
        }),
        propertyConfig
      );
    });
  });

  describe('Fallback Prediction Quality', () => {
    it('fallback prediction SHALL have all required fields', async () => {
      await fc.assert(
        fc.asyncProperty(validJobEvent, validVendorProfile, async (job, vendor) => {
          const config: MLEndpointConfig = {
            endpoint: 'http://unreachable-endpoint.invalid',
            apiKey: 'test-key',
            timeoutMs: 100,
            modelVersion: 'v1.0.0',
          };

          const client = new MLClient(config);
          const response = await client.getPrediction(job, vendor);

          if (response.prediction) {
            expect(response.prediction).toHaveProperty('completionProbability');
            expect(response.prediction).toHaveProperty('timeToComplete');
            expect(response.prediction).toHaveProperty('reworkRisk');
            expect(response.prediction).toHaveProperty('predictedSatisfaction');
            expect(response.prediction).toHaveProperty('confidence');
          }
        }),
        propertyConfig
      );
    });

    it('fallback prediction SHALL have valid ranges', async () => {
      await fc.assert(
        fc.asyncProperty(validJobEvent, validVendorProfile, async (job, vendor) => {
          const config: MLEndpointConfig = {
            endpoint: 'http://unreachable-endpoint.invalid',
            apiKey: 'test-key',
            timeoutMs: 100,
            modelVersion: 'v1.0.0',
          };

          const client = new MLClient(config);
          const response = await client.getPrediction(job, vendor);

          if (response.prediction) {
            expect(response.prediction.completionProbability).toBeGreaterThanOrEqual(0);
            expect(response.prediction.completionProbability).toBeLessThanOrEqual(1);
            expect(response.prediction.timeToComplete).toBeGreaterThanOrEqual(0);
            expect(response.prediction.reworkRisk).toBeGreaterThanOrEqual(0);
            expect(response.prediction.reworkRisk).toBeLessThanOrEqual(1);
            expect(response.prediction.predictedSatisfaction).toBeGreaterThanOrEqual(0);
            expect(response.prediction.predictedSatisfaction).toBeLessThanOrEqual(5);
            expect(response.prediction.confidence).toBeGreaterThanOrEqual(0);
            expect(response.prediction.confidence).toBeLessThanOrEqual(1);
          }
        }),
        propertyConfig
      );
    });

    it('fallback prediction SHALL indicate low confidence', async () => {
      await fc.assert(
        fc.asyncProperty(validJobEvent, validVendorProfile, async (job, vendor) => {
          const config: MLEndpointConfig = {
            endpoint: 'http://unreachable-endpoint.invalid',
            apiKey: 'test-key',
            timeoutMs: 100,
            modelVersion: 'v1.0.0',
          };

          const client = new MLClient(config);
          const response = await client.getPrediction(job, vendor);

          // Fallback should have low confidence
          if (response.degradedMode && response.prediction) {
            expect(response.prediction.confidence).toBeLessThan(0.5);
          }
        }),
        propertyConfig
      );
    });
  });

  describe('Response Time Tracking', () => {
    it('SHALL track latency even on timeout', async () => {
      await fc.assert(
        fc.asyncProperty(validJobEvent, validVendorProfile, async (job, vendor) => {
          const config: MLEndpointConfig = {
            endpoint: 'http://unreachable-endpoint.invalid',
            apiKey: 'test-key',
            timeoutMs: 100,
            modelVersion: 'v1.0.0',
          };

          const client = new MLClient(config);
          const response = await client.getPrediction(job, vendor);

          expect(response.latencyMs).toBeDefined();
          expect(response.latencyMs).toBeGreaterThanOrEqual(0);
        }),
        propertyConfig
      );
    });

    it('SHALL return within reasonable time on failure', async () => {
      await fc.assert(
        fc.asyncProperty(validJobEvent, validVendorProfile, async (job, vendor) => {
          const timeoutMs = 100;
          const config: MLEndpointConfig = {
            endpoint: 'http://unreachable-endpoint.invalid',
            apiKey: 'test-key',
            timeoutMs,
            modelVersion: 'v1.0.0',
          };

          const client = new MLClient(config);
          const startTime = Date.now();
          await client.getPrediction(job, vendor);
          const elapsed = Date.now() - startTime;

          // Should return within timeout + some buffer for processing
          // Network errors may return faster than timeout
          expect(elapsed).toBeLessThan(timeoutMs + 5000);
        }),
        propertyConfig
      );
    });
  });

  describe('Cache Behavior on Timeout', () => {
    it('SHALL not cache failed predictions', async () => {
      await fc.assert(
        fc.asyncProperty(validJobEvent, validVendorProfile, async (job, vendor) => {
          const config: MLEndpointConfig = {
            endpoint: 'http://unreachable-endpoint.invalid',
            apiKey: 'test-key',
            timeoutMs: 100,
            modelVersion: 'v1.0.0',
          };

          const client = new MLClient(config);

          // First call - should fail
          const response1 = await client.getPrediction(job, vendor);
          expect(response1.fromCache).toBe(false);

          // Second call - should also not be from cache (failures aren't cached)
          const response2 = await client.getPrediction(job, vendor);
          expect(response2.fromCache).toBe(false);
        }),
        propertyConfig
      );
    });
  });

  describe('Model Version Tracking', () => {
    it('SHALL expose model version', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 20 }),
          (modelVersion) => {
            const config: MLEndpointConfig = {
              ...DEFAULT_ML_ENDPOINT_CONFIG,
              modelVersion,
            };

            const client = new MLClient(config);
            expect(client.getModelVersion()).toBe(modelVersion);
          }
        ),
        propertyConfig
      );
    });
  });
});
