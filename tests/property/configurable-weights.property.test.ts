/**
 * Property 5: Configurable Weights Affect Scores
 *
 * For any two different weight configurations (α₁, β₁) and (α₂, β₂) applied to
 * the same job and vendor data, the resulting scores SHALL differ when rule-based
 * and ML-based component scores differ.
 *
 * @validates Requirements 2.4
 * @file src/backend/vendor-scoring-service/src/scoring/hybrid-scorer.ts
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  calculateHybridScore,
  validateHybridWeights,
  type HybridWeights,
  type HybridScoringInput,
} from '../../src/backend/vendor-scoring-service/src/scoring/hybrid-scorer.js';
import type { RuleEngineResult } from '../../src/backend/vendor-scoring-service/src/rules/rule-engine.js';
import type { MLPrediction } from '../../src/backend/vendor-scoring-service/src/ml/ml-client.js';

// Property test configuration
const propertyConfig = {
  numRuns: 100,
  verbose: false,
};

// Arbitraries for generating test data
const validUuid = fc.uuid();

// Generate valid weights that sum to 1.0
const validHybridWeights: fc.Arbitrary<HybridWeights> = fc
  .tuple(
    fc.double({ min: 0.1, max: 0.6, noNaN: true }),
    fc.double({ min: 0.1, max: 0.6, noNaN: true })
  )
  .map(([ruleWeight, mlWeight]) => {
    const contextWeight = Math.max(0, 1 - ruleWeight - mlWeight);
    // Normalize to ensure sum is exactly 1.0
    const total = ruleWeight + mlWeight + contextWeight;
    return {
      ruleWeight: ruleWeight / total,
      mlWeight: mlWeight / total,
      contextWeight: contextWeight / total,
    };
  })
  .filter((w) => validateHybridWeights(w));

// Generate two different weight configurations
const differentWeightPairs: fc.Arbitrary<[HybridWeights, HybridWeights]> = fc
  .tuple(validHybridWeights, validHybridWeights)
  .filter(([w1, w2]) => {
    // Ensure weights are meaningfully different
    const ruleWeightDiff = Math.abs(w1.ruleWeight - w2.ruleWeight);
    const mlWeightDiff = Math.abs(w1.mlWeight - w2.mlWeight);
    return ruleWeightDiff > 0.05 || mlWeightDiff > 0.05;
  });

const validMLPrediction: fc.Arbitrary<MLPrediction> = fc.record({
  completionProbability: fc.double({ min: 0.1, max: 0.9, noNaN: true }),
  timeToComplete: fc.double({ min: 0.5, max: 48, noNaN: true }),
  reworkRisk: fc.double({ min: 0.1, max: 0.9, noNaN: true }),
  predictedSatisfaction: fc.double({ min: 1, max: 5, noNaN: true }),
  confidence: fc.double({ min: 0.3, max: 0.9, noNaN: true }),
});

// Generate rule engine result with specific score
const ruleEngineResultWithScore = (score: number): RuleEngineResult => ({
  passed: true,
  ruleBasedScore: score,
  factors: [
    { name: 'availability', value: score, weight: 0.25, contribution: score * 0.25, explanation: 'Available' },
    { name: 'proximity', value: score, weight: 0.20, contribution: score * 0.20, explanation: 'Close' },
    { name: 'certification', value: score, weight: 0.20, contribution: score * 0.20, explanation: 'Certified' },
    { name: 'capacity', value: score, weight: 0.15, contribution: score * 0.15, explanation: 'Has capacity' },
    { name: 'historicalCompletion', value: score, weight: 0.20, contribution: score * 0.20, explanation: 'Good history' },
  ],
  failureReasons: [],
});

describe('Property 5: Configurable Weights Affect Scores', () => {
  /**
   * **Validates: Requirements 2.4**
   *
   * Test that different weights produce different scores
   */
  describe('Weight Configuration Impact', () => {
    it('different weights SHALL produce different scores when component scores differ', () => {
      fc.assert(
        fc.property(
          validUuid,
          differentWeightPairs,
          fc.double({ min: 0.3, max: 0.7, noNaN: true }), // rule score
          validMLPrediction,
          (vendorId, [weights1, weights2], ruleScore, mlPrediction) => {
            const ruleResult = ruleEngineResultWithScore(ruleScore);

            const input: HybridScoringInput = {
              vendorId,
              ruleResult,
              mlPrediction,
              degradedMode: false,
            };

            const result1 = calculateHybridScore(input, weights1);
            const result2 = calculateHybridScore(input, weights2);

            // When weights differ significantly and component scores differ,
            // the overall scores should be different
            const ruleBasedScore = ruleResult.ruleBasedScore;
            const mlScore = result1.mlScore; // ML score is same for both

            // If rule and ML scores are different, different weights should produce different results
            if (Math.abs(ruleBasedScore - mlScore) > 0.1) {
              const scoreDiff = Math.abs(result1.overallScore - result2.overallScore);
              // Scores should differ when weights differ and component scores differ
              expect(scoreDiff).toBeGreaterThan(0);
            }
          }
        ),
        propertyConfig
      );
    });

    it('higher rule weight SHALL increase influence of rule-based score', () => {
      fc.assert(
        fc.property(
          validUuid,
          validMLPrediction,
          (vendorId, mlPrediction) => {
            // Create scenario where rule score is high and ML score is low
            const highRuleResult = ruleEngineResultWithScore(0.9);

            const input: HybridScoringInput = {
              vendorId,
              ruleResult: highRuleResult,
              mlPrediction: {
                ...mlPrediction,
                completionProbability: 0.3,
                reworkRisk: 0.7,
                predictedSatisfaction: 2.0,
              },
              degradedMode: false,
            };

            // High rule weight
            const highRuleWeights: HybridWeights = {
              ruleWeight: 0.7,
              mlWeight: 0.2,
              contextWeight: 0.1,
            };

            // High ML weight
            const highMLWeights: HybridWeights = {
              ruleWeight: 0.2,
              mlWeight: 0.7,
              contextWeight: 0.1,
            };

            const highRuleResult2 = calculateHybridScore(input, highRuleWeights);
            const highMLResult = calculateHybridScore(input, highMLWeights);

            // With high rule score and low ML score:
            // - High rule weight should produce higher overall score
            // - High ML weight should produce lower overall score
            expect(highRuleResult2.overallScore).toBeGreaterThan(highMLResult.overallScore);
          }
        ),
        propertyConfig
      );
    });

    it('higher ML weight SHALL increase influence of ML-based score', () => {
      fc.assert(
        fc.property(
          validUuid,
          validMLPrediction,
          (vendorId, mlPrediction) => {
            // Create scenario where ML score is high and rule score is low
            const lowRuleResult = ruleEngineResultWithScore(0.3);

            const input: HybridScoringInput = {
              vendorId,
              ruleResult: lowRuleResult,
              mlPrediction: {
                ...mlPrediction,
                completionProbability: 0.9,
                reworkRisk: 0.1,
                predictedSatisfaction: 4.5,
              },
              degradedMode: false,
            };

            // High rule weight
            const highRuleWeights: HybridWeights = {
              ruleWeight: 0.7,
              mlWeight: 0.2,
              contextWeight: 0.1,
            };

            // High ML weight
            const highMLWeights: HybridWeights = {
              ruleWeight: 0.2,
              mlWeight: 0.7,
              contextWeight: 0.1,
            };

            const highRuleResult2 = calculateHybridScore(input, highRuleWeights);
            const highMLResult = calculateHybridScore(input, highMLWeights);

            // With low rule score and high ML score:
            // - High ML weight should produce higher overall score
            // - High rule weight should produce lower overall score
            expect(highMLResult.overallScore).toBeGreaterThan(highRuleResult2.overallScore);
          }
        ),
        propertyConfig
      );
    });
  });

  describe('Weight Validation', () => {
    it('valid weights SHALL sum to 1.0', () => {
      fc.assert(
        fc.property(validHybridWeights, (weights) => {
          expect(validateHybridWeights(weights)).toBe(true);
          const sum = weights.ruleWeight + weights.mlWeight + weights.contextWeight;
          expect(Math.abs(sum - 1.0)).toBeLessThan(0.001);
        }),
        propertyConfig
      );
    });

    it('weights not summing to 1.0 SHALL be invalid', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 0.1, max: 0.5, noNaN: true }),
          fc.double({ min: 0.1, max: 0.5, noNaN: true }),
          fc.double({ min: 0.1, max: 0.5, noNaN: true }),
          (w1, w2, w3) => {
            const weights: HybridWeights = {
              ruleWeight: w1,
              mlWeight: w2,
              contextWeight: w3,
            };
            const sum = w1 + w2 + w3;
            
            // If sum is not close to 1.0, validation should fail
            if (Math.abs(sum - 1.0) > 0.01) {
              expect(validateHybridWeights(weights)).toBe(false);
            }
          }
        ),
        propertyConfig
      );
    });
  });

  describe('Score Consistency', () => {
    it('same weights SHALL produce same scores for same input', () => {
      fc.assert(
        fc.property(
          validUuid,
          validHybridWeights,
          fc.double({ min: 0.3, max: 0.9, noNaN: true }),
          validMLPrediction,
          (vendorId, weights, ruleScore, mlPrediction) => {
            const ruleResult = ruleEngineResultWithScore(ruleScore);

            const input: HybridScoringInput = {
              vendorId,
              ruleResult,
              mlPrediction,
              degradedMode: false,
            };

            const result1 = calculateHybridScore(input, weights);
            const result2 = calculateHybridScore(input, weights);

            // Same input and weights should produce identical results
            expect(result1.overallScore).toBe(result2.overallScore);
            expect(result1.confidence).toBe(result2.confidence);
            expect(result1.ruleBasedScore).toBe(result2.ruleBasedScore);
            expect(result1.mlScore).toBe(result2.mlScore);
          }
        ),
        propertyConfig
      );
    });
  });
});
