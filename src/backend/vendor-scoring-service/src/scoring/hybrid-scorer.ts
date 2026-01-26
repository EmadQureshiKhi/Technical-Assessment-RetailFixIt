/**
 * Hybrid Score Aggregator
 *
 * Combines rule-based and ML scores with configurable weights to produce
 * a final hybrid score. Implements tie-breaking logic and confidence calculation.
 *
 * @requirement 1.3 - Calculate scores using hybrid approach combining rules and ML
 * @requirement 1.7 - Tie-breaking rules based on availability and proximity
 * @requirement 2.4 - Configurable weights between rule-based and ML-based components
 */

import type { ScoreBreakdown, ScoreFactor } from '@retailfixit/shared';
import type { RuleEngineResult, VendorMetrics } from '../rules/rule-engine.js';
import type { MLPrediction } from '../ml/ml-client.js';

/**
 * Configuration for hybrid scoring weights
 * FinalScore = (α × RuleScore) + (β × MLScore) + (γ × ContextBonus)
 */
export interface HybridWeights {
  ruleWeight: number; // α - default 0.4
  mlWeight: number; // β - default 0.5
  contextWeight: number; // γ - default 0.1
}

/**
 * Default hybrid weights as specified in the design document
 */
export const DEFAULT_HYBRID_WEIGHTS: HybridWeights = {
  ruleWeight: 0.4,
  mlWeight: 0.5,
  contextWeight: 0.1,
};

/**
 * Context bonus factors for additional scoring adjustments
 */
export interface ContextFactors {
  customerPreferred: boolean; // Is this a customer-preferred vendor?
  recentSuccess: boolean; // Has vendor had recent successful jobs?
  slaUrgency: number; // 0-1: How urgent is the SLA?
}

/**
 * Default context factors
 */
export const DEFAULT_CONTEXT_FACTORS: ContextFactors = {
  customerPreferred: false,
  recentSuccess: false,
  slaUrgency: 0.5,
};

/**
 * Result from hybrid scoring
 */
export interface HybridScoreResult {
  overallScore: number;
  confidence: number;
  ruleBasedScore: number;
  mlScore: number;
  contextBonus: number;
  scoreBreakdown: ScoreBreakdown;
  degradedMode: boolean;
  tieBreakFactors: TieBreakFactors;
}

/**
 * Factors used for tie-breaking when scores are equal
 */
export interface TieBreakFactors {
  availabilityScore: number;
  proximityScore: number;
  vendorId: string;
}

/**
 * Input for hybrid scoring
 */
export interface HybridScoringInput {
  vendorId: string;
  ruleResult: RuleEngineResult;
  mlPrediction: MLPrediction | null;
  vendorMetrics?: VendorMetrics;
  contextFactors?: ContextFactors;
  degradedMode?: boolean;
}

/**
 * Validates that hybrid weights sum to 1.0
 */
export function validateHybridWeights(weights: HybridWeights): boolean {
  const sum = weights.ruleWeight + weights.mlWeight + weights.contextWeight;
  return Math.abs(sum - 1.0) < 0.001;
}


/**
 * Calculates ML score from prediction
 * Combines completion probability, rework risk, and satisfaction into a single score
 */
export function calculateMLScore(prediction: MLPrediction | null): number {
  if (!prediction) {
    return 0;
  }

  // Weight the ML prediction components
  // Higher completion probability is better
  // Lower rework risk is better (invert it)
  // Higher satisfaction is better (normalize to 0-1)
  const completionWeight = 0.4;
  const reworkWeight = 0.3;
  const satisfactionWeight = 0.3;

  const completionScore = prediction.completionProbability;
  const reworkScore = 1 - prediction.reworkRisk; // Invert: lower risk = higher score
  const satisfactionScore = prediction.predictedSatisfaction / 5; // Normalize 0-5 to 0-1

  return (
    completionScore * completionWeight +
    reworkScore * reworkWeight +
    satisfactionScore * satisfactionWeight
  );
}

/**
 * Calculates context bonus based on additional factors
 */
export function calculateContextBonus(contextFactors: ContextFactors): number {
  let bonus = 0;

  // Customer preferred vendor gets a boost
  if (contextFactors.customerPreferred) {
    bonus += 0.3;
  }

  // Recent success gets a small boost
  if (contextFactors.recentSuccess) {
    bonus += 0.2;
  }

  // SLA urgency affects scoring (higher urgency = more weight on fast vendors)
  bonus += contextFactors.slaUrgency * 0.5;

  // Normalize to 0-1 range
  return Math.min(1, Math.max(0, bonus));
}

/**
 * Calculates overall confidence based on data quality and ML confidence
 *
 * @requirement 1.5 - Vendors with insufficient data get appropriate confidence indicators
 */
export function calculateConfidence(
  _ruleResult: RuleEngineResult,
  mlPrediction: MLPrediction | null,
  vendorMetrics?: VendorMetrics,
  degradedMode: boolean = false
): number {
  // Base confidence from rule-based scoring
  let confidence = 0.5;

  // If we have ML predictions, factor in ML confidence
  if (mlPrediction && !degradedMode) {
    confidence = 0.3 + mlPrediction.confidence * 0.5;
  } else if (degradedMode) {
    // Degraded mode (no ML) reduces confidence
    confidence = 0.4;
  }

  // Adjust based on vendor metrics availability
  if (vendorMetrics) {
    // Higher completion rate increases confidence
    confidence += vendorMetrics.completionRate * 0.1;
    // Lower rework rate increases confidence
    confidence += (1 - vendorMetrics.reworkRate) * 0.1;
  } else {
    // No metrics = lower confidence (new vendor)
    confidence -= 0.2;
  }

  // Ensure confidence is in valid range
  return Math.min(1, Math.max(0, confidence));
}

/**
 * Extracts tie-break factors from rule engine result
 */
export function extractTieBreakFactors(
  vendorId: string,
  ruleResult: RuleEngineResult
): TieBreakFactors {
  const availabilityFactor = ruleResult.factors.find((f) => f.name === 'availability');
  const proximityFactor = ruleResult.factors.find((f) => f.name === 'proximity');

  return {
    availabilityScore: availabilityFactor?.value ?? 0,
    proximityScore: proximityFactor?.value ?? 0,
    vendorId,
  };
}

/**
 * Creates ML-based score factors for the breakdown
 */
function createMLFactors(prediction: MLPrediction | null): ScoreFactor[] {
  if (!prediction) {
    return [];
  }

  return [
    {
      name: 'mlCompletionProbability',
      value: prediction.completionProbability,
      weight: 0.4,
      contribution: prediction.completionProbability * 0.4,
      explanation: `ML predicts ${(prediction.completionProbability * 100).toFixed(1)}% completion probability`,
    },
    {
      name: 'mlReworkRisk',
      value: 1 - prediction.reworkRisk,
      weight: 0.3,
      contribution: (1 - prediction.reworkRisk) * 0.3,
      explanation: `ML predicts ${(prediction.reworkRisk * 100).toFixed(1)}% rework risk`,
    },
    {
      name: 'mlSatisfaction',
      value: prediction.predictedSatisfaction / 5,
      weight: 0.3,
      contribution: (prediction.predictedSatisfaction / 5) * 0.3,
      explanation: `ML predicts ${prediction.predictedSatisfaction.toFixed(1)}/5 customer satisfaction`,
    },
  ];
}


/**
 * Hybrid Score Aggregator
 *
 * Combines rule-based and ML scores with configurable weights to produce
 * a final hybrid score with detailed breakdown.
 *
 * @param input - Hybrid scoring input containing rule results and ML predictions
 * @param weights - Configurable weights for combining scores
 * @returns HybridScoreResult with overall score, confidence, and breakdown
 *
 * @requirement 1.3 - Hybrid scoring combining rules and ML
 * @requirement 1.7 - Tie-breaking logic
 * @requirement 2.4 - Configurable weights
 */
export function calculateHybridScore(
  input: HybridScoringInput,
  weights: HybridWeights = DEFAULT_HYBRID_WEIGHTS
): HybridScoreResult {
  // Validate weights
  if (!validateHybridWeights(weights)) {
    throw new Error('Hybrid weights must sum to 1.0');
  }

  const {
    vendorId,
    ruleResult,
    mlPrediction,
    vendorMetrics,
    contextFactors = DEFAULT_CONTEXT_FACTORS,
    degradedMode = false,
  } = input;

  // Calculate component scores
  const ruleBasedScore = ruleResult.ruleBasedScore;
  const mlScore = calculateMLScore(mlPrediction);
  const contextBonus = calculateContextBonus(contextFactors);

  // Calculate overall score using hybrid formula
  // FinalScore = (α × RuleScore) + (β × MLScore) + (γ × ContextBonus)
  let overallScore: number;

  if (degradedMode || !mlPrediction) {
    // In degraded mode, redistribute ML weight to rules
    const adjustedRuleWeight = weights.ruleWeight + weights.mlWeight;
    overallScore =
      ruleBasedScore * adjustedRuleWeight + contextBonus * weights.contextWeight;
  } else {
    overallScore =
      ruleBasedScore * weights.ruleWeight +
      mlScore * weights.mlWeight +
      contextBonus * weights.contextWeight;
  }

  // Ensure score is in valid range
  overallScore = Math.min(1, Math.max(0, overallScore));

  // Calculate confidence
  const confidence = calculateConfidence(
    ruleResult,
    mlPrediction,
    vendorMetrics,
    degradedMode
  );

  // Extract tie-break factors
  const tieBreakFactors = extractTieBreakFactors(vendorId, ruleResult);

  // Build score breakdown
  const mlFactors = createMLFactors(mlPrediction);
  const scoreBreakdown: ScoreBreakdown = {
    ruleBasedScore,
    mlScore,
    factors: [...ruleResult.factors, ...mlFactors],
  };

  return {
    overallScore,
    confidence,
    ruleBasedScore,
    mlScore,
    contextBonus,
    scoreBreakdown,
    degradedMode: degradedMode || !mlPrediction,
    tieBreakFactors,
  };
}

/**
 * Compares two hybrid score results for sorting
 * Implements tie-breaking based on availability (primary) and proximity (secondary)
 *
 * @requirement 1.7 - Tie-breaking rules
 * @returns negative if a should come first, positive if b should come first
 */
export function compareHybridScores(
  a: HybridScoreResult,
  b: HybridScoreResult
): number {
  // Primary sort: overall score (descending)
  const scoreDiff = b.overallScore - a.overallScore;
  if (Math.abs(scoreDiff) > 0.001) {
    return scoreDiff;
  }

  // Tie-breaking: availability score (higher is better)
  const availabilityDiff =
    b.tieBreakFactors.availabilityScore - a.tieBreakFactors.availabilityScore;
  if (Math.abs(availabilityDiff) > 0.001) {
    return availabilityDiff;
  }

  // Secondary tie-breaking: proximity score (higher is better)
  const proximityDiff =
    b.tieBreakFactors.proximityScore - a.tieBreakFactors.proximityScore;
  if (Math.abs(proximityDiff) > 0.001) {
    return proximityDiff;
  }

  // Final tie-breaking: vendor ID for determinism
  return a.tieBreakFactors.vendorId.localeCompare(b.tieBreakFactors.vendorId);
}

/**
 * Batch calculates hybrid scores for multiple vendors
 *
 * @param inputs - Array of hybrid scoring inputs
 * @param weights - Configurable weights
 * @returns Array of results sorted by score (descending)
 */
export function calculateHybridScores(
  inputs: HybridScoringInput[],
  weights: HybridWeights = DEFAULT_HYBRID_WEIGHTS
): Array<{ vendorId: string; result: HybridScoreResult }> {
  const results = inputs.map((input) => ({
    vendorId: input.vendorId,
    result: calculateHybridScore(input, weights),
  }));

  // Sort by hybrid score with tie-breaking
  return results.sort((a, b) => compareHybridScores(a.result, b.result));
}
