/**
 * Property 14: Schema Validation Enforcement
 *
 * For any API request with invalid input data (missing required fields, wrong types,
 * out-of-range values), the system SHALL reject the request with a 400 status code
 * and error response containing field-level validation details.
 *
 * @validates Requirements 7.1, 7.2, 7.3, 7.5, 7.6
 * @file src/backend/shared/src/models/job.ts
 * @file src/backend/shared/src/models/vendor.ts
 * @file src/backend/shared/src/models/scoring.ts
 * @file src/backend/shared/src/models/events.ts
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';

import {
  JobEventSchema,
  GeoLocationSchema,
  CustomerDetailsSchema,
  safeValidateJobEvent,
} from '../../src/backend/shared/src/models/job.js';
import {
  VendorProfileSchema,
  CertificationSchema,
  ServiceAreaSchema,
  AvailabilityWindowSchema,
  safeValidateVendorProfile,
} from '../../src/backend/shared/src/models/vendor.js';
import {
  ScoreFactorsSchema,
  ScoreBreakdownSchema,
  RecommendationRequestSchema,
  safeValidateRecommendationRequest,
  validateScoreBreakdownCompleteness,
} from '../../src/backend/shared/src/models/scoring.js';
import {
  JobCreatedEventSchema,
  VendorOverrideRecordedEventSchema,
  safeValidateJobCreatedEvent,
  safeValidateVendorOverrideEvent,
} from '../../src/backend/shared/src/models/events.js';

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
  tier: fc.constantFrom('standard', 'premium', 'enterprise'),
  preferredVendors: fc.option(fc.array(validUuid, { maxLength: 5 }), { nil: undefined }),
  blockedVendors: fc.option(fc.array(validUuid, { maxLength: 5 }), { nil: undefined }),
});

const validJobEvent = fc.record({
  jobId: validUuid,
  jobType: fc.constantFrom('repair', 'installation', 'maintenance', 'inspection'),
  location: validGeoLocation,
  urgencyLevel: fc.constantFrom('low', 'medium', 'high', 'critical'),
  slaDeadline: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') }),
  requiredCertifications: fc.array(fc.string({ minLength: 1, maxLength: 100 }), { maxLength: 5 }),
  customerDetails: validCustomerDetails,
  specialRequirements: fc.array(fc.string({ minLength: 1, maxLength: 200 }), { maxLength: 5 }),
  createdAt: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') }),
  status: fc.constantFrom('pending', 'assigned', 'in_progress', 'completed', 'cancelled'),
});

describe('Property 14: Schema Validation Enforcement', () => {
  /**
   * **Validates: Requirements 7.1, 7.5**
   */
  describe('JobEvent Schema Validation', () => {
    it('valid JobEvent data should pass validation', () => {
      fc.assert(
        fc.property(validJobEvent, (jobEvent) => {
          const result = safeValidateJobEvent(jobEvent);
          expect(result.success).toBe(true);
        }),
        propertyConfig
      );
    });

    it('missing required fields should be rejected with field-level errors', () => {
      fc.assert(
        fc.property(
          fc.constantFrom('jobId', 'jobType', 'location', 'urgencyLevel', 'slaDeadline'),
          (fieldToRemove) => {
            const invalidData: Record<string, unknown> = {
              jobId: crypto.randomUUID(),
              jobType: 'repair',
              location: {
                latitude: 40.7128,
                longitude: -74.006,
                address: '123 Main St',
                city: 'New York',
                state: 'NY',
                zipCode: '10001',
                serviceRegion: 'Northeast',
              },
              urgencyLevel: 'medium',
              slaDeadline: new Date(),
              requiredCertifications: [],
              customerDetails: {
                customerId: crypto.randomUUID(),
                tier: 'standard',
              },
            };

            delete invalidData[fieldToRemove];

            const result = safeValidateJobEvent(invalidData);
            expect(result.success).toBe(false);
            if (!result.success) {
              // Should have field-level error details
              expect(result.error.issues.length).toBeGreaterThan(0);
              expect(result.error.issues.some((issue) => issue.path.includes(fieldToRemove))).toBe(
                true
              );
            }
          }
        ),
        propertyConfig
      );
    });

    it('invalid latitude (out of range) should be rejected', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.double({ min: -1000, max: -91, noNaN: true }),
            fc.double({ min: 91, max: 1000, noNaN: true })
          ),
          (invalidLatitude) => {
            const invalidData = {
              jobId: crypto.randomUUID(),
              jobType: 'repair',
              location: {
                latitude: invalidLatitude,
                longitude: -74.006,
                address: '123 Main St',
                city: 'New York',
                state: 'NY',
                zipCode: '10001',
                serviceRegion: 'Northeast',
              },
              urgencyLevel: 'medium',
              slaDeadline: new Date(),
              requiredCertifications: [],
              customerDetails: {
                customerId: crypto.randomUUID(),
                tier: 'standard',
              },
            };

            const result = GeoLocationSchema.safeParse(invalidData.location);
            expect(result.success).toBe(false);
          }
        ),
        propertyConfig
      );
    });

    it('invalid ZIP code format should be rejected', () => {
      fc.assert(
        fc.property(
          fc.stringOf(fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')), {
            minLength: 5,
            maxLength: 5,
          }),
          (invalidZip) => {
            const invalidLocation = {
              latitude: 40.7128,
              longitude: -74.006,
              address: '123 Main St',
              city: 'New York',
              state: 'NY',
              zipCode: invalidZip,
              serviceRegion: 'Northeast',
            };

            const result = GeoLocationSchema.safeParse(invalidLocation);
            expect(result.success).toBe(false);
          }
        ),
        propertyConfig
      );
    });

    it('invalid job type should be rejected', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1 }).filter((s) => !['repair', 'installation', 'maintenance', 'inspection'].includes(s)),
          (invalidJobType) => {
            const invalidData = {
              jobId: crypto.randomUUID(),
              jobType: invalidJobType,
              location: {
                latitude: 40.7128,
                longitude: -74.006,
                address: '123 Main St',
                city: 'New York',
                state: 'NY',
                zipCode: '10001',
                serviceRegion: 'Northeast',
              },
              urgencyLevel: 'medium',
              slaDeadline: new Date(),
              requiredCertifications: [],
              customerDetails: {
                customerId: crypto.randomUUID(),
                tier: 'standard',
              },
            };

            const result = safeValidateJobEvent(invalidData);
            expect(result.success).toBe(false);
          }
        ),
        propertyConfig
      );
    });
  });

  /**
   * **Validates: Requirements 7.2, 7.5**
   */
  describe('VendorProfile Schema Validation', () => {
    const validCertification = fc.record({
      certificationId: validUuid,
      name: fc.string({ minLength: 1, maxLength: 100 }),
      issuedBy: fc.string({ minLength: 1, maxLength: 100 }),
      validUntil: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') }),
      verified: fc.boolean(),
    });

    const validServiceArea = fc.record({
      regionId: fc.string({ minLength: 1, maxLength: 50 }),
      regionName: fc.string({ minLength: 1, maxLength: 100 }),
      zipCodes: fc.array(
        fc.stringOf(fc.constantFrom(...'0123456789'.split('')), { minLength: 5, maxLength: 5 }),
        { maxLength: 10 }
      ),
      maxDistanceMiles: fc.double({ min: 0, max: 500, noNaN: true }),
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

    it('currentCapacity exceeding maxCapacity should be rejected', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 50 }),
          fc.integer({ min: 1, max: 50 }),
          (maxCap, extraCap) => {
            const invalidVendor = {
              vendorId: crypto.randomUUID(),
              name: 'Test Vendor',
              status: 'active',
              certifications: [],
              geographicCoverage: [],
              maxCapacity: maxCap,
              currentCapacity: maxCap + extraCap, // Exceeds max
              availabilitySchedule: [],
              specializations: [],
              contactInfo: {
                email: 'test@example.com',
                phone: '1234567890',
                primaryContact: 'John Doe',
              },
              createdAt: new Date(),
              updatedAt: new Date(),
            };

            const result = safeValidateVendorProfile(invalidVendor);
            expect(result.success).toBe(false);
            if (!result.success) {
              expect(
                result.error.issues.some((issue) => issue.path.includes('currentCapacity'))
              ).toBe(true);
            }
          }
        ),
        propertyConfig
      );
    });

    it('invalid vendor status should be rejected', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1 }).filter((s) => !['active', 'inactive', 'suspended'].includes(s)),
          (invalidStatus) => {
            const invalidVendor = {
              vendorId: crypto.randomUUID(),
              name: 'Test Vendor',
              status: invalidStatus,
              certifications: [],
              geographicCoverage: [],
              maxCapacity: 10,
              currentCapacity: 5,
              availabilitySchedule: [],
              specializations: [],
              contactInfo: {
                email: 'test@example.com',
                phone: '1234567890',
                primaryContact: 'John Doe',
              },
              createdAt: new Date(),
              updatedAt: new Date(),
            };

            const result = safeValidateVendorProfile(invalidVendor);
            expect(result.success).toBe(false);
          }
        ),
        propertyConfig
      );
    });

    it('invalid time format in availability window should be rejected', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 10 }).filter((s) => !/^([01]\d|2[0-3]):([0-5]\d)$/.test(s)),
          (invalidTime) => {
            const invalidWindow = {
              dayOfWeek: 1,
              startTime: invalidTime,
              endTime: '17:00',
              timezone: 'America/New_York',
            };

            const result = AvailabilityWindowSchema.safeParse(invalidWindow);
            expect(result.success).toBe(false);
          }
        ),
        propertyConfig
      );
    });
  });

  /**
   * **Validates: Requirements 7.3, 7.5**
   */
  describe('Scoring Schema Validation', () => {
    it('score values outside 0-1 range should be rejected', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.double({ min: -100, max: -0.001, noNaN: true }),
            fc.double({ min: 1.001, max: 100, noNaN: true })
          ),
          (invalidScore) => {
            const invalidFactors = {
              availabilityScore: invalidScore,
              proximityScore: 0.5,
              certificationScore: 0.5,
              capacityScore: 0.5,
              completionRate: 0.5,
              reworkRate: 0.5,
              avgResponseTime: 2,
              customerSatisfaction: 4,
              predictedCompletionProb: 0.5,
              predictedTimeToComplete: 4,
              predictedReworkRisk: 0.1,
              predictedSatisfaction: 4,
              dataQualityScore: 0.8,
              predictionConfidence: 0.9,
            };

            const result = ScoreFactorsSchema.safeParse(invalidFactors);
            expect(result.success).toBe(false);
          }
        ),
        propertyConfig
      );
    });

    it('customer satisfaction outside 0-5 range should be rejected', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.double({ min: -100, max: -0.001, noNaN: true }),
            fc.double({ min: 5.001, max: 100, noNaN: true })
          ),
          (invalidSatisfaction) => {
            const invalidFactors = {
              availabilityScore: 0.5,
              proximityScore: 0.5,
              certificationScore: 0.5,
              capacityScore: 0.5,
              completionRate: 0.5,
              reworkRate: 0.5,
              avgResponseTime: 2,
              customerSatisfaction: invalidSatisfaction,
              predictedCompletionProb: 0.5,
              predictedTimeToComplete: 4,
              predictedReworkRisk: 0.1,
              predictedSatisfaction: 4,
              dataQualityScore: 0.8,
              predictionConfidence: 0.9,
            };

            const result = ScoreFactorsSchema.safeParse(invalidFactors);
            expect(result.success).toBe(false);
          }
        ),
        propertyConfig
      );
    });
  });

  /**
   * **Validates: Requirements 7.5, 7.6**
   */
  describe('Event Schema Validation', () => {
    it('JobCreated event with missing data fields should be rejected', () => {
      fc.assert(
        fc.property(
          fc.constantFrom('jobId', 'jobType', 'location', 'urgencyLevel'),
          (fieldToRemove) => {
            const invalidEvent: Record<string, unknown> = {
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
                  serviceRegion: 'Northeast',
                },
                urgencyLevel: 'medium',
                slaDeadline: new Date(),
                requiredCertifications: [],
                customerDetails: {
                  customerId: crypto.randomUUID(),
                  tier: 'standard',
                },
              },
            };

            delete (invalidEvent.data as Record<string, unknown>)[fieldToRemove];

            const result = safeValidateJobCreatedEvent(invalidEvent);
            expect(result.success).toBe(false);
            if (!result.success) {
              expect(result.error.issues.length).toBeGreaterThan(0);
            }
          }
        ),
        propertyConfig
      );
    });

    it('VendorOverride event with empty reason should be rejected', () => {
      fc.assert(
        fc.property(fc.constantFrom('', '   ', '\t', '\n'), (emptyReason) => {
          const invalidEvent = {
            eventId: crypto.randomUUID(),
            eventType: 'VendorOverrideRecorded',
            timestamp: new Date(),
            correlationId: crypto.randomUUID(),
            data: {
              jobId: crypto.randomUUID(),
              originalRecommendation: crypto.randomUUID(),
              selectedVendor: crypto.randomUUID(),
              operatorId: crypto.randomUUID(),
              overrideReason: emptyReason,
              overrideCategory: 'preference',
            },
          };

          const result = safeValidateVendorOverrideEvent(invalidEvent);
          expect(result.success).toBe(false);
        }),
        propertyConfig
      );
    });

    it('event with missing correlationId should be rejected', () => {
      const invalidEvent = {
        eventId: crypto.randomUUID(),
        eventType: 'JobCreated',
        timestamp: new Date(),
        // Missing correlationId
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
            serviceRegion: 'Northeast',
          },
          urgencyLevel: 'medium',
          slaDeadline: new Date(),
          requiredCertifications: [],
          customerDetails: {
            customerId: crypto.randomUUID(),
            tier: 'standard',
          },
        },
      };

      const result = safeValidateJobCreatedEvent(invalidEvent);
      expect(result.success).toBe(false);
    });
  });

  /**
   * **Validates: Requirements 7.6 - Field-level error details**
   */
  describe('Error Response Format', () => {
    it('validation errors should contain field path information', () => {
      fc.assert(
        fc.property(fc.integer({ min: 1, max: 100 }), () => {
          const invalidData = {
            jobId: 'not-a-uuid', // Invalid UUID
            jobType: 'invalid-type', // Invalid enum
            location: {
              latitude: 'not-a-number', // Invalid type
              longitude: -74.006,
              address: '', // Empty string
              city: 'New York',
              state: 'NY',
              zipCode: 'ABCDE', // Invalid format
              serviceRegion: 'Northeast',
            },
            urgencyLevel: 'medium',
            slaDeadline: new Date(),
            requiredCertifications: [],
            customerDetails: {
              customerId: crypto.randomUUID(),
              tier: 'standard',
            },
          };

          const result = safeValidateJobEvent(invalidData);
          expect(result.success).toBe(false);

          if (!result.success) {
            // Each error should have a path
            for (const issue of result.error.issues) {
              expect(issue.path).toBeDefined();
              expect(issue.message).toBeDefined();
              expect(issue.message.length).toBeGreaterThan(0);
            }
          }
        }),
        propertyConfig
      );
    });
  });
});
