/**
 * Property 12: Low Confidence Triggers Review
 *
 * For any recommendation with overall confidence below the configured threshold
 * (default 70%), the system SHALL flag the recommendation for human review
 * and set automation level to 'advisory'.
 *
 * @validates Requirements 6.2, 13.3
 * @file src/backend/vendor-scoring-service/src/controls/confidence-router.ts
 */

import fc from 'fast-check';
import { describe, expect, it, beforeEach } from 'vitest';

import {
  ConfidenceRouter,
  DEFAULT_CONFIDENCE_THRESHOLD,
  DEFAULT_ROUTING_CONFIG,
  resetConfidenceRouter,
  requiresHumanReview,
  ReviewFlagType,
  type ConfidenceRoutingInput,
} from '../../src/backend/vendor-scoring-service/src/controls/confidence-router.js';
import {
  AutomationLevel,
  resetAutomationManager,
} from '../../src/backend/vendor-scoring-service/src/controls/automation-config.js';
import type { VendorRecommendation } from '@retailfixit/shared';

// Property test configuration
const propertyConfig = {
  numRuns: 100,
  verbose: false,
};

// Arbitraries for generating test data
const validUuid = fc.uuid();

const validJobType = fc.constantFrom('repair', 'installation', 'maintenance', 'inspection');

const validCustomerTier = fc.constantFrom('standard', 'premium', 'enterprise');

const validUrgencyLevel = fc.constantFrom('low', 'medium', 'high', 'critical');

const validConfidence = fc.double({ min: 0, max: 1, noNaN: true });

const validScore = fc.double({ min: 0, max: 1, noNaN: true });

const validVendorRecommendation: fc.Arbitrary<VendorRecommendation> = fc.record({
  rank: fc.integer({ min: 1, max: 5 }),
  vendorId: validUuid,
  vendorName: fc.string({ minLength: 1, maxLength: 50 }),
  overallScore: validScore,
  confidence: validConfidence,
  scoreBreakdown: fc.constant({
    ruleBasedScore: 0.7,
    mlScore: 0.6,
    factors: [],
  }),
  rationale: fc.string({ minLength: 1, maxLength: 200 }),
  riskFactors: fc.array(fc.string({ minLength: 1, maxLength: 100 }), { maxLength: 5 }),
  estimatedResponseTime: fc.constantFrom('1-2 hours', '2-4 hours', 'Same day'),
});

const validRoutingInput: fc.Arbitrary<ConfidenceRoutingInput> = fc.record({
  recommendations: fc.array(validVendorRecommendation, { minLength: 0, maxLength: 5 }),
  overallConfidence: validConfidence,
  degradedMode: fc.boolean(),
  jobType: validJobType,
  customerTier: validCustomerTier,
  urgencyLevel: fc.option(validUrgencyLevel, { nil: undefined }),
});

describe('Property 12: Low Confidence Triggers Review', () => {
  beforeEach(() => {
    resetConfidenceRouter();
    resetAutomationManager();
  });

  /**
   * **Validates: Requirements 6.2, 13.3**
   *
   * Test that low confidence flags for human review
   */
  describe('Low Confidence Triggers Human Review', () => {
    it('confidence below threshold SHALL require human review', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 0, max: 0.69, noNaN: true }), // Below default 70%
          fc.array(validVendorRecommendation, { minLength: 3, maxLength: 5 }),
          validJobType,
          validCustomerTier,
          (confidence, recommendations, jobType, customerTier) => {
            const router = new ConfidenceRouter();
            const result = router.route({
              recommendations,
              overallConfidence: confidence,
              degradedMode: false,
              jobType,
              customerTier,
            });

            // Low confidence should require human review
            expect(result.requiresHumanReview).toBe(true);
            expect(result.automationLevel).toBe(AutomationLevel.ADVISORY);

            // Should have low confidence flag
            const hasLowConfidenceFlag = result.reviewFlags.some(
              (f) => f.type === ReviewFlagType.LOW_CONFIDENCE
            );
            expect(hasLowConfidenceFlag).toBe(true);
          }
        ),
        propertyConfig
      );
    });

    it('confidence at or above threshold MAY allow automatic dispatch', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 0.8, max: 1, noNaN: true }), // Well above any threshold
          (confidence) => {
            // Create recommendations with good confidence
            const recommendations: VendorRecommendation[] = [
              {
                rank: 1,
                vendorId: '00000000-0000-0000-0000-000000000001',
                vendorName: 'Vendor 1',
                overallScore: 0.85,
                confidence: 0.8, // Good individual confidence
                scoreBreakdown: { ruleBasedScore: 0.8, mlScore: 0.8, factors: [] },
                rationale: 'Test',
                riskFactors: [],
                estimatedResponseTime: '1-2 hours',
              },
              {
                rank: 2,
                vendorId: '00000000-0000-0000-0000-000000000002',
                vendorName: 'Vendor 2',
                overallScore: 0.75,
                confidence: 0.8,
                scoreBreakdown: { ruleBasedScore: 0.8, mlScore: 0.8, factors: [] },
                rationale: 'Test',
                riskFactors: [],
                estimatedResponseTime: '1-2 hours',
              },
              {
                rank: 3,
                vendorId: '00000000-0000-0000-0000-000000000003',
                vendorName: 'Vendor 3',
                overallScore: 0.65,
                confidence: 0.8,
                scoreBreakdown: { ruleBasedScore: 0.8, mlScore: 0.8, factors: [] },
                rationale: 'Test',
                riskFactors: [],
                estimatedResponseTime: '1-2 hours',
              },
            ];

            const router = new ConfidenceRouter();
            const result = router.route({
              recommendations,
              overallConfidence: confidence,
              degradedMode: false,
              jobType: 'maintenance', // Auto-allowed job type
              customerTier: 'standard', // Standard tier uses default 0.7 threshold
            });

            // High confidence should not have low confidence flag
            const hasLowConfidenceFlag = result.reviewFlags.some(
              (f) => f.type === ReviewFlagType.LOW_CONFIDENCE
            );
            expect(hasLowConfidenceFlag).toBe(false);
          }
        ),
        propertyConfig
      );
    });
  });

  describe('Degraded Mode Handling', () => {
    it('degraded mode SHALL add review flag', () => {
      fc.assert(
        fc.property(
          validConfidence,
          fc.array(validVendorRecommendation, { minLength: 3, maxLength: 5 }),
          validJobType,
          validCustomerTier,
          (confidence, recommendations, jobType, customerTier) => {
            const router = new ConfidenceRouter();
            const result = router.route({
              recommendations,
              overallConfidence: confidence,
              degradedMode: true,
              jobType,
              customerTier,
            });

            // Degraded mode should add flag
            const hasDegradedFlag = result.reviewFlags.some(
              (f) => f.type === ReviewFlagType.DEGRADED_MODE
            );
            expect(hasDegradedFlag).toBe(true);
          }
        ),
        propertyConfig
      );
    });

    it('degraded mode SHALL use lower confidence threshold', () => {
      const router = new ConfidenceRouter();

      const normalThreshold = router.getEffectiveThreshold(false);
      const degradedThreshold = router.getEffectiveThreshold(true);

      expect(degradedThreshold).toBeLessThan(normalThreshold);
    });
  });

  describe('High Risk Factor Handling', () => {
    it('multiple risk factors SHALL trigger high risk flag', () => {
      fc.assert(
        fc.property(
          validConfidence,
          validJobType,
          validCustomerTier,
          (confidence, jobType, customerTier) => {
            // Create recommendation with many risk factors
            const recommendation: VendorRecommendation = {
              rank: 1,
              vendorId: '00000000-0000-0000-0000-000000000001',
              vendorName: 'Test Vendor',
              overallScore: 0.8,
              confidence: 0.8,
              scoreBreakdown: { ruleBasedScore: 0.8, mlScore: 0.8, factors: [] },
              rationale: 'Test rationale',
              riskFactors: ['Risk 1', 'Risk 2', 'Risk 3'], // 3+ risk factors
              estimatedResponseTime: '1-2 hours',
            };

            const router = new ConfidenceRouter();
            const result = router.route({
              recommendations: [recommendation],
              overallConfidence: confidence,
              degradedMode: false,
              jobType,
              customerTier,
            });

            // Should have high risk flag
            const hasHighRiskFlag = result.reviewFlags.some(
              (f) => f.type === ReviewFlagType.HIGH_RISK
            );
            expect(hasHighRiskFlag).toBe(true);
          }
        ),
        propertyConfig
      );
    });
  });

  describe('Close Scores Handling', () => {
    it('close scores between top vendors SHALL add review flag', () => {
      fc.assert(
        fc.property(
          validConfidence,
          validJobType,
          validCustomerTier,
          (confidence, jobType, customerTier) => {
            // Create recommendations with close scores
            const recommendations: VendorRecommendation[] = [
              {
                rank: 1,
                vendorId: '00000000-0000-0000-0000-000000000001',
                vendorName: 'Vendor 1',
                overallScore: 0.85,
                confidence: 0.8,
                scoreBreakdown: { ruleBasedScore: 0.8, mlScore: 0.8, factors: [] },
                rationale: 'Test',
                riskFactors: [],
                estimatedResponseTime: '1-2 hours',
              },
              {
                rank: 2,
                vendorId: '00000000-0000-0000-0000-000000000002',
                vendorName: 'Vendor 2',
                overallScore: 0.84, // Only 0.01 difference
                confidence: 0.8,
                scoreBreakdown: { ruleBasedScore: 0.8, mlScore: 0.8, factors: [] },
                rationale: 'Test',
                riskFactors: [],
                estimatedResponseTime: '1-2 hours',
              },
            ];

            const router = new ConfidenceRouter();
            const result = router.route({
              recommendations,
              overallConfidence: confidence,
              degradedMode: false,
              jobType,
              customerTier,
            });

            // Should have close scores flag
            const hasCloseScoresFlag = result.reviewFlags.some(
              (f) => f.type === ReviewFlagType.CLOSE_SCORES
            );
            expect(hasCloseScoresFlag).toBe(true);
          }
        ),
        propertyConfig
      );
    });
  });

  describe('Insufficient Vendors Handling', () => {
    it('fewer than 3 vendors SHALL add insufficient data flag', () => {
      fc.assert(
        fc.property(
          validConfidence,
          fc.array(validVendorRecommendation, { minLength: 0, maxLength: 2 }),
          validJobType,
          validCustomerTier,
          (confidence, recommendations, jobType, customerTier) => {
            const router = new ConfidenceRouter();
            const result = router.route({
              recommendations,
              overallConfidence: confidence,
              degradedMode: false,
              jobType,
              customerTier,
            });

            // Should have insufficient data flag
            const hasInsufficientFlag = result.reviewFlags.some(
              (f) => f.type === ReviewFlagType.INSUFFICIENT_DATA
            );
            expect(hasInsufficientFlag).toBe(true);
          }
        ),
        propertyConfig
      );
    });

    it('empty vendor list SHALL have high severity insufficient data flag', () => {
      fc.assert(
        fc.property(
          validConfidence,
          validJobType,
          validCustomerTier,
          (confidence, jobType, customerTier) => {
            const router = new ConfidenceRouter();
            const result = router.route({
              recommendations: [],
              overallConfidence: confidence,
              degradedMode: false,
              jobType,
              customerTier,
            });

            // Should have high severity insufficient data flag
            const insufficientFlag = result.reviewFlags.find(
              (f) => f.type === ReviewFlagType.INSUFFICIENT_DATA
            );
            expect(insufficientFlag).toBeDefined();
            expect(insufficientFlag?.severity).toBe('high');
          }
        ),
        propertyConfig
      );
    });
  });

  describe('requiresHumanReview Helper Function', () => {
    it('SHALL return true when confidence is below threshold', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 0, max: 0.69, noNaN: true }),
          (confidence) => {
            const result = requiresHumanReview(confidence, DEFAULT_CONFIDENCE_THRESHOLD);
            expect(result).toBe(true);
          }
        ),
        propertyConfig
      );
    });

    it('SHALL return false when confidence meets threshold', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 0.7, max: 1, noNaN: true }),
          (confidence) => {
            const result = requiresHumanReview(confidence, DEFAULT_CONFIDENCE_THRESHOLD);
            expect(result).toBe(false);
          }
        ),
        propertyConfig
      );
    });
  });

  describe('isLowConfidence Method', () => {
    it('SHALL correctly identify low confidence values', () => {
      fc.assert(
        fc.property(
          validConfidence,
          fc.double({ min: 0.1, max: 0.9, noNaN: true }),
          (confidence, threshold) => {
            const router = new ConfidenceRouter({ ...DEFAULT_ROUTING_CONFIG, defaultThreshold: threshold });
            const isLow = router.isLowConfidence(confidence, threshold);

            if (confidence < threshold) {
              expect(isLow).toBe(true);
            } else {
              expect(isLow).toBe(false);
            }
          }
        ),
        propertyConfig
      );
    });
  });

  describe('Review Flag Severity', () => {
    it('very low confidence SHALL have high severity flag', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 0, max: 0.49, noNaN: true }), // Very low confidence
          fc.array(validVendorRecommendation, { minLength: 3, maxLength: 5 }),
          validJobType,
          validCustomerTier,
          (confidence, recommendations, jobType, customerTier) => {
            const router = new ConfidenceRouter();
            const result = router.route({
              recommendations,
              overallConfidence: confidence,
              degradedMode: false,
              jobType,
              customerTier,
            });

            // Very low confidence should have high severity
            const lowConfidenceFlag = result.reviewFlags.find(
              (f) => f.type === ReviewFlagType.LOW_CONFIDENCE
            );
            expect(lowConfidenceFlag).toBeDefined();
            expect(lowConfidenceFlag?.severity).toBe('high');
          }
        ),
        propertyConfig
      );
    });

    it('moderately low confidence SHALL have medium severity flag', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 0.5, max: 0.69, noNaN: true }), // Moderately low confidence
          fc.array(validVendorRecommendation, { minLength: 3, maxLength: 5 }),
          validJobType,
          validCustomerTier,
          (confidence, recommendations, jobType, customerTier) => {
            const router = new ConfidenceRouter();
            const result = router.route({
              recommendations,
              overallConfidence: confidence,
              degradedMode: false,
              jobType,
              customerTier,
            });

            // Moderately low confidence should have medium severity
            const lowConfidenceFlag = result.reviewFlags.find(
              (f) => f.type === ReviewFlagType.LOW_CONFIDENCE
            );
            expect(lowConfidenceFlag).toBeDefined();
            expect(lowConfidenceFlag?.severity).toBe('medium');
          }
        ),
        propertyConfig
      );
    });
  });
});
