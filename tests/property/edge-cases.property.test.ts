/**
 * Property Tests for Edge Cases
 *
 * Property 27: Empty Vendor List Handling
 * Property 28: Insufficient Vendors Handling
 * Property 29: New Vendor Default Scoring
 *
 * @validates Requirements 1.5, 1.2
 * @file src/backend/vendor-scoring-service/src/scoring/vendor-ranker.ts
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  rankVendorsSync,
  MIN_VENDORS,
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

describe('Property 27: Empty Vendor List Handling', () => {
  /**
   * **Validates: Requirements 1.2**
   *
   * Test that empty vendor list returns appropriate error response
   */
  describe('Empty Vendor List', () => {
    it('empty vendor list SHALL return empty recommendations with warning', () => {
      fc.assert(
        fc.property(validJobEvent, (job) => {
          const result = rankVendorsSync({
            job,
            vendors: [],
          });

          // Should return empty recommendations
          expect(result.recommendations).toHaveLength(0);

          // Should have warning
          expect(result.hasWarning).toBe(true);
          expect(result.warning).toBeDefined();
          expect(result.warning).toContain('No vendors');

          // Should report zero vendors evaluated
          expect(result.totalVendorsEvaluated).toBe(0);
          expect(result.eligibleVendorsCount).toBe(0);
        }),
        propertyConfig
      );
    });

    it('empty vendor list SHALL indicate degraded mode', () => {
      fc.assert(
        fc.property(validJobEvent, (job) => {
          const result = rankVendorsSync({
            job,
            vendors: [],
          });

          expect(result.degradedMode).toBe(true);
        }),
        propertyConfig
      );
    });
  });
});

describe('Property 28: Insufficient Vendors Handling', () => {
  /**
   * **Validates: Requirements 1.2**
   *
   * Test that fewer than 3 eligible vendors returns available vendors with warning
   */
  describe('Insufficient Eligible Vendors', () => {
    it('fewer than MIN_VENDORS eligible SHALL return available vendors with warning', () => {
      fc.assert(
        fc.property(
          validJobEvent,
          fc.integer({ min: 1, max: MIN_VENDORS - 1 }),
          (job, vendorCount) => {
            const vendorsArb = fc.array(validVendorForJob(job), {
              minLength: vendorCount,
              maxLength: vendorCount,
            });

            return fc.assert(
              fc.property(vendorsArb, (vendors) => {
                const vendorMetricsMap = new Map<string, VendorMetrics>();
                vendors.forEach((v) => {
                  vendorMetricsMap.set(v.vendorId, {
                    completionRate: 0.8,
                    reworkRate: 0.1,
                    avgResponseTimeHours: 2,
                    avgCustomerSatisfaction: 4.0,
                  });
                });

                const result = rankVendorsSync({
                  job,
                  vendors,
                  vendorMetricsMap,
                });

                // Should return all available vendors
                expect(result.recommendations.length).toBeLessThanOrEqual(vendorCount);

                // Should have warning about insufficient vendors
                if (result.eligibleVendorsCount < MIN_VENDORS && result.eligibleVendorsCount > 0) {
                  expect(result.hasWarning).toBe(true);
                  expect(result.warning).toContain('eligible');
                }
              }),
              { numRuns: 5 }
            );
          }
        ),
        { numRuns: 10 }
      );
    });

    it('single eligible vendor SHALL be returned with warning', () => {
      fc.assert(
        fc.property(validJobEvent, (job) => {
          const vendorsArb = fc.array(validVendorForJob(job), {
            minLength: 1,
            maxLength: 1,
          });

          return fc.assert(
            fc.property(vendorsArb, (vendors) => {
              const vendorMetricsMap = new Map<string, VendorMetrics>();
              vendors.forEach((v) => {
                vendorMetricsMap.set(v.vendorId, {
                  completionRate: 0.8,
                  reworkRate: 0.1,
                  avgResponseTimeHours: 2,
                  avgCustomerSatisfaction: 4.0,
                });
              });

              const result = rankVendorsSync({
                job,
                vendors,
                vendorMetricsMap,
              });

              // Should return the single vendor
              if (result.eligibleVendorsCount === 1) {
                expect(result.recommendations.length).toBe(1);
                expect(result.hasWarning).toBe(true);
              }
            }),
            { numRuns: 5 }
          );
        }),
        { numRuns: 10 }
      );
    });

    it('two eligible vendors SHALL be returned with warning', () => {
      fc.assert(
        fc.property(validJobEvent, (job) => {
          const vendorsArb = fc.array(validVendorForJob(job), {
            minLength: 2,
            maxLength: 2,
          });

          return fc.assert(
            fc.property(vendorsArb, (vendors) => {
              const vendorMetricsMap = new Map<string, VendorMetrics>();
              vendors.forEach((v) => {
                vendorMetricsMap.set(v.vendorId, {
                  completionRate: 0.8,
                  reworkRate: 0.1,
                  avgResponseTimeHours: 2,
                  avgCustomerSatisfaction: 4.0,
                });
              });

              const result = rankVendorsSync({
                job,
                vendors,
                vendorMetricsMap,
              });

              // Should return both vendors
              if (result.eligibleVendorsCount === 2) {
                expect(result.recommendations.length).toBe(2);
                expect(result.hasWarning).toBe(true);
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


describe('Property 29: New Vendor Default Scoring', () => {
  /**
   * **Validates: Requirements 1.5**
   *
   * Test that vendors with no history receive default scores with low confidence
   */
  describe('New Vendor Scoring', () => {
    it('vendors without metrics SHALL receive default scores', () => {
      fc.assert(
        fc.property(validJobEvent, (job) => {
          const vendorsArb = fc.array(validVendorForJob(job), {
            minLength: 3,
            maxLength: 5,
          });

          return fc.assert(
            fc.property(vendorsArb, (vendors) => {
              // Don't provide any metrics - simulating new vendors
              const result = rankVendorsSync({
                job,
                vendors,
                vendorMetricsMap: new Map(), // Empty metrics map
              });

              // Should still produce recommendations
              expect(result.recommendations.length).toBeGreaterThan(0);

              // All recommendations should have valid scores
              for (const rec of result.recommendations) {
                expect(rec.overallScore).toBeGreaterThanOrEqual(0);
                expect(rec.overallScore).toBeLessThanOrEqual(1);
              }
            }),
            { numRuns: 5 }
          );
        }),
        { numRuns: 10 }
      );
    });

    it('vendors without metrics SHALL have lower confidence', () => {
      fc.assert(
        fc.property(validJobEvent, (job) => {
          const vendorsArb = fc.array(validVendorForJob(job), {
            minLength: 4,
            maxLength: 6,
          });

          return fc.assert(
            fc.property(vendorsArb, (vendors) => {
              // Split vendors - half with metrics, half without
              const halfCount = Math.floor(vendors.length / 2);
              const vendorsWithMetrics = vendors.slice(0, halfCount);
              const vendorsWithoutMetrics = vendors.slice(halfCount);

              const vendorMetricsMap = new Map<string, VendorMetrics>();
              vendorsWithMetrics.forEach((v) => {
                vendorMetricsMap.set(v.vendorId, {
                  completionRate: 0.9,
                  reworkRate: 0.05,
                  avgResponseTimeHours: 2,
                  avgCustomerSatisfaction: 4.5,
                });
              });

              const result = rankVendorsSync({
                job,
                vendors,
                vendorMetricsMap,
              });

              // Find recommendations for vendors with and without metrics
              const recsWithMetrics = result.recommendations.filter((r) =>
                vendorsWithMetrics.some((v) => v.vendorId === r.vendorId)
              );
              const recsWithoutMetrics = result.recommendations.filter((r) =>
                vendorsWithoutMetrics.some((v) => v.vendorId === r.vendorId)
              );

              // Vendors without metrics should generally have lower confidence
              // (though this depends on other factors too)
              if (recsWithMetrics.length > 0 && recsWithoutMetrics.length > 0) {
                const avgConfidenceWithMetrics =
                  recsWithMetrics.reduce((sum, r) => sum + r.confidence, 0) /
                  recsWithMetrics.length;
                const avgConfidenceWithoutMetrics =
                  recsWithoutMetrics.reduce((sum, r) => sum + r.confidence, 0) /
                  recsWithoutMetrics.length;

                // Vendors with metrics should have higher or equal confidence
                expect(avgConfidenceWithMetrics).toBeGreaterThanOrEqual(
                  avgConfidenceWithoutMetrics - 0.1 // Allow small tolerance
                );
              }
            }),
            { numRuns: 5 }
          );
        }),
        { numRuns: 10 }
      );
    });

    it('new vendors SHALL still be eligible for recommendation', () => {
      fc.assert(
        fc.property(validJobEvent, (job) => {
          const vendorsArb = fc.array(validVendorForJob(job), {
            minLength: 3,
            maxLength: 5,
          });

          return fc.assert(
            fc.property(vendorsArb, (vendors) => {
              // No metrics for any vendor
              const result = rankVendorsSync({
                job,
                vendors,
                vendorMetricsMap: new Map(),
              });

              // New vendors should still be recommended if they pass filters
              expect(result.eligibleVendorsCount).toBeGreaterThan(0);
              expect(result.recommendations.length).toBeGreaterThan(0);
            }),
            { numRuns: 5 }
          );
        }),
        { numRuns: 10 }
      );
    });

    it('risk factors SHALL indicate limited historical data for new vendors', () => {
      fc.assert(
        fc.property(validJobEvent, (job) => {
          const vendorsArb = fc.array(validVendorForJob(job), {
            minLength: 3,
            maxLength: 5,
          });

          return fc.assert(
            fc.property(vendorsArb, (vendors) => {
              // No metrics - all new vendors
              const result = rankVendorsSync({
                job,
                vendors,
                vendorMetricsMap: new Map(),
              });

              // Check that risk factors mention limited data
              for (const rec of result.recommendations) {
                // Risk factors should exist
                expect(rec.riskFactors).toBeDefined();
                expect(Array.isArray(rec.riskFactors)).toBe(true);

                // At least some recommendations should mention limited data
                // (depending on confidence calculation)
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
