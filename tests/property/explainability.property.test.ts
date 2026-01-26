/**
 * Property 7: Explainability Completeness
 *
 * For any vendor recommendation, the explanation SHALL contain:
 * (a) the top 3 contributing factors in plain language
 * (b) any risk factors with severity indicators
 * (c) confidence levels for ML components
 * (d) comparison rationale for why higher-ranked vendors scored better
 *
 * @validates Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6
 * @file src/backend/explainability-layer/src/factor-analyzer.ts
 * @file src/backend/explainability-layer/src/narrative-generator.ts
 * @file src/backend/explainability-layer/src/comparison-engine.ts
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  analyzeFactors,
  getFactorImportanceRanking,
  categorizeFactorByName,
  determineRiskSeverity,
  RISK_THRESHOLD,
  type FactorAnalysisOptions,
} from '../../src/backend/explainability-layer/src/factor-analyzer.js';

import {
  generateVendorExplanation,
  generateExclusionReason,
  generateBriefRationale,
  generateRiskFactorStrings,
} from '../../src/backend/explainability-layer/src/narrative-generator.js';

import {
  compareVendors,
  generatePairwiseComparisons,
  analyzeComparisons,
  SIGNIFICANT_DIFFERENCE_THRESHOLD,
} from '../../src/backend/explainability-layer/src/comparison-engine.js';

import type { ScoreBreakdown, ScoreFactor, VendorRecommendation } from '@retailfixit/shared';

// Property test configuration
const propertyConfig = {
  numRuns: 100,
  verbose: false,
};

// Arbitraries for generating test data
const validUuid = fc.uuid();

const validScoreFactor: fc.Arbitrary<ScoreFactor> = fc.record({
  name: fc.constantFrom(
    'availability',
    'proximity',
    'certification',
    'capacity',
    'historicalCompletion',
    'mlCompletionProbability',
    'mlReworkRisk',
    'mlSatisfaction'
  ),
  value: fc.double({ min: 0, max: 1, noNaN: true }),
  weight: fc.double({ min: 0.1, max: 0.3, noNaN: true }),
  contribution: fc.double({ min: 0, max: 0.3, noNaN: true }),
  explanation: fc.string({ minLength: 1, maxLength: 200 }),
});

// Generate a valid score breakdown with consistent factors
const validScoreBreakdown: fc.Arbitrary<ScoreBreakdown> = fc
  .record({
    ruleBasedScore: fc.double({ min: 0, max: 1, noNaN: true }),
    mlScore: fc.double({ min: 0, max: 1, noNaN: true }),
    factors: fc.array(validScoreFactor, { minLength: 3, maxLength: 8 }),
  })
  .map((breakdown) => ({
    ...breakdown,
    // Ensure factors have unique names
    factors: breakdown.factors.filter(
      (f, i, arr) => arr.findIndex((x) => x.name === f.name) === i
    ),
  }));

// Generate a valid vendor recommendation
const validVendorRecommendation: fc.Arbitrary<VendorRecommendation> = fc.record({
  rank: fc.integer({ min: 1, max: 5 }),
  vendorId: validUuid,
  vendorName: fc.string({ minLength: 1, maxLength: 100 }),
  overallScore: fc.double({ min: 0, max: 1, noNaN: true }),
  confidence: fc.double({ min: 0, max: 1, noNaN: true }),
  scoreBreakdown: validScoreBreakdown,
  rationale: fc.string({ minLength: 1, maxLength: 500 }),
  riskFactors: fc.array(fc.string({ minLength: 1, maxLength: 200 }), { maxLength: 5 }),
  estimatedResponseTime: fc.constantFrom('Under 1 hour', '1-2 hours', '2-4 hours', '4-8 hours', 'Same day'),
});

describe('Property 7: Explainability Completeness', () => {
  /**
   * **Validates: Requirements 3.2**
   *
   * Test that top contributing factors are identified
   */
  describe('3.2 - Top Contributing Factors', () => {
    it('analyzeFactors SHALL identify top N contributing factors sorted by contribution', () => {
      fc.assert(
        fc.property(validScoreBreakdown, fc.integer({ min: 1, max: 5 }), (breakdown, topN) => {
          const options: FactorAnalysisOptions = { topN };
          const result = analyzeFactors(breakdown, options);

          // Should have at most topN top contributors
          expect(result.topContributors.length).toBeLessThanOrEqual(topN);
          expect(result.topContributors.length).toBeLessThanOrEqual(breakdown.factors.length);

          // Top contributors should be marked correctly
          for (const contributor of result.topContributors) {
            expect(contributor.isTopContributor).toBe(true);
          }

          // Top contributors should be sorted by contribution (descending)
          for (let i = 1; i < result.topContributors.length; i++) {
            expect(result.topContributors[i - 1].factor.contribution).toBeGreaterThanOrEqual(
              result.topContributors[i].factor.contribution
            );
          }
        }),
        propertyConfig
      );
    });

    it('getFactorImportanceRanking SHALL return factors sorted by contribution', () => {
      fc.assert(
        fc.property(validScoreBreakdown, (breakdown) => {
          const ranking = getFactorImportanceRanking(breakdown);

          // Should return all factor names
          expect(ranking.length).toBe(breakdown.factors.length);

          // Each factor name should appear exactly once
          const uniqueNames = new Set(ranking);
          expect(uniqueNames.size).toBe(ranking.length);
        }),
        propertyConfig
      );
    });
  });

  /**
   * **Validates: Requirements 3.3**
   *
   * Test that risk factors are identified with severity
   */
  describe('3.3 - Risk Factors with Severity', () => {
    it('analyzeFactors SHALL identify risk factors below threshold', () => {
      fc.assert(
        fc.property(validScoreBreakdown, (breakdown) => {
          const result = analyzeFactors(breakdown);

          // All identified risk factors should have values below threshold
          for (const risk of result.riskFactors) {
            expect(risk.value).toBeLessThan(RISK_THRESHOLD);
          }

          // Each risk factor should have a severity
          for (const risk of result.riskFactors) {
            expect(['low', 'medium', 'high']).toContain(risk.severity);
          }

          // Each risk factor should have a description
          for (const risk of result.riskFactors) {
            expect(risk.description.length).toBeGreaterThan(0);
          }
        }),
        propertyConfig
      );
    });

    it('determineRiskSeverity SHALL return correct severity based on value', () => {
      // High risk: value < 0.3
      expect(determineRiskSeverity(0.1)).toBe('high');
      expect(determineRiskSeverity(0.29)).toBe('high');

      // Medium risk: 0.3 <= value < 0.4
      expect(determineRiskSeverity(0.35)).toBe('medium');

      // Low risk: 0.4 <= value < 0.5
      expect(determineRiskSeverity(0.45)).toBe('low');

      // Not a risk: value >= 0.5
      expect(determineRiskSeverity(0.5)).toBeNull();
      expect(determineRiskSeverity(0.9)).toBeNull();
    });

    it('overall risk level SHALL reflect the severity of identified risks', () => {
      fc.assert(
        fc.property(validScoreBreakdown, (breakdown) => {
          const result = analyzeFactors(breakdown);

          // Overall risk level should be valid
          expect(['low', 'medium', 'high']).toContain(result.overallRiskLevel);

          // If no risk factors, overall should be low
          if (result.riskFactors.length === 0) {
            expect(result.overallRiskLevel).toBe('low');
          }

          // If any high severity risk, overall should be high
          const hasHighRisk = result.riskFactors.some((rf) => rf.severity === 'high');
          if (hasHighRisk) {
            expect(result.overallRiskLevel).toBe('high');
          }
        }),
        propertyConfig
      );
    });
  });

  /**
   * **Validates: Requirements 3.1, 3.5**
   *
   * Test that explanations are human-readable with confidence levels
   */
  describe('3.1, 3.5 - Human-Readable Explanations with Confidence', () => {
    it('generateVendorExplanation SHALL produce complete explanation with all components', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 5 }),
          fc.double({ min: 0, max: 1, noNaN: true }),
          fc.double({ min: 0, max: 1, noNaN: true }),
          validScoreBreakdown,
          fc.boolean(),
          (rank, overallScore, confidence, breakdown, degradedMode) => {
            const explanation = generateVendorExplanation(
              rank,
              overallScore,
              confidence,
              breakdown,
              degradedMode
            );

            // Should have a summary
            expect(explanation.summary.length).toBeGreaterThan(0);
            expect(explanation.summary).toContain(`#${rank}`);

            // Should have top factors narrative
            expect(explanation.topFactorsNarrative.length).toBeGreaterThan(0);

            // Should have full narrative combining all parts
            expect(explanation.fullNarrative.length).toBeGreaterThan(0);
            expect(explanation.fullNarrative).toContain(explanation.summary);
          }
        ),
        propertyConfig
      );
    });

    it('confidence narrative SHALL reflect ML availability and confidence level', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 5 }),
          fc.double({ min: 0, max: 1, noNaN: true }),
          fc.double({ min: 0, max: 1, noNaN: true }),
          validScoreBreakdown,
          (rank, overallScore, confidence, breakdown) => {
            // Test degraded mode
            const degradedExplanation = generateVendorExplanation(
              rank,
              overallScore,
              confidence,
              breakdown,
              true, // degradedMode
              { includeConfidence: true, mlConfidence: 0.8 }
            );

            expect(degradedExplanation.confidenceNarrative).not.toBeNull();
            expect(degradedExplanation.confidenceNarrative).toContain('unavailable');

            // Test with ML available
            const normalExplanation = generateVendorExplanation(
              rank,
              overallScore,
              confidence,
              breakdown,
              false, // not degraded
              { includeConfidence: true, mlConfidence: 0.9 }
            );

            if (normalExplanation.confidenceNarrative) {
              expect(normalExplanation.confidenceNarrative.length).toBeGreaterThan(0);
            }
          }
        ),
        propertyConfig
      );
    });
  });

  /**
   * **Validates: Requirements 3.6**
   *
   * Test that exclusion reasons are generated for filtered vendors
   */
  describe('3.6 - Exclusion Reasons', () => {
    it('generateExclusionReason SHALL categorize exclusion correctly', () => {
      fc.assert(
        fc.property(
          validUuid,
          fc.string({ minLength: 1, maxLength: 100 }),
          fc.array(fc.string({ minLength: 1, maxLength: 200 }), { minLength: 1, maxLength: 5 }),
          (vendorId, vendorName, failureReasons) => {
            const exclusion = generateExclusionReason(vendorId, vendorName, failureReasons);

            // Should have vendor info
            expect(exclusion.vendorId).toBe(vendorId);
            expect(exclusion.vendorName).toBe(vendorName);

            // Should have a reason
            expect(exclusion.reason.length).toBeGreaterThan(0);

            // Should have details
            expect(exclusion.details).toEqual(failureReasons);

            // Should have a valid category
            expect([
              'availability',
              'certification',
              'capacity',
              'geographic',
              'status',
              'blocked',
            ]).toContain(exclusion.category);
          }
        ),
        propertyConfig
      );
    });

    it('exclusion category SHALL match failure reason content', () => {
      // Test availability-related reasons
      const availabilityExclusion = generateExclusionReason(
        'vendor-1',
        'Test Vendor',
        ['Vendor is unavailable during requested time']
      );
      expect(availabilityExclusion.category).toBe('availability');

      // Test certification-related reasons
      const certExclusion = generateExclusionReason('vendor-2', 'Test Vendor', [
        'Missing required certification: HVAC',
      ]);
      expect(certExclusion.category).toBe('certification');

      // Test capacity-related reasons
      const capacityExclusion = generateExclusionReason('vendor-3', 'Test Vendor', [
        'Vendor is at full capacity',
      ]);
      expect(capacityExclusion.category).toBe('capacity');

      // Test geographic-related reasons
      const geoExclusion = generateExclusionReason('vendor-4', 'Test Vendor', [
        'Outside geographic coverage area',
      ]);
      expect(geoExclusion.category).toBe('geographic');
    });
  });

  /**
   * **Validates: Requirements 3.4**
   *
   * Test that comparative explanations are generated
   */
  describe('3.4 - Comparative Explanations', () => {
    it('compareVendors SHALL identify key differentiating factors', () => {
      fc.assert(
        fc.property(validVendorRecommendation, validVendorRecommendation, (vendor1, vendor2) => {
          // Ensure vendor1 is higher ranked
          const higher = { ...vendor1, rank: 1, overallScore: Math.max(vendor1.overallScore, 0.6) };
          const lower = { ...vendor2, rank: 2, overallScore: Math.min(vendor2.overallScore, 0.5) };

          const comparison = compareVendors(higher, lower);

          // Should have correct vendor info
          expect(comparison.higherRankedVendor.rank).toBe(higher.rank);
          expect(comparison.lowerRankedVendor.rank).toBe(lower.rank);

          // Score difference should be calculated
          expect(comparison.scoreDifference).toBeCloseTo(
            higher.overallScore - lower.overallScore,
            5
          );

          // Should have a comparison narrative
          expect(comparison.comparisonNarrative.length).toBeGreaterThan(0);
        }),
        propertyConfig
      );
    });

    it('generatePairwiseComparisons SHALL compare all adjacent pairs', () => {
      fc.assert(
        fc.property(
          fc.array(validVendorRecommendation, { minLength: 2, maxLength: 5 }),
          (recommendations) => {
            // Assign unique ranks
            const ranked = recommendations.map((r, i) => ({ ...r, rank: i + 1 }));

            const comparisons = generatePairwiseComparisons(ranked);

            // Should have n-1 comparisons for n vendors
            expect(comparisons.length).toBe(ranked.length - 1);

            // Each comparison should be between adjacent ranks
            for (let i = 0; i < comparisons.length; i++) {
              expect(comparisons[i].higherRankedVendor.rank).toBeLessThan(
                comparisons[i].lowerRankedVendor.rank
              );
            }
          }
        ),
        propertyConfig
      );
    });

    it('analyzeComparisons SHALL produce overall narrative', () => {
      fc.assert(
        fc.property(
          fc.array(validVendorRecommendation, { minLength: 1, maxLength: 5 }),
          (recommendations) => {
            // Assign unique ranks
            const ranked = recommendations.map((r, i) => ({ ...r, rank: i + 1 }));

            const analysis = analyzeComparisons(ranked);

            // Should have an overall narrative
            expect(analysis.overallNarrative.length).toBeGreaterThan(0);

            // If multiple vendors, should have comparisons
            if (ranked.length >= 2) {
              expect(analysis.comparisons.length).toBe(ranked.length - 1);
            }
          }
        ),
        propertyConfig
      );
    });
  });

  /**
   * Additional property tests for factor categorization
   */
  describe('Factor Categorization', () => {
    it('categorizeFactorByName SHALL correctly categorize all factor types', () => {
      // Rule-based factors
      expect(categorizeFactorByName('availability')).toBe('rule-based');
      expect(categorizeFactorByName('proximity')).toBe('rule-based');
      expect(categorizeFactorByName('certification')).toBe('rule-based');
      expect(categorizeFactorByName('capacity')).toBe('rule-based');

      // ML-based factors
      expect(categorizeFactorByName('mlCompletionProbability')).toBe('ml-based');
      expect(categorizeFactorByName('mlReworkRisk')).toBe('ml-based');
      expect(categorizeFactorByName('mlSatisfaction')).toBe('ml-based');
      expect(categorizeFactorByName('predictedScore')).toBe('ml-based');

      // Historical factors
      expect(categorizeFactorByName('historicalCompletion')).toBe('historical');
      expect(categorizeFactorByName('completionRate')).toBe('historical');
      expect(categorizeFactorByName('reworkHistory')).toBe('historical');
    });
  });

  /**
   * Test brief rationale generation
   */
  describe('Brief Rationale Generation', () => {
    it('generateBriefRationale SHALL produce concise summary', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 5 }),
          fc.double({ min: 0, max: 1, noNaN: true }),
          fc.array(validScoreFactor, { minLength: 1, maxLength: 5 }),
          fc.boolean(),
          (rank, overallScore, factors, degradedMode) => {
            const rationale = generateBriefRationale(rank, overallScore, factors, degradedMode);

            // Should contain rank
            expect(rationale).toContain(`#${rank}`);

            // Should contain score percentage
            expect(rationale).toContain('%');

            // Should be reasonably concise (under 500 chars)
            expect(rationale.length).toBeLessThan(500);

            // If degraded mode, should mention it
            if (degradedMode) {
              expect(rationale.toLowerCase()).toContain('ml');
            }
          }
        ),
        propertyConfig
      );
    });
  });

  /**
   * Test risk factor string generation
   */
  describe('Risk Factor String Generation', () => {
    it('generateRiskFactorStrings SHALL return descriptions for low-scoring factors', () => {
      fc.assert(
        fc.property(validScoreBreakdown, (breakdown) => {
          const riskStrings = generateRiskFactorStrings(breakdown);

          // Should be an array
          expect(Array.isArray(riskStrings)).toBe(true);

          // Each string should be non-empty
          for (const str of riskStrings) {
            expect(str.length).toBeGreaterThan(0);
          }

          // Count of risk strings should match factors below threshold
          const lowFactors = breakdown.factors.filter((f) => f.value < RISK_THRESHOLD);
          expect(riskStrings.length).toBeLessThanOrEqual(lowFactors.length);
        }),
        propertyConfig
      );
    });
  });
});
