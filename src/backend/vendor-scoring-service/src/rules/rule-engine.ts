/**
 * Rule Engine
 *
 * Combines all rule-based filters to produce a comprehensive vendor score.
 * Implements configurable weights and returns detailed score breakdowns.
 *
 * @requirement 1.3 - Calculate scores using hybrid approach (rule-based component)
 * @requirement 1.4 - Include score breakdown showing contribution of each factor
 * @requirement 2.1 - Implement deterministic rules
 */

import type { VendorProfile, GeoLocation } from '@retailfixit/shared';
import type { JobEvent } from '@retailfixit/shared';
import type { ScoreFactor, ScoreBreakdown } from '@retailfixit/shared';

import { availabilityFilter, type FilterResult } from './availability-filter.js';
import { geographicFilter } from './geographic-filter.js';
import { certificationFilter } from './certification-filter.js';
import { capacityFilter } from './capacity-filter.js';

/**
 * Configuration for rule-based scoring weights
 * Weights must sum to 1.0
 */
export interface RuleWeights {
  availability: number;
  proximity: number;
  certification: number;
  capacity: number;
}

/**
 * Default rule weights as specified in the design document
 */
export const DEFAULT_RULE_WEIGHTS: RuleWeights = {
  availability: 0.25,
  proximity: 0.20,
  certification: 0.20,
  capacity: 0.15,
};

/**
 * Historical completion rate weight (part of rule-based scoring)
 */
export const HISTORICAL_COMPLETION_WEIGHT = 0.20;

/**
 * Result from the rule engine evaluation
 */
export interface RuleEngineResult {
  passed: boolean;
  ruleBasedScore: number;
  factors: ScoreFactor[];
  failureReasons: string[];
}

/**
 * Input for vendor metrics (historical performance)
 */
export interface VendorMetrics {
  completionRate: number;
  reworkRate: number;
  avgResponseTimeHours: number;
  avgCustomerSatisfaction: number;
}

/**
 * Default metrics for vendors with no history
 */
export const DEFAULT_VENDOR_METRICS: VendorMetrics = {
  completionRate: 0.7, // Conservative default
  reworkRate: 0.1,
  avgResponseTimeHours: 4,
  avgCustomerSatisfaction: 3.5,
};

/**
 * Validates that weights sum to 1.0
 */
export function validateWeights(weights: RuleWeights): boolean {
  const sum =
    weights.availability +
    weights.proximity +
    weights.certification +
    weights.capacity +
    HISTORICAL_COMPLETION_WEIGHT;

  return Math.abs(sum - 1.0) < 0.001;
}

/**
 * Creates a ScoreFactor from a filter result
 */
function createScoreFactor(
  name: string,
  filterResult: FilterResult,
  weight: number
): ScoreFactor {
  return {
    name,
    value: filterResult.score,
    weight,
    contribution: filterResult.score * weight,
    explanation: filterResult.explanation,
  };
}

/**
 * Rule Engine
 *
 * Evaluates a vendor against all rule-based filters and produces
 * a comprehensive score with detailed breakdown.
 *
 * @param vendor - The vendor profile to evaluate
 * @param job - The job event requiring vendor assignment
 * @param vendorLocation - Optional vendor base location for distance calculation
 * @param vendorMetrics - Optional historical metrics (defaults provided if not available)
 * @param weights - Optional custom weights (defaults to standard weights)
 * @param checkTime - Optional time for availability check (defaults to now)
 * @returns RuleEngineResult with overall score and factor breakdown
 *
 * @requirement 1.3 - Hybrid scoring (rule-based component)
 * @requirement 1.4 - Score breakdown with factor contributions
 * @requirement 2.1 - Deterministic rules
 */
export function evaluateVendor(
  vendor: VendorProfile,
  job: JobEvent,
  vendorLocation?: GeoLocation,
  vendorMetrics: VendorMetrics = DEFAULT_VENDOR_METRICS,
  weights: RuleWeights = DEFAULT_RULE_WEIGHTS,
  checkTime: Date = new Date()
): RuleEngineResult {
  // Validate weights
  if (!validateWeights(weights)) {
    throw new Error('Rule weights must sum to 1.0');
  }

  const factors: ScoreFactor[] = [];
  const failureReasons: string[] = [];
  let allPassed = true;

  // 1. Availability Filter
  const availabilityResult = availabilityFilter(vendor, job, checkTime);
  factors.push(createScoreFactor('availability', availabilityResult, weights.availability));
  if (!availabilityResult.passed) {
    allPassed = false;
    failureReasons.push(availabilityResult.explanation);
  }

  // 2. Geographic Filter
  const geographicResult = geographicFilter(vendor, job, vendorLocation);
  factors.push(createScoreFactor('proximity', geographicResult, weights.proximity));
  if (!geographicResult.passed) {
    allPassed = false;
    failureReasons.push(geographicResult.explanation);
  }

  // 3. Certification Filter
  const certificationResult = certificationFilter(vendor, job, checkTime);
  factors.push(createScoreFactor('certification', certificationResult, weights.certification));
  if (!certificationResult.passed) {
    allPassed = false;
    failureReasons.push(certificationResult.explanation);
  }

  // 4. Capacity Filter
  const capacityResult = capacityFilter(vendor, job);
  factors.push(createScoreFactor('capacity', capacityResult, weights.capacity));
  if (!capacityResult.passed) {
    allPassed = false;
    failureReasons.push(capacityResult.explanation);
  }

  // 5. Historical Completion Rate
  const completionFactor: ScoreFactor = {
    name: 'historicalCompletion',
    value: vendorMetrics.completionRate,
    weight: HISTORICAL_COMPLETION_WEIGHT,
    contribution: vendorMetrics.completionRate * HISTORICAL_COMPLETION_WEIGHT,
    explanation: `Historical completion rate: ${(vendorMetrics.completionRate * 100).toFixed(1)}%`,
  };
  factors.push(completionFactor);

  // Calculate overall rule-based score
  const ruleBasedScore = factors.reduce((sum, factor) => sum + factor.contribution, 0);

  return {
    passed: allPassed,
    ruleBasedScore,
    factors,
    failureReasons,
  };
}

/**
 * Evaluates multiple vendors and returns sorted results
 *
 * @param vendors - Array of vendor profiles to evaluate
 * @param job - The job event requiring vendor assignment
 * @param vendorLocations - Map of vendorId to location
 * @param vendorMetricsMap - Map of vendorId to metrics
 * @param weights - Optional custom weights
 * @param checkTime - Optional time for availability check
 * @returns Array of results sorted by score (descending)
 *
 * @requirement 1.1 - Process job data and vendor attributes to generate ranked vendor list
 * @requirement 1.7 - Tie-breaking rules
 */
export function evaluateVendors(
  vendors: VendorProfile[],
  job: JobEvent,
  vendorLocations: Map<string, GeoLocation> = new Map(),
  vendorMetricsMap: Map<string, VendorMetrics> = new Map(),
  weights: RuleWeights = DEFAULT_RULE_WEIGHTS,
  checkTime: Date = new Date()
): Array<{ vendor: VendorProfile; result: RuleEngineResult }> {
  const results = vendors.map((vendor) => {
    const vendorLocation = vendorLocations.get(vendor.vendorId);
    const vendorMetrics = vendorMetricsMap.get(vendor.vendorId) || DEFAULT_VENDOR_METRICS;

    return {
      vendor,
      result: evaluateVendor(vendor, job, vendorLocation, vendorMetrics, weights, checkTime),
    };
  });

  // Sort by score (descending), then apply tie-breaking
  return results.sort((a, b) => {
    // Primary sort: overall score
    const scoreDiff = b.result.ruleBasedScore - a.result.ruleBasedScore;
    if (Math.abs(scoreDiff) > 0.001) {
      return scoreDiff;
    }

    // Tie-breaking: availability score (higher is better)
    const aAvailability = a.result.factors.find((f) => f.name === 'availability')?.value || 0;
    const bAvailability = b.result.factors.find((f) => f.name === 'availability')?.value || 0;
    const availabilityDiff = bAvailability - aAvailability;
    if (Math.abs(availabilityDiff) > 0.001) {
      return availabilityDiff;
    }

    // Secondary tie-breaking: proximity score (higher is better)
    const aProximity = a.result.factors.find((f) => f.name === 'proximity')?.value || 0;
    const bProximity = b.result.factors.find((f) => f.name === 'proximity')?.value || 0;
    const proximityDiff = bProximity - aProximity;
    if (Math.abs(proximityDiff) > 0.001) {
      return proximityDiff;
    }

    // Final tie-breaking: vendor ID for determinism
    return a.vendor.vendorId.localeCompare(b.vendor.vendorId);
  });
}

/**
 * Creates a ScoreBreakdown from rule engine results
 * Used for integration with the hybrid scoring system
 *
 * @param result - Rule engine evaluation result
 * @param mlScore - ML score (0 if not available)
 * @returns ScoreBreakdown compatible with the scoring schema
 */
export function createScoreBreakdown(
  result: RuleEngineResult,
  mlScore: number = 0
): ScoreBreakdown {
  return {
    ruleBasedScore: result.ruleBasedScore,
    mlScore,
    factors: result.factors,
  };
}
