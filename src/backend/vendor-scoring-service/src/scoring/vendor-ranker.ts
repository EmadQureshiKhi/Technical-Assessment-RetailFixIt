/**
 * Vendor Ranking and Selection
 *
 * Sorts vendors by hybrid score and selects top 3-5 vendors.
 * Handles edge cases like fewer than 3 eligible vendors.
 *
 * @requirement 1.1 - Process job data and vendor attributes to generate ranked vendor list
 * @requirement 1.2 - Return top 3-5 vendors ranked by overall score
 */

import type { VendorProfile, JobEvent, GeoLocation, VendorRecommendation } from '@retailfixit/shared';
import { evaluateVendor, type RuleEngineResult, type VendorMetrics, DEFAULT_VENDOR_METRICS } from '../rules/rule-engine.js';
import { MLClient, type MLPrediction } from '../ml/ml-client.js';
import {
  calculateHybridScore,
  compareHybridScores,
  type HybridScoreResult,
  type HybridWeights,
  type ContextFactors,
  DEFAULT_HYBRID_WEIGHTS,
} from './hybrid-scorer.js';

/**
 * Minimum number of vendors to return
 */
export const MIN_VENDORS = 3;

/**
 * Maximum number of vendors to return
 */
export const MAX_VENDORS = 5;

/**
 * Ranking result for a single vendor
 */
export interface VendorRankingResult {
  vendor: VendorProfile;
  rank: number;
  hybridResult: HybridScoreResult;
  ruleResult: RuleEngineResult;
  mlPrediction: MLPrediction | null;
  eligible: boolean;
  exclusionReason?: string;
}

/**
 * Overall ranking response
 */
export interface RankingResponse {
  recommendations: VendorRecommendation[];
  totalVendorsEvaluated: number;
  eligibleVendorsCount: number;
  hasWarning: boolean;
  warning?: string;
  degradedMode: boolean;
  modelVersion: string;
}

/**
 * Input for vendor ranking
 */
export interface RankingInput {
  job: JobEvent;
  vendors: VendorProfile[];
  vendorLocations?: Map<string, GeoLocation>;
  vendorMetricsMap?: Map<string, VendorMetrics>;
  weights?: HybridWeights;
  mlClient?: MLClient;
  checkTime?: Date;
}

/**
 * Error response for edge cases
 */
export interface RankingError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}


/**
 * Generates human-readable rationale for a vendor recommendation
 */
function generateRationale(
  _vendor: VendorProfile,
  hybridResult: HybridScoreResult,
  rank: number
): string {
  const parts: string[] = [];

  // Overall ranking statement
  parts.push(`Ranked #${rank} with overall score of ${(hybridResult.overallScore * 100).toFixed(1)}%.`);

  // Top contributing factors
  const sortedFactors = [...hybridResult.scoreBreakdown.factors]
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, 3);

  if (sortedFactors.length > 0) {
    const factorDescriptions = sortedFactors.map(
      (f) => `${f.name} (${(f.value * 100).toFixed(0)}%)`
    );
    parts.push(`Top factors: ${factorDescriptions.join(', ')}.`);
  }

  // Confidence indicator
  if (hybridResult.confidence < 0.5) {
    parts.push('Note: Lower confidence due to limited historical data.');
  } else if (hybridResult.confidence >= 0.8) {
    parts.push('High confidence recommendation.');
  }

  // Degraded mode indicator
  if (hybridResult.degradedMode) {
    parts.push('ML predictions unavailable; score based on rules only.');
  }

  return parts.join(' ');
}

/**
 * Identifies risk factors for a vendor
 */
function identifyRiskFactors(
  hybridResult: HybridScoreResult,
  _ruleResult: RuleEngineResult,
  vendorMetrics?: VendorMetrics
): string[] {
  const risks: string[] = [];

  // Check for low scores in key factors
  for (const factor of hybridResult.scoreBreakdown.factors) {
    if (factor.value < 0.5) {
      switch (factor.name) {
        case 'availability':
          risks.push('Limited availability');
          break;
        case 'proximity':
          risks.push('Distance may affect response time');
          break;
        case 'certification':
          risks.push('Missing some required certifications');
          break;
        case 'capacity':
          risks.push('Near capacity limit');
          break;
        case 'historicalCompletion':
          risks.push('Below average completion rate');
          break;
        case 'mlReworkRisk':
          risks.push('Higher predicted rework risk');
          break;
      }
    }
  }

  // Check vendor metrics
  if (vendorMetrics) {
    if (vendorMetrics.reworkRate > 0.15) {
      risks.push(`Historical rework rate: ${(vendorMetrics.reworkRate * 100).toFixed(1)}%`);
    }
    if (vendorMetrics.avgCustomerSatisfaction < 3.5) {
      risks.push(`Below average satisfaction: ${vendorMetrics.avgCustomerSatisfaction.toFixed(1)}/5`);
    }
  }

  // Low confidence is a risk
  if (hybridResult.confidence < 0.5) {
    risks.push('Limited historical data for this vendor');
  }

  // Degraded mode is a risk
  if (hybridResult.degradedMode) {
    risks.push('ML predictions unavailable');
  }

  return risks;
}

/**
 * Estimates response time based on vendor metrics and proximity
 */
function estimateResponseTime(
  hybridResult: HybridScoreResult,
  vendorMetrics?: VendorMetrics
): string {
  const proximityScore = hybridResult.tieBreakFactors.proximityScore;
  const baseTime = vendorMetrics?.avgResponseTimeHours ?? 4;

  // Adjust based on proximity (closer = faster)
  const adjustedTime = baseTime * (1 + (1 - proximityScore) * 0.5);

  if (adjustedTime < 1) {
    return 'Under 1 hour';
  } else if (adjustedTime < 2) {
    return '1-2 hours';
  } else if (adjustedTime < 4) {
    return '2-4 hours';
  } else if (adjustedTime < 8) {
    return '4-8 hours';
  } else {
    return 'Same day';
  }
}


/**
 * Converts a ranking result to a VendorRecommendation
 */
function toVendorRecommendation(
  result: VendorRankingResult,
  vendorMetrics?: VendorMetrics
): VendorRecommendation {
  return {
    rank: result.rank,
    vendorId: result.vendor.vendorId,
    vendorName: result.vendor.name,
    overallScore: result.hybridResult.overallScore,
    confidence: result.hybridResult.confidence,
    scoreBreakdown: result.hybridResult.scoreBreakdown,
    rationale: generateRationale(
      result.vendor,
      result.hybridResult,
      result.rank
    ),
    riskFactors: identifyRiskFactors(result.hybridResult, result.ruleResult, vendorMetrics),
    estimatedResponseTime: estimateResponseTime(result.hybridResult, vendorMetrics),
  };
}

/**
 * Determines context factors for a vendor based on job and customer preferences
 */
function getContextFactors(
  vendor: VendorProfile,
  job: JobEvent,
  vendorMetrics?: VendorMetrics
): ContextFactors {
  const customerPreferred =
    job.customerDetails.preferredVendors?.includes(vendor.vendorId) ?? false;

  // Consider recent success if completion rate is high
  const recentSuccess = vendorMetrics ? vendorMetrics.completionRate > 0.9 : false;

  // Map urgency level to numeric value
  const urgencyMap: Record<string, number> = {
    low: 0.25,
    medium: 0.5,
    high: 0.75,
    critical: 1.0,
  };
  const slaUrgency = urgencyMap[job.urgencyLevel] ?? 0.5;

  return {
    customerPreferred,
    recentSuccess,
    slaUrgency,
  };
}

/**
 * Ranks vendors and selects top 3-5 for recommendation
 *
 * @param input - Ranking input with job, vendors, and optional configurations
 * @returns RankingResponse with recommendations or error
 *
 * @requirement 1.1 - Generate ranked vendor list
 * @requirement 1.2 - Return top 3-5 vendors
 * @requirement 1.5 - Handle vendors with insufficient data
 */
export async function rankVendors(input: RankingInput): Promise<RankingResponse> {
  const {
    job,
    vendors,
    vendorLocations = new Map(),
    vendorMetricsMap = new Map(),
    weights = DEFAULT_HYBRID_WEIGHTS,
    mlClient,
    checkTime = new Date(),
  } = input;

  // Handle empty vendor list
  if (vendors.length === 0) {
    return {
      recommendations: [],
      totalVendorsEvaluated: 0,
      eligibleVendorsCount: 0,
      hasWarning: true,
      warning: 'No vendors available for evaluation',
      degradedMode: true,
      modelVersion: mlClient?.getModelVersion() ?? 'rule-based-only',
    };
  }

  // Filter out blocked vendors
  const blockedVendors = new Set(job.customerDetails.blockedVendors ?? []);
  const availableVendors = vendors.filter((v) => !blockedVendors.has(v.vendorId));

  // Evaluate all vendors
  const rankingResults: VendorRankingResult[] = [];
  let anyDegradedMode = false;

  for (const vendor of availableVendors) {
    // Skip inactive/suspended vendors
    if (vendor.status !== 'active') {
      rankingResults.push({
        vendor,
        rank: 0,
        hybridResult: createEmptyHybridResult(vendor.vendorId),
        ruleResult: createEmptyRuleResult(),
        mlPrediction: null,
        eligible: false,
        exclusionReason: `Vendor status is ${vendor.status}`,
      });
      continue;
    }

    const vendorLocation = vendorLocations.get(vendor.vendorId);
    const vendorMetrics = vendorMetricsMap.get(vendor.vendorId);

    // Get rule-based evaluation
    const ruleResult = evaluateVendor(
      vendor,
      job,
      vendorLocation,
      vendorMetrics ?? DEFAULT_VENDOR_METRICS,
      undefined,
      checkTime
    );

    // Get ML prediction if client available
    let mlPrediction: MLPrediction | null = null;
    let degradedMode = false;

    if (mlClient) {
      const mlResponse = await mlClient.getPrediction(job, vendor, vendorMetrics);
      mlPrediction = mlResponse.prediction;
      degradedMode = mlResponse.degradedMode;
      anyDegradedMode = anyDegradedMode || degradedMode;
    } else {
      degradedMode = true;
      anyDegradedMode = true;
    }

    // Get context factors
    const contextFactors = getContextFactors(vendor, job, vendorMetrics);

    // Calculate hybrid score
    const hybridResult = calculateHybridScore(
      {
        vendorId: vendor.vendorId,
        ruleResult,
        mlPrediction,
        vendorMetrics,
        contextFactors,
        degradedMode,
      },
      weights
    );

    // Determine eligibility
    const eligible = ruleResult.passed;
    const exclusionReason = eligible ? undefined : ruleResult.failureReasons.join('; ');

    rankingResults.push({
      vendor,
      rank: 0,
      hybridResult,
      ruleResult,
      mlPrediction,
      eligible,
      exclusionReason,
    });
  }

  // Separate eligible and ineligible vendors
  const eligibleResults = rankingResults.filter((r) => r.eligible);

  // Sort eligible vendors by hybrid score
  eligibleResults.sort((a, b) => compareHybridScores(a.hybridResult, b.hybridResult));

  // Assign ranks
  eligibleResults.forEach((result, index) => {
    result.rank = index + 1;
  });

  // Select top vendors (3-5)
  const topVendors = eligibleResults.slice(0, MAX_VENDORS);

  // Generate warnings for edge cases
  let warning: string | undefined;
  let hasWarning = false;

  if (eligibleResults.length === 0) {
    hasWarning = true;
    warning = 'No eligible vendors found. All vendors were filtered out.';
  } else if (eligibleResults.length < MIN_VENDORS) {
    hasWarning = true;
    warning = `Only ${eligibleResults.length} eligible vendor(s) found (minimum recommended: ${MIN_VENDORS})`;
  }

  // Convert to recommendations
  const recommendations = topVendors.map((result) =>
    toVendorRecommendation(result, vendorMetricsMap.get(result.vendor.vendorId))
  );

  return {
    recommendations,
    totalVendorsEvaluated: vendors.length,
    eligibleVendorsCount: eligibleResults.length,
    hasWarning,
    warning,
    degradedMode: anyDegradedMode,
    modelVersion: mlClient?.getModelVersion() ?? 'rule-based-only',
  };
}


/**
 * Synchronous version of rankVendors for testing without ML
 * Uses rule-based scoring only
 *
 * @requirement 2.3 - Fall back to rule-based scoring when ML unavailable
 */
export function rankVendorsSync(input: Omit<RankingInput, 'mlClient'>): RankingResponse {
  const {
    job,
    vendors,
    vendorLocations = new Map(),
    vendorMetricsMap = new Map(),
    weights = DEFAULT_HYBRID_WEIGHTS,
    checkTime = new Date(),
  } = input;

  // Handle empty vendor list
  if (vendors.length === 0) {
    return {
      recommendations: [],
      totalVendorsEvaluated: 0,
      eligibleVendorsCount: 0,
      hasWarning: true,
      warning: 'No vendors available for evaluation',
      degradedMode: true,
      modelVersion: 'rule-based-only',
    };
  }

  // Filter out blocked vendors
  const blockedVendors = new Set(job.customerDetails.blockedVendors ?? []);
  const availableVendors = vendors.filter((v) => !blockedVendors.has(v.vendorId));

  // Evaluate all vendors
  const rankingResults: VendorRankingResult[] = [];

  for (const vendor of availableVendors) {
    // Skip inactive/suspended vendors
    if (vendor.status !== 'active') {
      rankingResults.push({
        vendor,
        rank: 0,
        hybridResult: createEmptyHybridResult(vendor.vendorId),
        ruleResult: createEmptyRuleResult(),
        mlPrediction: null,
        eligible: false,
        exclusionReason: `Vendor status is ${vendor.status}`,
      });
      continue;
    }

    const vendorLocation = vendorLocations.get(vendor.vendorId);
    const vendorMetrics = vendorMetricsMap.get(vendor.vendorId);

    // Get rule-based evaluation
    const ruleResult = evaluateVendor(
      vendor,
      job,
      vendorLocation,
      vendorMetrics ?? DEFAULT_VENDOR_METRICS,
      undefined,
      checkTime
    );

    // Get context factors
    const contextFactors = getContextFactors(vendor, job, vendorMetrics);

    // Calculate hybrid score (rule-based only)
    const hybridResult = calculateHybridScore(
      {
        vendorId: vendor.vendorId,
        ruleResult,
        mlPrediction: null,
        vendorMetrics,
        contextFactors,
        degradedMode: true,
      },
      weights
    );

    // Determine eligibility
    const eligible = ruleResult.passed;
    const exclusionReason = eligible ? undefined : ruleResult.failureReasons.join('; ');

    rankingResults.push({
      vendor,
      rank: 0,
      hybridResult,
      ruleResult,
      mlPrediction: null,
      eligible,
      exclusionReason,
    });
  }

  // Separate eligible and ineligible vendors
  const eligibleResults = rankingResults.filter((r) => r.eligible);

  // Sort eligible vendors by hybrid score
  eligibleResults.sort((a, b) => compareHybridScores(a.hybridResult, b.hybridResult));

  // Assign ranks
  eligibleResults.forEach((result, index) => {
    result.rank = index + 1;
  });

  // Select top vendors (3-5)
  const topVendors = eligibleResults.slice(0, MAX_VENDORS);

  // Generate warnings for edge cases
  let warning: string | undefined;
  let hasWarning = false;

  if (eligibleResults.length === 0) {
    hasWarning = true;
    warning = 'No eligible vendors found. All vendors were filtered out.';
  } else if (eligibleResults.length < MIN_VENDORS) {
    hasWarning = true;
    warning = `Only ${eligibleResults.length} eligible vendor(s) found (minimum recommended: ${MIN_VENDORS})`;
  }

  // Convert to recommendations
  const recommendations = topVendors.map((result) =>
    toVendorRecommendation(result, vendorMetricsMap.get(result.vendor.vendorId))
  );

  return {
    recommendations,
    totalVendorsEvaluated: vendors.length,
    eligibleVendorsCount: eligibleResults.length,
    hasWarning,
    warning,
    degradedMode: true,
    modelVersion: 'rule-based-only',
  };
}

/**
 * Creates an empty hybrid result for ineligible vendors
 */
function createEmptyHybridResult(vendorId: string): HybridScoreResult {
  return {
    overallScore: 0,
    confidence: 0,
    ruleBasedScore: 0,
    mlScore: 0,
    contextBonus: 0,
    scoreBreakdown: {
      ruleBasedScore: 0,
      mlScore: 0,
      factors: [],
    },
    degradedMode: true,
    tieBreakFactors: {
      availabilityScore: 0,
      proximityScore: 0,
      vendorId,
    },
  };
}

/**
 * Creates an empty rule result for ineligible vendors
 */
function createEmptyRuleResult(): RuleEngineResult {
  return {
    passed: false,
    ruleBasedScore: 0,
    factors: [],
    failureReasons: [],
  };
}
