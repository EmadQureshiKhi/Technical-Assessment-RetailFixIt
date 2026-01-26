/**
 * Confidence-Based Routing
 *
 * Routes low-confidence recommendations to human review.
 * Implements configurable confidence threshold (default 70%).
 *
 * @requirement 6.2 - Low confidence recommendations require human approval
 * @requirement 13.3 - Recommendations with low confidence (<70%) flagged for human review
 */

import { z } from 'zod';
import type { VendorRecommendation } from '@retailfixit/shared';
import {
  AutomationLevel,
  type AutomationLevelResult,
  getAutomationManager,
} from './automation-config.js';

/**
 * Default confidence threshold (70%)
 */
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.7;

/**
 * Confidence routing result
 */
export interface ConfidenceRoutingResult {
  requiresHumanReview: boolean;
  automationLevel: AutomationLevel;
  confidence: number;
  confidenceThreshold: number;
  reason: string;
  reviewFlags: ReviewFlag[];
}

/**
 * Review flag indicating why human review is needed
 */
export interface ReviewFlag {
  type: ReviewFlagType;
  severity: 'low' | 'medium' | 'high';
  message: string;
}

/**
 * Types of review flags
 */
export const ReviewFlagType = {
  LOW_CONFIDENCE: 'low_confidence',
  DEGRADED_MODE: 'degraded_mode',
  HIGH_RISK: 'high_risk',
  NEW_VENDOR: 'new_vendor',
  CLOSE_SCORES: 'close_scores',
  INSUFFICIENT_DATA: 'insufficient_data',
} as const;

export type ReviewFlagType = (typeof ReviewFlagType)[keyof typeof ReviewFlagType];

/**
 * Schema for review flag
 */
export const ReviewFlagSchema = z.object({
  type: z.enum([
    'low_confidence',
    'degraded_mode',
    'high_risk',
    'new_vendor',
    'close_scores',
    'insufficient_data',
  ]),
  severity: z.enum(['low', 'medium', 'high']),
  message: z.string(),
});

/**
 * Configuration for confidence routing
 */
export interface ConfidenceRoutingConfig {
  defaultThreshold: number;
  degradedModeThreshold: number; // Lower threshold when ML unavailable
  closeScoreMargin: number; // Margin for flagging close scores
  highRiskThreshold: number; // Threshold for high risk factors
}

/**
 * Default confidence routing configuration
 */
export const DEFAULT_ROUTING_CONFIG: ConfidenceRoutingConfig = {
  defaultThreshold: 0.7,
  degradedModeThreshold: 0.6,
  closeScoreMargin: 0.05,
  highRiskThreshold: 0.3,
};

/**
 * Input for confidence routing
 */
export interface ConfidenceRoutingInput {
  recommendations: VendorRecommendation[];
  overallConfidence: number;
  degradedMode: boolean;
  jobType: string;
  customerTier: string;
  urgencyLevel?: string;
}

/**
 * Confidence Router
 *
 * Determines whether recommendations should be routed to human review
 * based on confidence levels and other factors.
 */
export class ConfidenceRouter {
  private config: ConfidenceRoutingConfig;

  constructor(config: ConfidenceRoutingConfig = DEFAULT_ROUTING_CONFIG) {
    this.config = config;
  }

  /**
   * Gets the current configuration
   */
  getConfig(): ConfidenceRoutingConfig {
    return { ...this.config };
  }

  /**
   * Updates the configuration
   */
  updateConfig(config: Partial<ConfidenceRoutingConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Routes a recommendation based on confidence and other factors
   *
   * @requirement 6.2 - Low confidence requires human approval
   * @requirement 13.3 - Confidence below 70% flagged for review
   */
  route(input: ConfidenceRoutingInput): ConfidenceRoutingResult {
    const {
      recommendations,
      overallConfidence,
      degradedMode,
      jobType,
      customerTier,
      urgencyLevel,
    } = input;

    const reviewFlags: ReviewFlag[] = [];

    // Get automation level from manager
    const automationManager = getAutomationManager();
    const automationResult = automationManager.determineAutomationLevel({
      jobType: jobType as 'repair' | 'installation' | 'maintenance' | 'inspection',
      customerTier: customerTier as 'standard' | 'premium' | 'enterprise',
      urgencyLevel: urgencyLevel as 'low' | 'medium' | 'high' | 'critical' | undefined,
      confidence: overallConfidence,
    });

    // Determine effective threshold
    const effectiveThreshold = degradedMode
      ? this.config.degradedModeThreshold
      : automationResult.confidenceThreshold;

    // Check confidence level
    if (overallConfidence < effectiveThreshold) {
      reviewFlags.push({
        type: ReviewFlagType.LOW_CONFIDENCE,
        severity: overallConfidence < 0.5 ? 'high' : 'medium',
        message: `Confidence ${(overallConfidence * 100).toFixed(1)}% is below threshold ${(effectiveThreshold * 100).toFixed(1)}%`,
      });
    }

    // Check degraded mode
    if (degradedMode) {
      reviewFlags.push({
        type: ReviewFlagType.DEGRADED_MODE,
        severity: 'medium',
        message: 'ML predictions unavailable; using rule-based scoring only',
      });
    }

    // Check for high risk factors in top recommendation
    if (recommendations.length > 0) {
      const topRecommendation = recommendations[0];

      // Check for high risk factors
      if (topRecommendation.riskFactors.length > 2) {
        reviewFlags.push({
          type: ReviewFlagType.HIGH_RISK,
          severity: 'high',
          message: `Top vendor has ${topRecommendation.riskFactors.length} risk factors`,
        });
      }

      // Check for low individual confidence
      if (topRecommendation.confidence < 0.5) {
        reviewFlags.push({
          type: ReviewFlagType.NEW_VENDOR,
          severity: 'medium',
          message: 'Top vendor may have limited historical data',
        });
      }

      // Check for close scores between top vendors
      if (recommendations.length >= 2) {
        const scoreDiff = recommendations[0].overallScore - recommendations[1].overallScore;
        if (scoreDiff < this.config.closeScoreMargin) {
          reviewFlags.push({
            type: ReviewFlagType.CLOSE_SCORES,
            severity: 'low',
            message: `Top two vendors have similar scores (difference: ${(scoreDiff * 100).toFixed(1)}%)`,
          });
        }
      }
    }

    // Check for insufficient recommendations
    if (recommendations.length < 3) {
      reviewFlags.push({
        type: ReviewFlagType.INSUFFICIENT_DATA,
        severity: recommendations.length === 0 ? 'high' : 'medium',
        message: `Only ${recommendations.length} vendor(s) available`,
      });
    }

    // Determine if human review is required
    const requiresHumanReview = this.shouldRequireHumanReview(
      automationResult,
      overallConfidence,
      effectiveThreshold,
      reviewFlags
    );

    // Determine final automation level
    const finalAutomationLevel = requiresHumanReview
      ? AutomationLevel.ADVISORY
      : automationResult.level;

    return {
      requiresHumanReview,
      automationLevel: finalAutomationLevel,
      confidence: overallConfidence,
      confidenceThreshold: effectiveThreshold,
      reason: this.generateReason(automationResult, reviewFlags, requiresHumanReview),
      reviewFlags,
    };
  }

  /**
   * Determines if human review should be required
   *
   * @requirement 6.2 - Low confidence requires human approval
   */
  private shouldRequireHumanReview(
    automationResult: AutomationLevelResult,
    confidence: number,
    threshold: number,
    reviewFlags: ReviewFlag[]
  ): boolean {
    // If automation level already requires approval, return true
    if (automationResult.requiresHumanApproval) {
      return true;
    }

    // If confidence is below threshold, require review
    if (confidence < threshold) {
      return true;
    }

    // If there are high severity flags, require review
    const hasHighSeverityFlag = reviewFlags.some((f) => f.severity === 'high');
    if (hasHighSeverityFlag) {
      return true;
    }

    // If there are multiple medium severity flags, require review
    const mediumSeverityCount = reviewFlags.filter((f) => f.severity === 'medium').length;
    if (mediumSeverityCount >= 2) {
      return true;
    }

    return false;
  }

  /**
   * Generates a human-readable reason for the routing decision
   */
  private generateReason(
    automationResult: AutomationLevelResult,
    reviewFlags: ReviewFlag[],
    requiresHumanReview: boolean
  ): string {
    if (!requiresHumanReview) {
      return `Automated dispatch: ${automationResult.reason}`;
    }

    const reasons: string[] = [];

    // Add automation level reason if it requires approval
    if (automationResult.requiresHumanApproval) {
      reasons.push(automationResult.reason);
    }

    // Add high severity flag reasons
    const highSeverityFlags = reviewFlags.filter((f) => f.severity === 'high');
    for (const flag of highSeverityFlags) {
      reasons.push(flag.message);
    }

    // Add medium severity flag reasons if no high severity
    if (highSeverityFlags.length === 0) {
      const mediumSeverityFlags = reviewFlags.filter((f) => f.severity === 'medium');
      for (const flag of mediumSeverityFlags.slice(0, 2)) {
        reasons.push(flag.message);
      }
    }

    return reasons.length > 0
      ? `Human review required: ${reasons.join('; ')}`
      : 'Human review required';
  }

  /**
   * Checks if a specific confidence value requires review
   *
   * @requirement 13.3 - Confidence below threshold flagged for review
   */
  isLowConfidence(confidence: number, threshold?: number): boolean {
    const effectiveThreshold = threshold ?? this.config.defaultThreshold;
    return confidence < effectiveThreshold;
  }

  /**
   * Gets the effective threshold for a given context
   */
  getEffectiveThreshold(degradedMode: boolean): number {
    return degradedMode
      ? this.config.degradedModeThreshold
      : this.config.defaultThreshold;
  }
}

/**
 * Singleton instance for global access
 */
let confidenceRouter: ConfidenceRouter | null = null;

/**
 * Gets the global confidence router instance
 */
export function getConfidenceRouter(): ConfidenceRouter {
  if (!confidenceRouter) {
    confidenceRouter = new ConfidenceRouter();
  }
  return confidenceRouter;
}

/**
 * Resets the global confidence router (for testing)
 */
export function resetConfidenceRouter(): void {
  confidenceRouter = null;
}

/**
 * Quick check if confidence requires human review
 *
 * @requirement 13.3 - Confidence below 70% flagged for review
 */
export function requiresHumanReview(
  confidence: number,
  threshold: number = DEFAULT_CONFIDENCE_THRESHOLD
): boolean {
  return confidence < threshold;
}
