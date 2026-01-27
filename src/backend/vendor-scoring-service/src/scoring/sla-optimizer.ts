/**
 * SLA-Aware Optimization
 *
 * Factors SLA urgency into vendor scoring and prioritizes fast-response
 * vendors for tight SLA constraints.
 *
 * @requirement 20.1 - Factor SLA urgency into vendor scoring
 * @requirement 20.2 - Prioritize vendors with faster response times for tight SLAs
 */

import type { JobEvent, VendorProfile } from '@retailfixit/shared';
import type { VendorMetrics } from '../rules/rule-engine.js';
import type { HybridScoreResult } from './hybrid-scorer.js';

/**
 * SLA urgency levels with associated time constraints
 */
export const SLA_URGENCY_CONFIG = {
  critical: {
    maxResponseHours: 2,
    maxCompletionHours: 4,
    responseTimeWeight: 0.4,
    reliabilityWeight: 0.3,
    qualityWeight: 0.3,
  },
  high: {
    maxResponseHours: 4,
    maxCompletionHours: 8,
    responseTimeWeight: 0.35,
    reliabilityWeight: 0.35,
    qualityWeight: 0.3,
  },
  medium: {
    maxResponseHours: 8,
    maxCompletionHours: 24,
    responseTimeWeight: 0.25,
    reliabilityWeight: 0.4,
    qualityWeight: 0.35,
  },
  low: {
    maxResponseHours: 24,
    maxCompletionHours: 72,
    responseTimeWeight: 0.15,
    reliabilityWeight: 0.4,
    qualityWeight: 0.45,
  },
} as const;

export type UrgencyLevel = keyof typeof SLA_URGENCY_CONFIG;

/**
 * SLA optimization result for a vendor
 */
export interface SLAOptimizationResult {
  /** Adjusted score after SLA optimization */
  adjustedScore: number;
  /** Original score before adjustment */
  originalScore: number;
  /** SLA compliance probability (0-1) */
  slaComplianceProbability: number;
  /** Estimated response time in hours */
  estimatedResponseHours: number;
  /** Estimated completion time in hours */
  estimatedCompletionHours: number;
  /** Whether vendor meets SLA requirements */
  meetsSLARequirements: boolean;
  /** Factors contributing to SLA score */
  slaFactors: SLAFactors;
  /** Warnings about potential SLA risks */
  slaRisks: string[];
}

/**
 * Factors used in SLA optimization
 */
export interface SLAFactors {
  /** Response time score (0-1, higher is faster) */
  responseTimeScore: number;
  /** Reliability score based on historical completion (0-1) */
  reliabilityScore: number;
  /** Quality score based on satisfaction and rework (0-1) */
  qualityScore: number;
  /** Proximity bonus for faster response (0-1) */
  proximityBonus: number;
  /** Capacity penalty if vendor is near limit (0-1, 1 = no penalty) */
  capacityFactor: number;
}

/**
 * Input for SLA optimization
 */
export interface SLAOptimizationInput {
  vendor: VendorProfile;
  job: JobEvent;
  hybridResult: HybridScoreResult;
  vendorMetrics: VendorMetrics | null;
  proximityScore: number;
}

/**
 * Calculates hours until SLA deadline
 */
export function hoursUntilDeadline(slaDeadline: Date, now: Date = new Date()): number {
  const diffMs = slaDeadline.getTime() - now.getTime();
  return Math.max(0, diffMs / (1000 * 60 * 60));
}

/**
 * Determines effective urgency based on time remaining
 * May escalate urgency if deadline is approaching
 */
export function determineEffectiveUrgency(
  declaredUrgency: UrgencyLevel,
  slaDeadline: Date,
  now: Date = new Date()
): UrgencyLevel {
  const hoursRemaining = hoursUntilDeadline(slaDeadline, now);
  
  // Escalate urgency if time is running out
  if (hoursRemaining <= 2 && declaredUrgency !== 'critical') {
    return 'critical';
  }
  if (hoursRemaining <= 4 && (declaredUrgency === 'low' || declaredUrgency === 'medium')) {
    return 'high';
  }
  if (hoursRemaining <= 8 && declaredUrgency === 'low') {
    return 'medium';
  }
  
  return declaredUrgency;
}

/**
 * Calculates response time score based on vendor metrics and SLA requirements
 */
export function calculateResponseTimeScore(
  vendorMetrics: VendorMetrics | null,
  maxResponseHours: number,
  proximityScore: number
): number {
  // Default response time if no metrics
  const avgResponseHours = vendorMetrics?.avgResponseTimeHours ?? 4;
  
  // Base score: how well does vendor's response time fit within SLA?
  let score = 1 - Math.min(1, avgResponseHours / maxResponseHours);
  
  // Proximity bonus: closer vendors can respond faster
  score = score * 0.7 + proximityScore * 0.3;
  
  return Math.min(1, Math.max(0, score));
}

/**
 * Calculates reliability score based on historical performance
 */
export function calculateReliabilityScore(vendorMetrics: VendorMetrics | null): number {
  if (!vendorMetrics) {
    return 0.5; // Neutral score for new vendors
  }
  
  // Completion rate is primary reliability indicator
  const completionScore = vendorMetrics.completionRate;
  
  // Rework rate reduces reliability
  const reworkPenalty = vendorMetrics.reworkRate * 0.3;
  
  return Math.min(1, Math.max(0, completionScore - reworkPenalty));
}

/**
 * Calculates quality score based on satisfaction and rework
 */
export function calculateQualityScore(vendorMetrics: VendorMetrics | null): number {
  if (!vendorMetrics) {
    return 0.5; // Neutral score for new vendors
  }
  
  // Normalize satisfaction (0-5) to (0-1)
  const satisfactionScore = vendorMetrics.avgCustomerSatisfaction / 5;
  
  // Low rework rate indicates quality
  const reworkQuality = 1 - vendorMetrics.reworkRate;
  
  return satisfactionScore * 0.6 + reworkQuality * 0.4;
}

/**
 * Calculates capacity factor (penalty for vendors near capacity)
 */
export function calculateCapacityFactor(vendor: VendorProfile): number {
  if (vendor.maxCapacity === 0) return 0.5;
  
  const utilizationRate = vendor.currentCapacity / vendor.maxCapacity;
  
  // No penalty below 70% utilization
  if (utilizationRate < 0.7) return 1.0;
  
  // Linear penalty from 70% to 100%
  return 1 - ((utilizationRate - 0.7) / 0.3) * 0.5;
}

/**
 * Estimates SLA compliance probability
 */
export function estimateSLAComplianceProbability(
  slaFactors: SLAFactors,
  urgencyConfig: typeof SLA_URGENCY_CONFIG[UrgencyLevel]
): number {
  const weightedScore =
    slaFactors.responseTimeScore * urgencyConfig.responseTimeWeight +
    slaFactors.reliabilityScore * urgencyConfig.reliabilityWeight +
    slaFactors.qualityScore * urgencyConfig.qualityWeight;
  
  // Apply capacity factor
  return weightedScore * slaFactors.capacityFactor;
}

/**
 * Identifies SLA-related risks for a vendor
 */
export function identifySLARisks(
  slaFactors: SLAFactors,
  vendorMetrics: VendorMetrics | null,
  urgencyLevel: UrgencyLevel
): string[] {
  const risks: string[] = [];
  const config = SLA_URGENCY_CONFIG[urgencyLevel];
  
  if (slaFactors.responseTimeScore < 0.5) {
    risks.push(`Response time may exceed ${config.maxResponseHours}h SLA requirement`);
  }
  
  if (slaFactors.reliabilityScore < 0.7) {
    risks.push('Historical completion rate below target');
  }
  
  if (slaFactors.capacityFactor < 0.7) {
    risks.push('Vendor is near capacity limit');
  }
  
  if (vendorMetrics && vendorMetrics.reworkRate > 0.15) {
    risks.push(`Rework rate (${(vendorMetrics.reworkRate * 100).toFixed(1)}%) may impact SLA`);
  }
  
  if (urgencyLevel === 'critical' && slaFactors.proximityBonus < 0.5) {
    risks.push('Distance may affect critical response time');
  }
  
  return risks;
}

/**
 * Optimizes vendor score based on SLA requirements
 *
 * @requirement 20.1 - Factor SLA urgency into vendor scoring
 * @requirement 20.2 - Prioritize fast-response vendors for tight SLAs
 */
export function optimizeForSLA(input: SLAOptimizationInput): SLAOptimizationResult {
  const { vendor, job, hybridResult, vendorMetrics, proximityScore } = input;
  
  // Determine effective urgency (may escalate based on time remaining)
  const effectiveUrgency = determineEffectiveUrgency(
    job.urgencyLevel as UrgencyLevel,
    job.slaDeadline
  );
  const urgencyConfig = SLA_URGENCY_CONFIG[effectiveUrgency];
  
  // Calculate SLA factors
  const slaFactors: SLAFactors = {
    responseTimeScore: calculateResponseTimeScore(
      vendorMetrics,
      urgencyConfig.maxResponseHours,
      proximityScore
    ),
    reliabilityScore: calculateReliabilityScore(vendorMetrics),
    qualityScore: calculateQualityScore(vendorMetrics),
    proximityBonus: proximityScore,
    capacityFactor: calculateCapacityFactor(vendor),
  };
  
  // Calculate SLA compliance probability
  const slaComplianceProbability = estimateSLAComplianceProbability(
    slaFactors,
    urgencyConfig
  );
  
  // Estimate response and completion times
  const baseResponseHours = vendorMetrics?.avgResponseTimeHours ?? 4;
  const estimatedResponseHours = baseResponseHours * (1 + (1 - proximityScore) * 0.3);
  const estimatedCompletionHours = estimatedResponseHours * 2; // Rough estimate
  
  // Determine if vendor meets SLA requirements
  const meetsSLARequirements =
    estimatedResponseHours <= urgencyConfig.maxResponseHours &&
    estimatedCompletionHours <= urgencyConfig.maxCompletionHours &&
    slaComplianceProbability >= 0.6;
  
  // Calculate adjusted score
  // Blend original hybrid score with SLA compliance probability
  // Weight depends on urgency level
  const slaWeight = getSLAWeight(effectiveUrgency);
  const adjustedScore =
    hybridResult.overallScore * (1 - slaWeight) +
    slaComplianceProbability * slaWeight;
  
  // Identify risks
  const slaRisks = identifySLARisks(slaFactors, vendorMetrics, effectiveUrgency);
  
  return {
    adjustedScore,
    originalScore: hybridResult.overallScore,
    slaComplianceProbability,
    estimatedResponseHours,
    estimatedCompletionHours,
    meetsSLARequirements,
    slaFactors,
    slaRisks,
  };
}

/**
 * Gets the weight to apply to SLA factors based on urgency
 */
function getSLAWeight(urgency: UrgencyLevel): number {
  switch (urgency) {
    case 'critical':
      return 0.5; // SLA factors heavily weighted
    case 'high':
      return 0.35;
    case 'medium':
      return 0.2;
    case 'low':
      return 0.1; // Quality matters more than speed
  }
}

/**
 * Batch optimizes multiple vendors for SLA
 */
export function optimizeVendorsForSLA(
  inputs: SLAOptimizationInput[]
): Array<{ vendorId: string; result: SLAOptimizationResult }> {
  return inputs.map((input) => ({
    vendorId: input.vendor.vendorId,
    result: optimizeForSLA(input),
  }));
}

/**
 * Filters vendors that cannot meet SLA requirements
 */
export function filterBySlACompliance(
  results: Array<{ vendorId: string; result: SLAOptimizationResult }>,
  minComplianceProbability: number = 0.5
): Array<{ vendorId: string; result: SLAOptimizationResult }> {
  return results.filter(
    (r) => r.result.slaComplianceProbability >= minComplianceProbability
  );
}

/**
 * Sorts vendors by SLA-adjusted score
 */
export function sortBySLAScore(
  results: Array<{ vendorId: string; result: SLAOptimizationResult }>
): Array<{ vendorId: string; result: SLAOptimizationResult }> {
  return [...results].sort((a, b) => b.result.adjustedScore - a.result.adjustedScore);
}

/**
 * Gets SLA optimization summary for reporting
 */
export function getSLAOptimizationSummary(
  results: Array<{ vendorId: string; result: SLAOptimizationResult }>
): {
  totalVendors: number;
  meetingSLA: number;
  avgComplianceProbability: number;
  topRisks: string[];
} {
  const meetingSLA = results.filter((r) => r.result.meetsSLARequirements).length;
  const avgCompliance =
    results.reduce((sum, r) => sum + r.result.slaComplianceProbability, 0) /
    (results.length || 1);
  
  // Collect all risks and count occurrences
  const riskCounts = new Map<string, number>();
  for (const r of results) {
    for (const risk of r.result.slaRisks) {
      riskCounts.set(risk, (riskCounts.get(risk) ?? 0) + 1);
    }
  }
  
  // Get top 3 most common risks
  const topRisks = [...riskCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([risk]) => risk);
  
  return {
    totalVendors: results.length,
    meetingSLA,
    avgComplianceProbability: avgCompliance,
    topRisks,
  };
}
