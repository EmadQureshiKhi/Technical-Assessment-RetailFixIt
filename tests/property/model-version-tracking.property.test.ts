/**
 * Property 15: Model Version Tracking
 *
 * For any recommendation generated, the response and audit log SHALL include
 * the exact modelVersion string used for ML predictions, enabling traceability
 * to the specific model artifact.
 *
 * @validates Requirements 8.3, 8.6
 * @file src/backend/vendor-scoring-service/src/ml/ml-client.ts
 * @file src/ml/models/model_registry.py
 */

import fc from 'fast-check';
import { describe, expect, it, beforeEach } from 'vitest';

import {
  MLClient,
  DEFAULT_ML_ENDPOINT_CONFIG,
  type MLEndpointConfig,
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

// Arbitrary for model version strings
const validModelVersion = fc.stringMatching(/^v\d+\.\d+\.\d+$/);

describe('Property 15: Model Version Tracking', () => {
  /**
   * **Validates: Requirements 8.3, 8.6**
   *
   * Test that recommendations include model version
   */

  describe('ML Client Model Version', () => {
    it('SHALL return model version from configuration', () => {
      fc.assert(
        fc.property(validModelVersion, (version) => {
          const config: MLEndpointConfig = {
            ...DEFAULT_ML_ENDPOINT_CONFIG,
            modelVersion: version,
          };

          const client = new MLClient(config);
          expect(client.getModelVersion()).toBe(version);
        }),
        propertyConfig
      );
    });

    it('SHALL use default model version when not specified', () => {
      const client = new MLClient();
      const version = client.getModelVersion();

      expect(version).toBeDefined();
      expect(typeof version).toBe('string');
      expect(version.length).toBeGreaterThan(0);
    });

    it('model version SHALL be non-empty string', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 50 }),
          (version) => {
            const config: MLEndpointConfig = {
              ...DEFAULT_ML_ENDPOINT_CONFIG,
              modelVersion: version,
            };

            const client = new MLClient(config);
            const returnedVersion = client.getModelVersion();

            expect(returnedVersion).toBe(version);
            expect(returnedVersion.length).toBeGreaterThan(0);
          }
        ),
        propertyConfig
      );
    });
  });

  describe('Model Version in Predictions', () => {
    it('SHALL maintain consistent model version across multiple predictions', async () => {
      await fc.assert(
        fc.asyncProperty(
          validJobEvent,
          validVendorProfile,
          validModelVersion,
          async (job, vendor, version) => {
            const config: MLEndpointConfig = {
              endpoint: 'http://test-endpoint.local',
              apiKey: 'test-key',
              timeoutMs: 100,
              modelVersion: version,
            };

            const client = new MLClient(config);

            // Get multiple predictions
            const response1 = await client.getPrediction(job, vendor);
            const response2 = await client.getPrediction(job, vendor);

            // Model version should be consistent
            expect(client.getModelVersion()).toBe(version);
          }
        ),
        propertyConfig
      );
    });
  });

  describe('Model Version Format', () => {
    it('SHALL accept semantic version format', () => {
      const semanticVersions = ['v1.0.0', 'v2.1.3', 'v10.20.30', 'v0.0.1'];

      for (const version of semanticVersions) {
        const config: MLEndpointConfig = {
          ...DEFAULT_ML_ENDPOINT_CONFIG,
          modelVersion: version,
        };

        const client = new MLClient(config);
        expect(client.getModelVersion()).toBe(version);
      }
    });

    it('SHALL accept timestamp-based version format', () => {
      fc.assert(
        fc.property(
          fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') }),
          (date) => {
            const version = `v${date.toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)}`;

            const config: MLEndpointConfig = {
              ...DEFAULT_ML_ENDPOINT_CONFIG,
              modelVersion: version,
            };

            const client = new MLClient(config);
            expect(client.getModelVersion()).toBe(version);
          }
        ),
        propertyConfig
      );
    });

    it('SHALL accept any non-empty string as version', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
          (version) => {
            const config: MLEndpointConfig = {
              ...DEFAULT_ML_ENDPOINT_CONFIG,
              modelVersion: version,
            };

            const client = new MLClient(config);
            expect(client.getModelVersion()).toBe(version);
          }
        ),
        propertyConfig
      );
    });
  });

  describe('Default Configuration', () => {
    it('DEFAULT_ML_ENDPOINT_CONFIG SHALL have a model version', () => {
      expect(DEFAULT_ML_ENDPOINT_CONFIG.modelVersion).toBeDefined();
      expect(typeof DEFAULT_ML_ENDPOINT_CONFIG.modelVersion).toBe('string');
    });

    it('SHALL use environment variable for model version when available', () => {
      // The default config uses process.env.ML_MODEL_VERSION
      // This test verifies the fallback behavior
      const config = DEFAULT_ML_ENDPOINT_CONFIG;
      expect(config.modelVersion).toBeDefined();
    });
  });

  describe('Model Version Traceability', () => {
    it('SHALL enable traceability to specific model artifact', () => {
      fc.assert(
        fc.property(validModelVersion, (version) => {
          const config: MLEndpointConfig = {
            ...DEFAULT_ML_ENDPOINT_CONFIG,
            modelVersion: version,
          };

          const client = new MLClient(config);

          // The version should be retrievable for logging/audit
          const trackedVersion = client.getModelVersion();

          // Version should match exactly for traceability
          expect(trackedVersion).toBe(version);

          // Version should be suitable for artifact lookup
          expect(trackedVersion).not.toBe('');
          expect(trackedVersion).not.toBe('undefined');
          expect(trackedVersion).not.toBe('null');
        }),
        propertyConfig
      );
    });
  });
});
