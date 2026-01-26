/**
 * Property 2: Score Breakdown Completeness
 *
 * For any vendor recommendation, the score breakdown SHALL contain all defined
 * Score_Factors with values between 0 and 1, weights that sum to 1.0, and
 * contributions that mathematically equal (value × weight).
 *
 * @validates Requirements 1.4
 * @file src/backend/vendor-scoring-service/src/rules/rule-engine.ts
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  evaluateVendor,
  evaluateVendors,
  DEFAULT_RULE_WEIGHTS,
  HISTORICAL_COMPLETION_WEIGHT,
  validateWeights,
  type RuleWeights,
  type VendorMetrics,
} from '../../src/backend/vendor-scoring-service/src/rules/rule-engine.js';
import type { VendorProfile, JobEvent, GeoLocation } from '../../src/backend/shared/src/index.js';

// Property test configuration
const propertyConfig = {
  numRuns: 100,
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

// Generate vendor with matching service area for job
const validVendorProfile = (jobZipCode?: string): fc.Arbitrary<VendorProfile> => {
  return fc.record({
    vendorId: validUuid,
    name: fc.string({ minLength: 1, maxLength: 200 }),
    status: fc.constantFrom('active', 'inactive', 'suspended') as fc.Arbitrary<'active' | 'inactive' | 'suspended'>,
    certifications: fc.array(validCertification, { maxLength: 5 }),
    geographicCoverage: jobZipCode
      ? fc.array(
          fc.record({
            regionId: fc.string({ minLength: 1, maxLength: 50 }),
            regionName: fc.string({ minLength: 1, maxLength: 100 }),
            zipCodes: fc.constant([jobZipCode]),
            maxDistanceMiles: fc.double({ min: 10, max: 500, noNaN: true }),
          }),
          { minLength: 1, maxLength: 3 }
        )
      : fc.array(validServiceArea, { maxLength: 5 }),
    maxCapacity: fc.integer({ min: 1, max: 100 }),
    currentCapacity: fc.integer({ min: 0, max: 50 }),
    availabilitySchedule: fc.array(validAvailabilityWindow, { maxLength: 7 }),
    specializations: fc.array(fc.string({ minLength: 1, maxLength: 100 }), { maxLength: 5 }),
    contactInfo: validContactInfo,
    createdAt: fc.date({ min: new Date('2020-01-01'), max: new Date('2025-12-31') }),
    updatedAt: fc.date({ min: new Date('2020-01-01'), max: new Date('2025-12-31') }),
  }).filter((v) => v.currentCapacity <= v.maxCapacity) as fc.Arbitrary<VendorProfile>;
};

const validVendorMetrics: fc.Arbitrary<VendorMetrics> = fc.record({
  completionRate: fc.double({ min: 0, max: 1, noNaN: true }),
  reworkRate: fc.double({ min: 0, max: 1, noNaN: true }),
  avgResponseTimeHours: fc.double({ min: 0, max: 48, noNaN: true }),
  avgCustomerSatisfaction: fc.double({ min: 0, max: 5, noNaN: true }),
});

describe('Property 2: Score Breakdown Completeness', () => {
  /**
   * **Validates: Requirements 1.4**
   *
   * Test that all factors are present with valid values and weights sum to 1.0
   */
  describe('Factor Completeness', () => {
    it('score breakdown SHALL contain all defined Score_Factors', () => {
      fc.assert(
        fc.property(
          validVendorProfile(),
          validJobEvent,
          validVendorMetrics,
          (vendor, job, metrics) => {
            const result = evaluateVendor(vendor, job, undefined, metrics);

            // Should have exactly 5 factors: availability, proximity, certification, capacity, historicalCompletion
            expect(result.factors.length).toBe(5);

            const factorNames = result.factors.map((f) => f.name);
            expect(factorNames).toContain('availability');
            expect(factorNames).toContain('proximity');
            expect(factorNames).toContain('certification');
            expect(factorNames).toContain('capacity');
            expect(factorNames).toContain('historicalCompletion');
          }
        ),
        propertyConfig
      );
    });

    it('all factor values SHALL be between 0 and 1', () => {
      fc.assert(
        fc.property(
          validVendorProfile(),
          validJobEvent,
          validVendorMetrics,
          (vendor, job, metrics) => {
            const result = evaluateVendor(vendor, job, undefined, metrics);

            for (const factor of result.factors) {
              expect(factor.value).toBeGreaterThanOrEqual(0);
              expect(factor.value).toBeLessThanOrEqual(1);
            }
          }
        ),
        propertyConfig
      );
    });

    it('all factor weights SHALL be between 0 and 1', () => {
      fc.assert(
        fc.property(
          validVendorProfile(),
          validJobEvent,
          validVendorMetrics,
          (vendor, job, metrics) => {
            const result = evaluateVendor(vendor, job, undefined, metrics);

            for (const factor of result.factors) {
              expect(factor.weight).toBeGreaterThanOrEqual(0);
              expect(factor.weight).toBeLessThanOrEqual(1);
            }
          }
        ),
        propertyConfig
      );
    });
  });

  describe('Weight Sum Constraint', () => {
    it('factor weights SHALL sum to 1.0', () => {
      fc.assert(
        fc.property(
          validVendorProfile(),
          validJobEvent,
          validVendorMetrics,
          (vendor, job, metrics) => {
            const result = evaluateVendor(vendor, job, undefined, metrics);

            const totalWeight = result.factors.reduce((sum, f) => sum + f.weight, 0);
            expect(Math.abs(totalWeight - 1.0)).toBeLessThan(0.001);
          }
        ),
        propertyConfig
      );
    });

    it('default weights SHALL sum to 1.0', () => {
      const totalWeight =
        DEFAULT_RULE_WEIGHTS.availability +
        DEFAULT_RULE_WEIGHTS.proximity +
        DEFAULT_RULE_WEIGHTS.certification +
        DEFAULT_RULE_WEIGHTS.capacity +
        HISTORICAL_COMPLETION_WEIGHT;

      expect(Math.abs(totalWeight - 1.0)).toBeLessThan(0.001);
    });

    it('validateWeights SHALL return true for valid weights', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 0.1, max: 0.3, noNaN: true }),
          fc.double({ min: 0.1, max: 0.3, noNaN: true }),
          fc.double({ min: 0.1, max: 0.3, noNaN: true }),
          (w1, w2, w3) => {
            // Calculate w4 to make sum = 1.0 - HISTORICAL_COMPLETION_WEIGHT
            const remaining = 1.0 - HISTORICAL_COMPLETION_WEIGHT - w1 - w2 - w3;
            if (remaining >= 0 && remaining <= 1) {
              const weights: RuleWeights = {
                availability: w1,
                proximity: w2,
                certification: w3,
                capacity: remaining,
              };
              expect(validateWeights(weights)).toBe(true);
            }
          }
        ),
        propertyConfig
      );
    });

    it('validateWeights SHALL return false for invalid weights', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 0.3, max: 0.5, noNaN: true }),
          fc.double({ min: 0.3, max: 0.5, noNaN: true }),
          fc.double({ min: 0.3, max: 0.5, noNaN: true }),
          fc.double({ min: 0.3, max: 0.5, noNaN: true }),
          (w1, w2, w3, w4) => {
            // These weights will sum to more than 1.0 - HISTORICAL_COMPLETION_WEIGHT
            const weights: RuleWeights = {
              availability: w1,
              proximity: w2,
              certification: w3,
              capacity: w4,
            };
            // Only test if sum is clearly not 1.0
            const sum = w1 + w2 + w3 + w4 + HISTORICAL_COMPLETION_WEIGHT;
            if (Math.abs(sum - 1.0) > 0.01) {
              expect(validateWeights(weights)).toBe(false);
            }
          }
        ),
        propertyConfig
      );
    });
  });

  describe('Contribution Calculation', () => {
    it('contribution SHALL equal value × weight for each factor', () => {
      fc.assert(
        fc.property(
          validVendorProfile(),
          validJobEvent,
          validVendorMetrics,
          (vendor, job, metrics) => {
            const result = evaluateVendor(vendor, job, undefined, metrics);

            for (const factor of result.factors) {
              const expectedContribution = factor.value * factor.weight;
              expect(Math.abs(factor.contribution - expectedContribution)).toBeLessThan(0.001);
            }
          }
        ),
        propertyConfig
      );
    });

    it('ruleBasedScore SHALL equal sum of all contributions', () => {
      fc.assert(
        fc.property(
          validVendorProfile(),
          validJobEvent,
          validVendorMetrics,
          (vendor, job, metrics) => {
            const result = evaluateVendor(vendor, job, undefined, metrics);

            const sumOfContributions = result.factors.reduce((sum, f) => sum + f.contribution, 0);
            expect(Math.abs(result.ruleBasedScore - sumOfContributions)).toBeLessThan(0.001);
          }
        ),
        propertyConfig
      );
    });
  });

  describe('Score Range', () => {
    it('ruleBasedScore SHALL be between 0 and 1', () => {
      fc.assert(
        fc.property(
          validVendorProfile(),
          validJobEvent,
          validVendorMetrics,
          (vendor, job, metrics) => {
            const result = evaluateVendor(vendor, job, undefined, metrics);

            expect(result.ruleBasedScore).toBeGreaterThanOrEqual(0);
            expect(result.ruleBasedScore).toBeLessThanOrEqual(1);
          }
        ),
        propertyConfig
      );
    });

    it('all contributions SHALL be between 0 and their respective weights', () => {
      fc.assert(
        fc.property(
          validVendorProfile(),
          validJobEvent,
          validVendorMetrics,
          (vendor, job, metrics) => {
            const result = evaluateVendor(vendor, job, undefined, metrics);

            for (const factor of result.factors) {
              expect(factor.contribution).toBeGreaterThanOrEqual(0);
              expect(factor.contribution).toBeLessThanOrEqual(factor.weight + 0.001);
            }
          }
        ),
        propertyConfig
      );
    });
  });

  describe('Explanation Completeness', () => {
    it('each factor SHALL have a non-empty explanation', () => {
      fc.assert(
        fc.property(
          validVendorProfile(),
          validJobEvent,
          validVendorMetrics,
          (vendor, job, metrics) => {
            const result = evaluateVendor(vendor, job, undefined, metrics);

            for (const factor of result.factors) {
              expect(factor.explanation).toBeDefined();
              expect(factor.explanation.length).toBeGreaterThan(0);
            }
          }
        ),
        propertyConfig
      );
    });
  });
});
