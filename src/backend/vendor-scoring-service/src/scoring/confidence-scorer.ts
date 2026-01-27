/**
 * Confidence Scoring and Abstention
 *
 * Calculates confidence scores based on data quality and model certainty.
 * Implements abstention logic for low confidence scenarios.
 *
 * @requirement 18.1 - Calculate confidence score for each recommendation
 * @requirement 18.2 - Abstain from automatic dispatch when confidence is below threshold
 * @requirement 18.3 - Explain factors contributing to low confidence
 */

import type { ScoreBreakdown, VendorRecommendation } from '@retailfixit/shared';
import type { MLPrediction } from '../ml/ml-client.js';
import type { VendorMetrics } from '../rules/rule-engine.js';

/**
 * Confidence thresholds for different actions
 */
export const CONFIDENCE_THRESHOLDS = {
  /** Below this, system abstains entirely from recommendation */
  ABSTENTION: 0.4,
  /** Below this, requires human review */
  HUMAN_REVIEW: 0.7,
  /** Above this, can proceed with auto dispatch */
  AUTO_DISPATCH: 0.85,
} as const;

/**
 * Factors that contribute to confidence calculation
 */
export interface ConfidenceFactors {
  /** Quality of input data (0-1) */
  dataQuality: number;
  /** ML model's reported confidence (0-1) */
  modelCertainty: number;
  /** Historical data availability for vendor (0-1) */
  historicalDataAvailability: number;
  /** Feature completeness - how many features were available (0-1) */
  featureCompleteness: number;
  /** Prediction consistency - how consistent are different model outputs (0-1) */
  predictionConsistency: number;
}

/**
 * Result of confidence scoring
 */
export interface ConfidenceScoreResult {
  /** Overall confidence score (0-1) */
  overallConfidence: number;
  /** Individual factor contributions */
  factors: ConfidenceFactors;
  /** Whether the system should abstain from making a recommendation */
  shouldAbstain: boolean;
  /** Whether human review is required */
  requiresHumanReview: boolean;
  /** Human-readable explanation of confidence level */
  explanation: string;
  /** Specific factors contributing to low confidence */
  lowConfidenceReasons: string[];
}

/**
 * Input for confidence calculation
 */
export interface ConfidenceScoringInput {
  /** ML prediction results (null if unavailable) */
  mlPrediction: MLPrediction | null;
  /** Vendor historical metrics */
  vendorMetrics: VendorMetrics | null;
  /** Score breakdown from hybrid scoring */
  scoreBreakdown: ScoreBreakdown;
  /** Whether system is in degraded mode (no ML) */
  degradedMode: boolean;
  /** Number of data points used for vendor scoring */
  vendorDataPoints: number;
  /** Total features available vs expected */
  availableFeatures: number;
  /** Total expected features */
  expectedFeatures: number;
}

/**
 * Weights for combining confidence factors
 */
const CONFIDENCE_WEIGHTS = {
  dataQuality: 0.25,
  modelCertainty: 0.30,
  historicalDataAvailability: 0.20,
  featureCompleteness: 0.15,
  predictionConsistency: 0.10,
} as const;

/**
 * Minimum data points for reliable vendor scoring
 */
const MIN_RELIABLE_DATA_POINTS = 10;

/**
 * Calculates data quality score based on available information
 */
export function calculateDataQuality(input: ConfidenceScoringInput): number {
  let quality = 0.5; // Base quality

  // Vendor metrics availability
  if (input.vendorMetrics) {
    quality += 0.2;
    
    // Quality of metrics themselves
    if (input.vendorMetrics.completionRate > 0) quality += 0.1;
    if (input.vendorMetrics.avgResponseTimeHours > 0) quality += 0.05;
    if (input.vendorMetrics.avgCustomerSatisfaction > 0) quality += 0.05;
  }

  // Score breakdown completeness
  if (input.scoreBreakdown.factors.length >= 5) {
    quality += 0.1;
  }

  return Math.min(1, Math.max(0, quality));
}

/**
 * Calculates model certainty from ML prediction
 */
export function calculateModelCertainty(
  mlPrediction: MLPrediction | null,
  degradedMode: boolean
): number {
  if (degradedMode || !mlPrediction) {
    // No ML available - reduced certainty
    return 0.3;
  }

  // Use ML model's reported confidence
  let certainty = mlPrediction.confidence;

  // Adjust based on prediction values
  // Very extreme predictions (near 0 or 1) may indicate overconfidence
  const completionProb = mlPrediction.completionProbability;
  if (completionProb > 0.95 || completionProb < 0.05) {
    certainty *= 0.9; // Slight penalty for extreme predictions
  }

  // Consistency check: if rework risk is high but completion prob is also high, reduce certainty
  if (mlPrediction.reworkRisk > 0.5 && completionProb > 0.8) {
    certainty *= 0.85;
  }

  return Math.min(1, Math.max(0, certainty));
}

/**
 * Calculates historical data availability score
 */
export function calculateHistoricalDataAvailability(
  vendorDataPoints: number,
  vendorMetrics: VendorMetrics | null
): number {
  if (!vendorMetrics) {
    return 0.2; // New vendor with no history
  }

  // Scale based on data points
  const dataPointScore = Math.min(1, vendorDataPoints / MIN_RELIABLE_DATA_POINTS);
  
  // Bonus for having comprehensive metrics
  let metricsBonus = 0;
  if (vendorMetrics.completionRate > 0) metricsBonus += 0.1;
  if (vendorMetrics.reworkRate >= 0) metricsBonus += 0.1;
  if (vendorMetrics.avgResponseTimeHours > 0) metricsBonus += 0.1;

  return Math.min(1, dataPointScore * 0.7 + metricsBonus);
}

/**
 * Calculates feature completeness score
 */
export function calculateFeatureCompleteness(
  availableFeatures: number,
  expectedFeatures: number
): number {
  if (expectedFeatures === 0) return 0.5;
  return Math.min(1, availableFeatures / expectedFeatures);
}

/**
 * Calculates prediction consistency score
 * Checks if different scoring components agree
 */
export function calculatePredictionConsistency(
  scoreBreakdown: ScoreBreakdown,
  mlPrediction: MLPrediction | null
): number {
  if (!mlPrediction) {
    return 0.6; // Moderate consistency without ML
  }

  // Compare rule-based and ML scores
  const scoreDiff = Math.abs(scoreBreakdown.ruleBasedScore - scoreBreakdown.mlScore);
  
  // Large differences indicate inconsistency
  if (scoreDiff > 0.4) return 0.3;
  if (scoreDiff > 0.3) return 0.5;
  if (scoreDiff > 0.2) return 0.7;
  if (scoreDiff > 0.1) return 0.85;
  
  return 0.95;
}

/**
 * Generates explanation for confidence level
 */
function generateConfidenceExplanation(
  confidence: number,
  _factors: ConfidenceFactors,
  shouldAbstain: boolean
): string {
  if (shouldAbstain) {
    return `Confidence is very low (${(confidence * 100).toFixed(1)}%). The system cannot make a reliable recommendation and abstains from automatic dispatch.`;
  }

  if (confidence >= CONFIDENCE_THRESHOLDS.AUTO_DISPATCH) {
    return `High confidence (${(confidence * 100).toFixed(1)}%). Recommendation is based on strong data quality and consistent predictions.`;
  }

  if (confidence >= CONFIDENCE_THRESHOLDS.HUMAN_REVIEW) {
    return `Moderate confidence (${(confidence * 100).toFixed(1)}%). Recommendation is reasonable but human review is recommended.`;
  }

  return `Low confidence (${(confidence * 100).toFixed(1)}%). Human review is required before proceeding with this recommendation.`;
}

/**
 * Identifies specific reasons for low confidence
 */
function identifyLowConfidenceReasons(
  factors: ConfidenceFactors,
  degradedMode: boolean
): string[] {
  const reasons: string[] = [];

  if (degradedMode) {
    reasons.push('ML predictions are unavailable; using rule-based scoring only');
  }

  if (factors.dataQuality < 0.5) {
    reasons.push('Limited data quality for accurate scoring');
  }

  if (factors.modelCertainty < 0.5) {
    reasons.push('ML model reports low certainty in predictions');
  }

  if (factors.historicalDataAvailability < 0.5) {
    reasons.push('Vendor has limited historical performance data');
  }

  if (factors.featureCompleteness < 0.7) {
    reasons.push('Some scoring features were unavailable');
  }

  if (factors.predictionConsistency < 0.6) {
    reasons.push('Rule-based and ML scores show significant disagreement');
  }

  return reasons;
}

/**
 * Calculates comprehensive confidence score
 *
 * @requirement 18.1 - Calculate confidence score for each recommendation
 * @requirement 18.2 - Abstain when confidence is below threshold
 * @requirement 18.3 - Explain factors contributing to low confidence
 */
export function calculateConfidenceScore(
  input: ConfidenceScoringInput
): ConfidenceScoreResult {
  // Calculate individual factors
  const factors: ConfidenceFactors = {
    dataQuality: calculateDataQuality(input),
    modelCertainty: calculateModelCertainty(input.mlPrediction, input.degradedMode),
    historicalDataAvailability: calculateHistoricalDataAvailability(
      input.vendorDataPoints,
      input.vendorMetrics
    ),
    featureCompleteness: calculateFeatureCompleteness(
      input.availableFeatures,
      input.expectedFeatures
    ),
    predictionConsistency: calculatePredictionConsistency(
      input.scoreBreakdown,
      input.mlPrediction
    ),
  };

  // Calculate weighted overall confidence
  const overallConfidence =
    factors.dataQuality * CONFIDENCE_WEIGHTS.dataQuality +
    factors.modelCertainty * CONFIDENCE_WEIGHTS.modelCertainty +
    factors.historicalDataAvailability * CONFIDENCE_WEIGHTS.historicalDataAvailability +
    factors.featureCompleteness * CONFIDENCE_WEIGHTS.featureCompleteness +
    factors.predictionConsistency * CONFIDENCE_WEIGHTS.predictionConsistency;

  // Determine abstention and review requirements
  const shouldAbstain = overallConfidence < CONFIDENCE_THRESHOLDS.ABSTENTION;
  const requiresHumanReview = overallConfidence < CONFIDENCE_THRESHOLDS.HUMAN_REVIEW;

  // Generate explanations
  const explanation = generateConfidenceExplanation(
    overallConfidence,
    factors,
    shouldAbstain
  );
  const lowConfidenceReasons = identifyLowConfidenceReasons(factors, input.degradedMode);

  return {
    overallConfidence,
    factors,
    shouldAbstain,
    requiresHumanReview,
    explanation,
    lowConfidenceReasons,
  };
}

/**
 * Abstention decision result
 */
export interface AbstentionDecision {
  /** Whether to abstain from recommendation */
  abstain: boolean;
  /** Reason for abstention */
  reason: string;
  /** Suggested action for operator */
  suggestedAction: string;
}

/**
 * Determines whether to abstain from making a recommendation
 *
 * @requirement 18.2 - Abstain from automatic dispatch when confidence is below threshold
 */
export function shouldAbstain(
  confidenceResult: ConfidenceScoreResult,
  customThreshold?: number
): AbstentionDecision {
  const threshold = customThreshold ?? CONFIDENCE_THRESHOLDS.ABSTENTION;
  const abstain = confidenceResult.overallConfidence < threshold;

  if (abstain) {
    return {
      abstain: true,
      reason: `Confidence (${(confidenceResult.overallConfidence * 100).toFixed(1)}%) is below abstention threshold (${(threshold * 100).toFixed(1)}%)`,
      suggestedAction: 'Manual vendor selection is required. The system cannot provide a reliable recommendation.',
    };
  }

  return {
    abstain: false,
    reason: 'Confidence is sufficient for recommendation',
    suggestedAction: confidenceResult.requiresHumanReview
      ? 'Review the recommendation before proceeding'
      : 'Recommendation can proceed automatically',
  };
}

/**
 * Enhances a vendor recommendation with confidence details
 */
export function enhanceRecommendationWithConfidence(
  recommendation: VendorRecommendation,
  confidenceResult: ConfidenceScoreResult
): VendorRecommendation & { confidenceDetails: ConfidenceScoreResult } {
  return {
    ...recommendation,
    confidence: confidenceResult.overallConfidence,
    confidenceDetails: confidenceResult,
  };
}

/**
 * Batch calculates confidence for multiple recommendations
 */
export function calculateBatchConfidence(
  inputs: ConfidenceScoringInput[]
): ConfidenceScoreResult[] {
  return inputs.map(calculateConfidenceScore);
}

/**
 * Gets the minimum confidence from a set of recommendations
 * Useful for determining overall recommendation set confidence
 */
export function getMinimumConfidence(results: ConfidenceScoreResult[]): number {
  if (results.length === 0) return 0;
  return Math.min(...results.map((r) => r.overallConfidence));
}

/**
 * Gets the average confidence from a set of recommendations
 */
export function getAverageConfidence(results: ConfidenceScoreResult[]): number {
  if (results.length === 0) return 0;
  const sum = results.reduce((acc, r) => acc + r.overallConfidence, 0);
  return sum / results.length;
}
