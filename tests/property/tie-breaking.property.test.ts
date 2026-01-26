/**
 * Property 4: Tie-Breaking Determinism
 *
 * For any two vendors with identical overall scores, the tie-breaking algorithm
 * SHALL produce a consistent ordering based on availability (primary) and
 * proximity (secondary), such that repeated scoring of the same inputs produces
 * the same ranking.
 *
 * @validates Requirements 1.7
 * @file src/backend/vendor-scoring-service/src/rules/rule-engine.ts
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  evaluateVendors,
  DEFAULT_RULE_WEIGHTS,
  type VendorMetrics,
} from '../../src/backend/vendor-scoring-service/src/rules/rule-engine.js';
import type { VendorProfile, JobEvent, GeoLocation } from '../../src/backend/shared/src/index.js';

// Property test configuration
const propertyConfig = {
  numRuns: 50,
  verbose: false,
};

// Helper to create a vendor with specific characteristics
function createVendor(
  vendorId: string,
  name: string,
  zipCode: string,
  maxCapacity: number,
  currentCapacity: number
): VendorProfile {
  return {
    vendorId,
    name,
    status: 'active',
    certifications: [],
    geographicCoverage: [
      {
        regionId: 'region-1',
        regionName: 'Test Region',
        zipCodes: [zipCode],
        maxDistanceMiles: 100,
      },
    ],
    maxCapacity,
    currentCapacity,
    availabilitySchedule: [],
    specializations: [],
    contactInfo: {
      email: 'test@example.com',
      phone: '1234567890',
      primaryContact: 'Test Contact',
    },
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };
}

// Helper to create a job
function createJob(zipCode: string): JobEvent {
  return {
    jobId: crypto.randomUUID(),
    jobType: 'repair',
    location: {
      latitude: 40.7128,
      longitude: -74.006,
      address: '123 Main St',
      city: 'New York',
      state: 'NY',
      zipCode,
      serviceRegion: 'Northeast',
    },
    urgencyLevel: 'medium',
    slaDeadline: new Date('2025-12-31'),
    requiredCertifications: [],
    customerDetails: {
      customerId: crypto.randomUUID(),
      tier: 'standard',
    },
    specialRequirements: [],
    createdAt: new Date(),
    status: 'pending',
  };
}

describe('Property 4: Tie-Breaking Determinism', () => {
  /**
   * **Validates: Requirements 1.7**
   *
   * Test that identical scores produce consistent ordering
   */
  describe('Deterministic Ordering', () => {
    it('repeated scoring of same inputs SHALL produce same ranking', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 2, max: 5 }),
          fc.integer({ min: 1, max: 10 }),
          fc.integer({ min: 0, max: 5 }),
          (numVendors, maxCapacity, currentCapacity) => {
            // Ensure currentCapacity doesn't exceed maxCapacity
            const actualCurrentCapacity = Math.min(currentCapacity, maxCapacity - 1);
            const zipCode = '10001';
            const job = createJob(zipCode);

            // Create vendors with identical characteristics
            const vendors: VendorProfile[] = [];
            for (let i = 0; i < numVendors; i++) {
              vendors.push(
                createVendor(
                  `vendor-${i}-${crypto.randomUUID()}`,
                  `Vendor ${i}`,
                  zipCode,
                  maxCapacity,
                  actualCurrentCapacity
                )
              );
            }

            // Create identical metrics for all vendors
            const metricsMap = new Map<string, VendorMetrics>();
            const metrics: VendorMetrics = {
              completionRate: 0.85,
              reworkRate: 0.05,
              avgResponseTimeHours: 2,
              avgCustomerSatisfaction: 4.5,
            };
            vendors.forEach((v) => metricsMap.set(v.vendorId, metrics));

            // Run evaluation multiple times
            const results1 = evaluateVendors(vendors, job, new Map(), metricsMap);
            const results2 = evaluateVendors(vendors, job, new Map(), metricsMap);
            const results3 = evaluateVendors(vendors, job, new Map(), metricsMap);

            // Verify same ordering each time
            expect(results1.length).toBe(results2.length);
            expect(results2.length).toBe(results3.length);

            for (let i = 0; i < results1.length; i++) {
              expect(results1[i].vendor.vendorId).toBe(results2[i].vendor.vendorId);
              expect(results2[i].vendor.vendorId).toBe(results3[i].vendor.vendorId);
            }
          }
        ),
        propertyConfig
      );
    });

    it('vendors with identical scores SHALL be ordered by vendorId for final determinism', () => {
      const zipCode = '10001';
      const job = createJob(zipCode);

      // Create two vendors with identical characteristics
      const vendorA = createVendor('aaaaaaaa-0000-0000-0000-000000000001', 'Vendor A', zipCode, 10, 5);
      const vendorB = createVendor('bbbbbbbb-0000-0000-0000-000000000002', 'Vendor B', zipCode, 10, 5);

      const vendors = [vendorB, vendorA]; // Intentionally reversed order

      const metricsMap = new Map<string, VendorMetrics>();
      const metrics: VendorMetrics = {
        completionRate: 0.85,
        reworkRate: 0.05,
        avgResponseTimeHours: 2,
        avgCustomerSatisfaction: 4.5,
      };
      metricsMap.set(vendorA.vendorId, metrics);
      metricsMap.set(vendorB.vendorId, metrics);

      const results = evaluateVendors(vendors, job, new Map(), metricsMap);

      // Vendor A should come first due to lexicographic ordering of vendorId
      expect(results[0].vendor.vendorId).toBe(vendorA.vendorId);
      expect(results[1].vendor.vendorId).toBe(vendorB.vendorId);
    });
  });

  describe('Tie-Breaking Priority', () => {
    it('higher availability score SHALL break ties (primary)', () => {
      const zipCode = '10001';
      const job = createJob(zipCode);

      // Vendor A has more available capacity (higher availability score)
      const vendorA = createVendor('vendor-a-' + crypto.randomUUID(), 'Vendor A', zipCode, 10, 2);
      // Vendor B has less available capacity (lower availability score)
      const vendorB = createVendor('vendor-b-' + crypto.randomUUID(), 'Vendor B', zipCode, 10, 8);

      const vendors = [vendorB, vendorA]; // Intentionally reversed

      const metricsMap = new Map<string, VendorMetrics>();
      const metrics: VendorMetrics = {
        completionRate: 0.85,
        reworkRate: 0.05,
        avgResponseTimeHours: 2,
        avgCustomerSatisfaction: 4.5,
      };
      metricsMap.set(vendorA.vendorId, metrics);
      metricsMap.set(vendorB.vendorId, metrics);

      const results = evaluateVendors(vendors, job, new Map(), metricsMap);

      // Vendor A should rank higher due to better availability
      const vendorAResult = results.find((r) => r.vendor.vendorId === vendorA.vendorId);
      const vendorBResult = results.find((r) => r.vendor.vendorId === vendorB.vendorId);

      expect(vendorAResult).toBeDefined();
      expect(vendorBResult).toBeDefined();

      // Vendor A should have higher score due to better availability
      expect(vendorAResult!.result.ruleBasedScore).toBeGreaterThan(vendorBResult!.result.ruleBasedScore);
    });

    it('proximity score SHALL break ties when availability is equal (secondary)', () => {
      const zipCode = '10001';
      const job = createJob(zipCode);

      // Both vendors have same capacity
      const vendorA = createVendor('vendor-a-' + crypto.randomUUID(), 'Vendor A', zipCode, 10, 5);
      const vendorB = createVendor('vendor-b-' + crypto.randomUUID(), 'Vendor B', zipCode, 10, 5);

      const vendors = [vendorB, vendorA];

      // Create locations - Vendor A is closer
      const vendorLocations = new Map<string, GeoLocation>();
      vendorLocations.set(vendorA.vendorId, {
        latitude: 40.7128,
        longitude: -74.006,
        address: '100 Main St',
        city: 'New York',
        state: 'NY',
        zipCode: '10001',
        serviceRegion: 'Northeast',
      });
      vendorLocations.set(vendorB.vendorId, {
        latitude: 40.8,
        longitude: -74.1,
        address: '200 Main St',
        city: 'New York',
        state: 'NY',
        zipCode: '10001',
        serviceRegion: 'Northeast',
      });

      const metricsMap = new Map<string, VendorMetrics>();
      const metrics: VendorMetrics = {
        completionRate: 0.85,
        reworkRate: 0.05,
        avgResponseTimeHours: 2,
        avgCustomerSatisfaction: 4.5,
      };
      metricsMap.set(vendorA.vendorId, metrics);
      metricsMap.set(vendorB.vendorId, metrics);

      const results = evaluateVendors(vendors, job, vendorLocations, metricsMap);

      // Vendor A should rank higher due to better proximity
      const vendorAIndex = results.findIndex((r) => r.vendor.vendorId === vendorA.vendorId);
      const vendorBIndex = results.findIndex((r) => r.vendor.vendorId === vendorB.vendorId);

      expect(vendorAIndex).toBeLessThan(vendorBIndex);
    });
  });

  describe('Ordering Stability', () => {
    it('ordering SHALL be stable across different input orderings', () => {
      fc.assert(
        fc.property(fc.integer({ min: 3, max: 6 }), (numVendors) => {
          const zipCode = '10001';
          const job = createJob(zipCode);

          // Create vendors with varying capacities
          const vendors: VendorProfile[] = [];
          for (let i = 0; i < numVendors; i++) {
            vendors.push(
              createVendor(
                `vendor-${String(i).padStart(3, '0')}-${crypto.randomUUID()}`,
                `Vendor ${i}`,
                zipCode,
                10,
                i // Different current capacity for each
              )
            );
          }

          const metricsMap = new Map<string, VendorMetrics>();
          vendors.forEach((v) =>
            metricsMap.set(v.vendorId, {
              completionRate: 0.85,
              reworkRate: 0.05,
              avgResponseTimeHours: 2,
              avgCustomerSatisfaction: 4.5,
            })
          );

          // Evaluate with original order
          const results1 = evaluateVendors([...vendors], job, new Map(), metricsMap);

          // Evaluate with reversed order
          const results2 = evaluateVendors([...vendors].reverse(), job, new Map(), metricsMap);

          // Evaluate with shuffled order
          const shuffled = [...vendors].sort(() => Math.random() - 0.5);
          const results3 = evaluateVendors(shuffled, job, new Map(), metricsMap);

          // All should produce same final ordering
          expect(results1.length).toBe(results2.length);
          expect(results2.length).toBe(results3.length);

          for (let i = 0; i < results1.length; i++) {
            expect(results1[i].vendor.vendorId).toBe(results2[i].vendor.vendorId);
            expect(results2[i].vendor.vendorId).toBe(results3[i].vendor.vendorId);
          }
        }),
        propertyConfig
      );
    });

    it('results SHALL be sorted in descending score order', () => {
      fc.assert(
        fc.property(fc.integer({ min: 2, max: 8 }), (numVendors) => {
          const zipCode = '10001';
          const job = createJob(zipCode);

          const vendors: VendorProfile[] = [];
          for (let i = 0; i < numVendors; i++) {
            vendors.push(
              createVendor(
                `vendor-${i}-${crypto.randomUUID()}`,
                `Vendor ${i}`,
                zipCode,
                10,
                Math.floor(Math.random() * 9) // Random capacity 0-8
              )
            );
          }

          const metricsMap = new Map<string, VendorMetrics>();
          vendors.forEach((v) =>
            metricsMap.set(v.vendorId, {
              completionRate: Math.random(),
              reworkRate: Math.random() * 0.2,
              avgResponseTimeHours: Math.random() * 8,
              avgCustomerSatisfaction: 3 + Math.random() * 2,
            })
          );

          const results = evaluateVendors(vendors, job, new Map(), metricsMap);

          // Verify descending order
          for (let i = 1; i < results.length; i++) {
            expect(results[i - 1].result.ruleBasedScore).toBeGreaterThanOrEqual(
              results[i].result.ruleBasedScore - 0.001 // Small tolerance for floating point
            );
          }
        }),
        propertyConfig
      );
    });
  });
});
