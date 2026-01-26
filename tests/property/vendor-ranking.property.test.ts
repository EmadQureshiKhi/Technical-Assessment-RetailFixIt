/**
 * Property 1: Scoring Produces Valid Ranked Vendor List
 *
 * For any valid JobCreated event and set of available vendors, the
 * Vendor_Scoring_Service SHALL produce a ranked list of 3-5 vendors where
 * each vendor's rank corresponds to their descending overall score.
 *
 * @validates Requirements 1.1, 1.2
 * @file src/backend/vendor-scoring-service/src/scoring/vendor-ranker.ts
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  rankVendorsSync,
  MIN_VENDORS,
  MAX_VENDORS,
} from '../../src/backend/vendor-scoring-service/src/scoring/vendor-ranker.js';
import type { VendorProfile, JobEvent, GeoLocation } from '../../src/backend/shared/src/index.js';
import type { VendorMetrics } from '../../src/backend/vendor-scoring-service/src/rules/rule-engine.js';

// Property test configuration
const propertyConfig = {
  numRuns: 50,
  verbose: false,
};

// Arbitraries for generating test data
const validUuid = fc.uuid();

const validGeoLocation: fc.Arbitrary<GeoLocation> = fc.record({
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
  preferredVendors: fc.option(fc.array(validUuid, { maxLength: 3 }), { nil: undefined }),
  blockedVendors: fc.option(fc.array(validUuid, { maxLength: 3 }), { nil: undefined }),
});

const validJobEvent: fc.Arbitrary<JobEvent> = fc.record({
  jobId: validUuid,
  jobType: fc.constantFrom('repair', 'installation', 'maintenance', 'inspection') as fc.Arbitrary<'repair' | 'installation' | 'maintenance' | 'inspection'>,
  location: validGeoLocation,
  urgencyLevel: fc.constantFrom('low', 'medium', 'high', 'critical') as fc.Arbitrary<'low' | 'medium' | 'high' | 'critical'>,
  slaDeadline: fc.date({ min: new Date('2025-01-01'), max: new Date('2030-12-31') }),
  requiredCertifications: fc.array(fc.string({ minLength: 1, maxLength: 50 }), { maxLength: 2 }),
  customerDetails: validCustomerDetails,
  specialRequirements: fc.array(fc.string({ minLength: 1, maxLength: 100 }), { maxLength: 2 }),
  createdAt: fc.date({ min: new Date('2024-01-01'), max: new Date('2025-12-31') }),
  status: fc.constantFrom('pending', 'assigned', 'in_progress', 'completed', 'cancelled') as fc.Arbitrary<'pending' | 'assigned' | 'in_progress' | 'completed' | 'cancelled'>,
});

// Generate vendor that matches job requirements
const validVendorForJob = (job: JobEvent): fc.Arbitrary<VendorProfile> => {
  return fc.record({
    vendorId: validUuid,
    name: fc.string({ minLength: 1, maxLength: 200 }),
    status: fc.constant('active' as const),
    certifications: fc.constant(
      job.requiredCertifications.map((cert) => ({
        certificationId: crypto.randomUUID(),
        name: cert,
        issuedBy: 'Test Authority',
        validUntil: new Date('2030-12-31'),
        verified: true,
      }))
    ),
    geographicCoverage: fc.constant([
      {
        regionId: 'region-1',
        regionName: 'Test Region',
        zipCodes: [job.location.zipCode],
        maxDistanceMiles: 100,
      },
    ]),
    maxCapacity: fc.integer({ min: 5, max: 20 }),
    currentCapacity: fc.integer({ min: 0, max: 4 }),
    availabilitySchedule: fc.constant([
      {
        dayOfWeek: new Date().getDay(),
        startTime: '00:00',
        endTime: '23:59',
        timezone: 'America/New_York',
      },
    ]),
    specializations: fc.array(fc.string({ minLength: 1, maxLength: 50 }), { maxLength: 3 }),
    contactInfo: fc.record({
      email: fc.emailAddress(),
      phone: fc.stringOf(fc.constantFrom(...'0123456789'.split('')), { minLength: 10, maxLength: 15 }),
      primaryContact: fc.string({ minLength: 1, maxLength: 100 }),
    }),
    createdAt: fc.date({ min: new Date('2020-01-01'), max: new Date('2024-12-31') }),
    updatedAt: fc.date({ min: new Date('2020-01-01'), max: new Date('2024-12-31') }),
  }).filter((v) => v.currentCapacity < v.maxCapacity) as fc.Arbitrary<VendorProfile>;
};

const validVendorMetrics: fc.Arbitrary<VendorMetrics> = fc.record({
  completionRate: fc.double({ min: 0.5, max: 1, noNaN: true }),
  reworkRate: fc.double({ min: 0, max: 0.3, noNaN: true }),
  avgResponseTimeHours: fc.double({ min: 0.5, max: 8, noNaN: true }),
  avgCustomerSatisfaction: fc.double({ min: 3, max: 5, noNaN: true }),
});

describe('Property 1: Scoring Produces Valid Ranked Vendor List', () => {
  /**
   * **Validates: Requirements 1.1, 1.2**
   *
   * Test that 3-5 vendors are returned in descending score order
   */
  describe('Ranked List Generation', () => {
    it('SHALL return 3-5 vendors when sufficient eligible vendors exist', () => {
      fc.assert(
        fc.property(validJobEvent, (job) => {
          // Generate 6-10 vendors for the job
          const vendorCount = 6 + Math.floor(Math.random() * 5);
          const vendorsArb = fc.array(validVendorForJob(job), {
            minLength: vendorCount,
            maxLength: vendorCount,
          });

          return fc.assert(
            fc.property(vendorsArb, (vendors) => {
              // Create metrics for all vendors
              const vendorMetricsMap = new Map<string, VendorMetrics>();
              vendors.forEach((v) => {
                vendorMetricsMap.set(v.vendorId, {
                  completionRate: 0.7 + Math.random() * 0.3,
                  reworkRate: Math.random() * 0.2,
                  avgResponseTimeHours: 1 + Math.random() * 4,
                  avgCustomerSatisfaction: 3.5 + Math.random() * 1.5,
                });
              });

              const result = rankVendorsSync({
                job,
                vendors,
                vendorMetricsMap,
              });

              // Should return between MIN_VENDORS and MAX_VENDORS
              expect(result.recommendations.length).toBeGreaterThanOrEqual(
                Math.min(MIN_VENDORS, result.eligibleVendorsCount)
              );
              expect(result.recommendations.length).toBeLessThanOrEqual(MAX_VENDORS);
            }),
            { numRuns: 5 }
          );
        }),
        { numRuns: 10 }
      );
    });

    it('vendors SHALL be ranked in descending score order', () => {
      fc.assert(
        fc.property(validJobEvent, (job) => {
          const vendorsArb = fc.array(validVendorForJob(job), {
            minLength: 5,
            maxLength: 8,
          });

          return fc.assert(
            fc.property(vendorsArb, (vendors) => {
              const vendorMetricsMap = new Map<string, VendorMetrics>();
              vendors.forEach((v) => {
                vendorMetricsMap.set(v.vendorId, {
                  completionRate: 0.6 + Math.random() * 0.4,
                  reworkRate: Math.random() * 0.25,
                  avgResponseTimeHours: 1 + Math.random() * 6,
                  avgCustomerSatisfaction: 3 + Math.random() * 2,
                });
              });

              const result = rankVendorsSync({
                job,
                vendors,
                vendorMetricsMap,
              });

              // Verify descending order
              for (let i = 1; i < result.recommendations.length; i++) {
                expect(result.recommendations[i - 1].overallScore).toBeGreaterThanOrEqual(
                  result.recommendations[i].overallScore - 0.001
                );
              }
            }),
            { numRuns: 5 }
          );
        }),
        { numRuns: 10 }
      );
    });

    it('each vendor SHALL have a unique rank from 1 to N', () => {
      fc.assert(
        fc.property(validJobEvent, (job) => {
          const vendorsArb = fc.array(validVendorForJob(job), {
            minLength: 5,
            maxLength: 8,
          });

          return fc.assert(
            fc.property(vendorsArb, (vendors) => {
              const vendorMetricsMap = new Map<string, VendorMetrics>();
              vendors.forEach((v) => {
                vendorMetricsMap.set(v.vendorId, {
                  completionRate: 0.7 + Math.random() * 0.3,
                  reworkRate: Math.random() * 0.2,
                  avgResponseTimeHours: 1 + Math.random() * 4,
                  avgCustomerSatisfaction: 3.5 + Math.random() * 1.5,
                });
              });

              const result = rankVendorsSync({
                job,
                vendors,
                vendorMetricsMap,
              });

              // Verify ranks are sequential starting from 1
              const ranks = result.recommendations.map((r) => r.rank);
              for (let i = 0; i < ranks.length; i++) {
                expect(ranks[i]).toBe(i + 1);
              }

              // Verify no duplicate ranks
              const uniqueRanks = new Set(ranks);
              expect(uniqueRanks.size).toBe(ranks.length);
            }),
            { numRuns: 5 }
          );
        }),
        { numRuns: 10 }
      );
    });
  });

  describe('Score Validity', () => {
    it('all scores SHALL be between 0 and 1', () => {
      fc.assert(
        fc.property(validJobEvent, (job) => {
          const vendorsArb = fc.array(validVendorForJob(job), {
            minLength: 3,
            maxLength: 6,
          });

          return fc.assert(
            fc.property(vendorsArb, (vendors) => {
              const vendorMetricsMap = new Map<string, VendorMetrics>();
              vendors.forEach((v) => {
                vendorMetricsMap.set(v.vendorId, {
                  completionRate: 0.7 + Math.random() * 0.3,
                  reworkRate: Math.random() * 0.2,
                  avgResponseTimeHours: 1 + Math.random() * 4,
                  avgCustomerSatisfaction: 3.5 + Math.random() * 1.5,
                });
              });

              const result = rankVendorsSync({
                job,
                vendors,
                vendorMetricsMap,
              });

              for (const rec of result.recommendations) {
                expect(rec.overallScore).toBeGreaterThanOrEqual(0);
                expect(rec.overallScore).toBeLessThanOrEqual(1);
                expect(rec.confidence).toBeGreaterThanOrEqual(0);
                expect(rec.confidence).toBeLessThanOrEqual(1);
              }
            }),
            { numRuns: 5 }
          );
        }),
        { numRuns: 10 }
      );
    });

    it('each recommendation SHALL include required fields', () => {
      fc.assert(
        fc.property(validJobEvent, (job) => {
          const vendorsArb = fc.array(validVendorForJob(job), {
            minLength: 3,
            maxLength: 6,
          });

          return fc.assert(
            fc.property(vendorsArb, (vendors) => {
              const vendorMetricsMap = new Map<string, VendorMetrics>();
              vendors.forEach((v) => {
                vendorMetricsMap.set(v.vendorId, {
                  completionRate: 0.7 + Math.random() * 0.3,
                  reworkRate: Math.random() * 0.2,
                  avgResponseTimeHours: 1 + Math.random() * 4,
                  avgCustomerSatisfaction: 3.5 + Math.random() * 1.5,
                });
              });

              const result = rankVendorsSync({
                job,
                vendors,
                vendorMetricsMap,
              });

              for (const rec of result.recommendations) {
                expect(rec.rank).toBeDefined();
                expect(rec.vendorId).toBeDefined();
                expect(rec.vendorName).toBeDefined();
                expect(rec.overallScore).toBeDefined();
                expect(rec.confidence).toBeDefined();
                expect(rec.scoreBreakdown).toBeDefined();
                expect(rec.rationale).toBeDefined();
                expect(rec.riskFactors).toBeDefined();
                expect(rec.estimatedResponseTime).toBeDefined();
              }
            }),
            { numRuns: 5 }
          );
        }),
        { numRuns: 10 }
      );
    });
  });
});
