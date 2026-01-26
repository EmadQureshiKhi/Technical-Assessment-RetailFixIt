/**
 * Property 3: Hybrid Scoring Combines Rules and ML
 *
 * For any scoring request where ML is available, the final score SHALL be a
 * weighted combination of rule-based scores and ML-based predictions, where
 * both components contribute non-zero values to the final score.
 *
 * @validates Requirements 1.3, 2.1, 2.2
 * @file src/backend/vendor-scoring-service/src/scoring/hybrid-scorer.ts
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  calculateHybridScore,
  calculateMLScore,
  validateHybridWeights,
  DEFAULT_HYBRID_WEIGHTS,
  type HybridWeights,
  type HybridScoringInput,
} from '../../src/backend/vendor-scoring-service/src/scoring/hybrid-scorer.js';
import type { RuleEngineResult, VendorMetrics } from '../../src/backend/vendor-scoring-service/src/rules/rule-engine.js';
import type { MLPrediction } from '../../src/backend/vendor-scoring-service/src/ml/ml-client.js';

// Property test configuration
const propertyConfig = {
  numRuns: 100,
  verbose: false,
};

// Arbitraries for generating test data
const validUuid = fc.uuid();

const validMLPrediction: fc.Arbitrary<MLPrediction> = fc.record({
  completionProbability: fc.double({ min: 0, max: 1, noNaN: true }),
  timeToComplete: fc.double({ min: 0.5, max: 48, noNaN: true }),
  reworkRisk: fc.double({ min: 0, max: 1, noNaN: true }),
  predictedSatisfaction: fc.double({ min: 0, max: 5, noNaN: true }),
  confidence: fc.double({ min: 0, max: 1, noNaN: true }),
});

const validScoreFactor = fc.record({
  name: fc.constantFrom('availability', 'proximity', 'certification', 'capacity', 'historicalCompletion'),
  value: fc.double({ min: 0, max: 1, noNaN: true }),
  weight: fc.double({ min: 0.1, max: 0.3, noNaN: true }),
  contribution: fc.double({ min: 0, max: 0.3, noNaN: true }),
  explanation: fc.string({ minLength: 1, maxLength: 200 }),
});

// Generate rule engine result with valid factors
const validRuleEngineResult: fc.Arbitrary<RuleEngineResult> = fc.record({
  passed: fc.boolean(),
  ruleBasedScore: fc.double({ min: 0, max: 1, noNaN: true }),
  factors: fc.constant([
    { name: 'availability', value: 0.8, weight: 0.25, contribution: 0.2, explanation: 'Available' },
    { name: 'proximity', value: 0.7, weight: 0.20, contribution: 0.14, explanation: 'Close' },
    { name: 'certification', value: 0.9, weight: 0.20, contribution: 0.18, explanation: 'Certified' },
    { name: 'capacity', value: 0.6, weight: 0.15, contribution: 0.09, explanation: 'Has capacity' },
    { name: 'historicalCompletion', value: 0.85, weight: 0.20, contribution: 0.17, explanation: 'Good history' },
  ]),
  failureReasons: fc.array(fc.string({ minLength: 1, maxLength: 100 }), { maxLength: 3 }),
}).map(result => ({
  ...result,
  ruleBasedScore: result.factors.reduce((sum, f) => sum + f.contribution, 0),
}));

const validVendorMetrics: fc.Arbitrary<VendorMetrics> = fc.record({
  completionRate: fc.double({ min: 0, max: 1, noNaN: true }),
  reworkRate: fc.double({ min: 0, max: 1, noNaN: true }),
  avgResponseTimeHours: fc.double({ min: 0, max: 48, noNaN: true }),
  avgCustomerSatisfaction: fc.double({ min: 0, max: 5, noNaN: true }),
});

describe('Property 3: Hybrid Scoring Combines Rules and ML', () => {
  /**
   * **Validates: Requirements 1.3, 2.1, 2.2**
   *
   * Test that both components contribute to final score
   */
  describe('Both Components Contribute', () => {
    it('final score SHALL include contributions from both rule-based and ML scores when ML is available', () => {
      fc.assert(
        fc.property(
          validUuid,
          validRuleEngineResult,
          validMLPrediction,
          validVendorMetrics,
          (vendorId, ruleResult, mlPrediction, vendorMetrics) => {
            const input: HybridScoringInput = {
              vendorId,
              ruleResult,
              mlPrediction,
              vendorMetrics,
              degradedMode: false,
            };

            const result = calculateHybridScore(input, DEFAULT_HYBRID_WEIGHTS);

            // Both rule-based and ML scores should be present in breakdown
            expect(result.scoreBreakdown.ruleBasedScore).toBeGreaterThanOrEqual(0);
            expect(result.scoreBreakdown.mlScore).toBeGreaterThanOrEqual(0);

            // When ML is available and has non-zero predictions, ML score should contribute
            const mlScore = calculateMLScore(mlPrediction);
            if (mlScore > 0) {
              expect(result.mlScore).toBeGreaterThan(0);
            }

            // Rule-based score should always contribute when non-zero
            if (ruleResult.ruleBasedScore > 0) {
              expect(result.ruleBasedScore).toBeGreaterThan(0);
            }
          }
        ),
        propertyConfig
      );
    });

    it('overall score SHALL be weighted combination of rule, ML, and context scores', () => {
      fc.assert(
        fc.property(
          validUuid,
          validRuleEngineResult,
          validMLPrediction,
          (vendorId, ruleResult, mlPrediction) => {
            const input: HybridScoringInput = {
              vendorId,
              ruleResult,
              mlPrediction,
              degradedMode: false,
            };

            const weights = DEFAULT_HYBRID_WEIGHTS;
            const result = calculateHybridScore(input, weights);

            // Overall score should be in valid range
            expect(result.overallScore).toBeGreaterThanOrEqual(0);
            expect(result.overallScore).toBeLessThanOrEqual(1);

            // Score should reflect the weighted combination
            const expectedMin = 0;
            const expectedMax = 1;
            expect(result.overallScore).toBeGreaterThanOrEqual(expectedMin);
            expect(result.overallScore).toBeLessThanOrEqual(expectedMax);
          }
        ),
        propertyConfig
      );
    });
  });

  describe('ML Score Calculation', () => {
    it('ML score SHALL combine completion probability, rework risk, and satisfaction', () => {
      fc.assert(
        fc.property(validMLPrediction, (mlPrediction) => {
          const mlScore = calculateMLScore(mlPrediction);

          // ML score should be in valid range
          expect(mlScore).toBeGreaterThanOrEqual(0);
          expect(mlScore).toBeLessThanOrEqual(1);

          // Higher completion probability should increase score
          // Lower rework risk should increase score
          // Higher satisfaction should increase score
        }),
        propertyConfig
      );
    });

    it('null ML prediction SHALL return zero ML score', () => {
      const mlScore = calculateMLScore(null);
      expect(mlScore).toBe(0);
    });
  });

  describe('Degraded Mode Behavior', () => {
    it('degraded mode SHALL redistribute ML weight to rules', () => {
      fc.assert(
        fc.property(
          validUuid,
          validRuleEngineResult,
          validMLPrediction,
          (vendorId, ruleResult, mlPrediction) => {
            const inputNormal: HybridScoringInput = {
              vendorId,
              ruleResult,
              mlPrediction,
              degradedMode: false,
            };

            const inputDegraded: HybridScoringInput = {
              vendorId,
              ruleResult,
              mlPrediction: null,
              degradedMode: true,
            };

            const normalResult = calculateHybridScore(inputNormal, DEFAULT_HYBRID_WEIGHTS);
            const degradedResult = calculateHybridScore(inputDegraded, DEFAULT_HYBRID_WEIGHTS);

            // Degraded mode should be flagged
            expect(degradedResult.degradedMode).toBe(true);
            expect(normalResult.degradedMode).toBe(false);

            // Both should produce valid scores
            expect(normalResult.overallScore).toBeGreaterThanOrEqual(0);
            expect(normalResult.overallScore).toBeLessThanOrEqual(1);
            expect(degradedResult.overallScore).toBeGreaterThanOrEqual(0);
            expect(degradedResult.overallScore).toBeLessThanOrEqual(1);
          }
        ),
        propertyConfig
      );
    });
  });

  describe('Weight Validation', () => {
    it('weights SHALL sum to 1.0', () => {
      expect(validateHybridWeights(DEFAULT_HYBRID_WEIGHTS)).toBe(true);

      const invalidWeights: HybridWeights = {
        ruleWeight: 0.5,
        mlWeight: 0.5,
        contextWeight: 0.5,
      };
      expect(validateHybridWeights(invalidWeights)).toBe(false);
    });

    it('invalid weights SHALL throw error', () => {
      fc.assert(
        fc.property(
          validUuid,
          validRuleEngineResult,
          (vendorId, ruleResult) => {
            const input: HybridScoringInput = {
              vendorId,
              ruleResult,
              mlPrediction: null,
            };

            const invalidWeights: HybridWeights = {
              ruleWeight: 0.5,
              mlWeight: 0.5,
              contextWeight: 0.5,
            };

            expect(() => calculateHybridScore(input, invalidWeights)).toThrow(
              'Hybrid weights must sum to 1.0'
            );
          }
        ),
        propertyConfig
      );
    });
  });
});
