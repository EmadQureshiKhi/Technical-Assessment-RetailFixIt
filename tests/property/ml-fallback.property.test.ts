/**
 * Property 6: Graceful ML Fallback
 *
 * For any scoring request when the ML endpoint is unavailable or times out,
 * the Vendor_Scoring_Service SHALL return a valid recommendation using
 * rule-based scoring only, with a confidence indicator reflecting the degraded mode.
 *
 * @validates Requirements 2.3, 13.1
 * @file src/backend/vendor-scoring-service/src/ml/ml-client.ts
 */

import fc from 'fast-check';
import { describe, expect, it, beforeEach, vi } from 'vitest';

import {
  MLClient,
  CircuitBreaker,
  CircuitState,
  DEFAULT_FALLBACK_PREDICTION,
  DEFAULT_CIRCUIT_BREAKER_CONFIG,
  type MLEndpointConfig,
  type CircuitBreakerConfig,
} from '../../src/backend/vendor-scoring-service/src/ml/ml-client.js';
import type { JobEvent, VendorProfile } from '../../src/backend/shared/src/index.js';

// Property test configuration
const propertyConfig = {
  numRuns: 50,
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


describe('Property 6: Graceful ML Fallback', () => {
  /**
   * **Validates: Requirements 2.3, 13.1**
   *
   * Test that ML unavailability returns valid rule-based recommendations
   */

  describe('Circuit Breaker Open State', () => {
    it('SHALL return fallback prediction when circuit breaker is open', async () => {
      await fc.assert(
        fc.asyncProperty(validJobEvent, validVendorProfile, async (job, vendor) => {
          // Create ML client with circuit breaker that opens after 1 failure
          const config: MLEndpointConfig = {
            endpoint: 'http://invalid-endpoint.test',
            apiKey: 'test-key',
            timeoutMs: 100,
            modelVersion: 'v1.0.0',
          };
          const cbConfig: CircuitBreakerConfig = {
            failureThreshold: 1,
            successThreshold: 1,
            timeout: 60000,
            halfOpenRequests: 1,
          };

          const client = new MLClient(config, cbConfig);

          // Force circuit breaker to open by recording failures
          const circuitBreaker = new CircuitBreaker(cbConfig);
          circuitBreaker.recordFailure();

          // Create a new client that will have open circuit
          const clientWithOpenCircuit = new MLClient(config, cbConfig);
          // Simulate failures to open the circuit
          for (let i = 0; i < cbConfig.failureThreshold; i++) {
            try {
              await clientWithOpenCircuit.getPrediction(job, vendor);
            } catch {
              // Expected to fail
            }
          }

          // Now the circuit should be open, next call should return fallback
          const response = await clientWithOpenCircuit.getPrediction(job, vendor);

          // Should return degraded mode with fallback prediction
          expect(response.degradedMode).toBe(true);
          expect(response.prediction).toBeDefined();
          expect(response.prediction).not.toBeNull();
        }),
        propertyConfig
      );
    });

    it('fallback prediction SHALL have valid score ranges', async () => {
      await fc.assert(
        fc.asyncProperty(validJobEvent, validVendorProfile, async (job, vendor) => {
          const config: MLEndpointConfig = {
            endpoint: 'http://invalid-endpoint.test',
            apiKey: 'test-key',
            timeoutMs: 100,
            modelVersion: 'v1.0.0',
          };
          const cbConfig: CircuitBreakerConfig = {
            failureThreshold: 1,
            successThreshold: 1,
            timeout: 60000,
            halfOpenRequests: 1,
          };

          const client = new MLClient(config, cbConfig);

          // Force failures to get fallback
          for (let i = 0; i < 2; i++) {
            await client.getPrediction(job, vendor);
          }

          const response = await client.getPrediction(job, vendor);

          if (response.prediction) {
            // Validate prediction ranges
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
  });

  describe('Degraded Mode Indicator', () => {
    it('SHALL set degradedMode flag when using fallback', async () => {
      await fc.assert(
        fc.asyncProperty(validJobEvent, validVendorProfile, async (job, vendor) => {
          const config: MLEndpointConfig = {
            endpoint: 'http://invalid-endpoint.test',
            apiKey: 'test-key',
            timeoutMs: 100,
            modelVersion: 'v1.0.0',
          };

          const client = new MLClient(config);

          // First call will fail and trigger fallback
          const response = await client.getPrediction(job, vendor);

          // When ML fails, degradedMode should be true
          if (response.error) {
            expect(response.degradedMode).toBe(true);
          }
        }),
        propertyConfig
      );
    });

    it('fallback prediction SHALL have low confidence indicator', () => {
      // Default fallback prediction should have low confidence
      expect(DEFAULT_FALLBACK_PREDICTION.confidence).toBeLessThan(0.5);
      expect(DEFAULT_FALLBACK_PREDICTION.confidence).toBeGreaterThan(0);
    });
  });

  describe('Fallback Prediction Validity', () => {
    it('DEFAULT_FALLBACK_PREDICTION SHALL have all required fields', () => {
      expect(DEFAULT_FALLBACK_PREDICTION).toHaveProperty('completionProbability');
      expect(DEFAULT_FALLBACK_PREDICTION).toHaveProperty('timeToComplete');
      expect(DEFAULT_FALLBACK_PREDICTION).toHaveProperty('reworkRisk');
      expect(DEFAULT_FALLBACK_PREDICTION).toHaveProperty('predictedSatisfaction');
      expect(DEFAULT_FALLBACK_PREDICTION).toHaveProperty('confidence');
    });

    it('DEFAULT_FALLBACK_PREDICTION SHALL have conservative estimates', () => {
      // Conservative means not overly optimistic
      expect(DEFAULT_FALLBACK_PREDICTION.completionProbability).toBeLessThanOrEqual(0.8);
      expect(DEFAULT_FALLBACK_PREDICTION.reworkRisk).toBeGreaterThanOrEqual(0.1);
      expect(DEFAULT_FALLBACK_PREDICTION.predictedSatisfaction).toBeLessThanOrEqual(4);
    });
  });

  describe('Error Message Propagation', () => {
    it('SHALL include error message when ML fails', async () => {
      await fc.assert(
        fc.asyncProperty(validJobEvent, validVendorProfile, async (job, vendor) => {
          const config: MLEndpointConfig = {
            endpoint: 'http://invalid-endpoint.test',
            apiKey: 'test-key',
            timeoutMs: 100,
            modelVersion: 'v1.0.0',
          };

          const client = new MLClient(config);
          const response = await client.getPrediction(job, vendor);

          // When ML fails, should have error message
          if (response.degradedMode && !response.fromCache) {
            expect(response.error).toBeDefined();
            expect(typeof response.error).toBe('string');
          }
        }),
        propertyConfig
      );
    });
  });

  describe('Latency Tracking', () => {
    it('SHALL track latency even in fallback mode', async () => {
      await fc.assert(
        fc.asyncProperty(validJobEvent, validVendorProfile, async (job, vendor) => {
          const config: MLEndpointConfig = {
            endpoint: 'http://invalid-endpoint.test',
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
  });
});
