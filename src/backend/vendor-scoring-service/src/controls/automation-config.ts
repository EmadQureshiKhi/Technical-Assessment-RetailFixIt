/**
 * Automation Level Configuration
 *
 * Configures automation levels for vendor dispatch decisions.
 * Supports levels: auto, advisory, manual per job type or customer tier.
 *
 * @requirement 6.1 - Support configurable automation levels: fully automated,
 *                   advisory (human approval required), and manual only
 */

import { z } from 'zod';
import type { JobType, CustomerTier } from '@retailfixit/shared';

/**
 * Automation level enumeration
 * - auto: Fully automated dispatch without human intervention
 * - advisory: AI recommends but requires human approval
 * - manual: Human must manually select vendor
 */
export const AutomationLevel = {
  AUTO: 'auto',
  ADVISORY: 'advisory',
  MANUAL: 'manual',
} as const;

export type AutomationLevel = (typeof AutomationLevel)[keyof typeof AutomationLevel];

/**
 * Schema for automation level
 */
export const AutomationLevelSchema = z.enum(['auto', 'advisory', 'manual']);

/**
 * Configuration for automation level by job type
 */
export interface JobTypeAutomationConfig {
  jobType: JobType;
  automationLevel: AutomationLevel;
  confidenceThreshold?: number; // Override default confidence threshold
}

/**
 * Configuration for automation level by customer tier
 */
export interface CustomerTierAutomationConfig {
  customerTier: CustomerTier;
  automationLevel: AutomationLevel;
  confidenceThreshold?: number; // Override default confidence threshold
}

/**
 * Schema for job type automation config
 */
export const JobTypeAutomationConfigSchema = z.object({
  jobType: z.enum(['repair', 'installation', 'maintenance', 'inspection']),
  automationLevel: AutomationLevelSchema,
  confidenceThreshold: z.number().min(0).max(1).optional(),
});

/**
 * Schema for customer tier automation config
 */
export const CustomerTierAutomationConfigSchema = z.object({
  customerTier: z.enum(['standard', 'premium', 'enterprise']),
  automationLevel: AutomationLevelSchema,
  confidenceThreshold: z.number().min(0).max(1).optional(),
});

/**
 * Full automation configuration
 */
export interface AutomationConfig {
  defaultLevel: AutomationLevel;
  defaultConfidenceThreshold: number;
  jobTypeOverrides: JobTypeAutomationConfig[];
  customerTierOverrides: CustomerTierAutomationConfig[];
}

/**
 * Schema for full automation config
 */
export const AutomationConfigSchema = z.object({
  defaultLevel: AutomationLevelSchema,
  defaultConfidenceThreshold: z.number().min(0).max(1),
  jobTypeOverrides: z.array(JobTypeAutomationConfigSchema),
  customerTierOverrides: z.array(CustomerTierAutomationConfigSchema),
});

/**
 * Default automation configuration
 * - Standard customers: advisory mode
 * - Premium/Enterprise: auto mode with higher confidence threshold
 * - Critical jobs: advisory mode regardless of customer tier
 */
export const DEFAULT_AUTOMATION_CONFIG: AutomationConfig = {
  defaultLevel: AutomationLevel.ADVISORY,
  defaultConfidenceThreshold: 0.7,
  jobTypeOverrides: [
    // Critical repairs always need human review
    { jobType: 'repair', automationLevel: AutomationLevel.ADVISORY },
    // Routine maintenance can be automated
    { jobType: 'maintenance', automationLevel: AutomationLevel.AUTO },
    // Installations need review
    { jobType: 'installation', automationLevel: AutomationLevel.ADVISORY },
    // Inspections can be automated
    { jobType: 'inspection', automationLevel: AutomationLevel.AUTO },
  ],
  customerTierOverrides: [
    // Standard customers: advisory mode
    { customerTier: 'standard', automationLevel: AutomationLevel.ADVISORY },
    // Premium customers: auto mode
    { customerTier: 'premium', automationLevel: AutomationLevel.AUTO, confidenceThreshold: 0.75 },
    // Enterprise customers: auto mode with higher threshold
    { customerTier: 'enterprise', automationLevel: AutomationLevel.AUTO, confidenceThreshold: 0.8 },
  ],
};

/**
 * Result of automation level determination
 */
export interface AutomationLevelResult {
  level: AutomationLevel;
  confidenceThreshold: number;
  reason: string;
  requiresHumanApproval: boolean;
}

/**
 * Input for determining automation level
 */
export interface AutomationLevelInput {
  jobType: JobType;
  customerTier: CustomerTier;
  urgencyLevel?: 'low' | 'medium' | 'high' | 'critical';
  confidence?: number;
}

/**
 * Automation Level Manager
 *
 * Determines the appropriate automation level based on job type,
 * customer tier, and other factors.
 */
export class AutomationLevelManager {
  private config: AutomationConfig;

  constructor(config: AutomationConfig = DEFAULT_AUTOMATION_CONFIG) {
    this.config = config;
  }

  /**
   * Gets the current configuration
   */
  getConfig(): AutomationConfig {
    return { ...this.config };
  }

  /**
   * Updates the configuration
   */
  updateConfig(config: Partial<AutomationConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Determines the automation level for a given job
   *
   * Priority order:
   * 1. Critical urgency always requires advisory
   * 2. Job type override
   * 3. Customer tier override
   * 4. Default level
   *
   * @requirement 6.1 - Configurable automation levels per job type or customer tier
   */
  determineAutomationLevel(input: AutomationLevelInput): AutomationLevelResult {
    const { jobType, customerTier, urgencyLevel, confidence } = input;

    // Critical urgency always requires human review
    if (urgencyLevel === 'critical') {
      return {
        level: AutomationLevel.ADVISORY,
        confidenceThreshold: this.config.defaultConfidenceThreshold,
        reason: 'Critical urgency requires human review',
        requiresHumanApproval: true,
      };
    }

    // Check job type override first
    const jobTypeOverride = this.config.jobTypeOverrides.find(
      (o) => o.jobType === jobType
    );

    // Check customer tier override
    const tierOverride = this.config.customerTierOverrides.find(
      (o) => o.customerTier === customerTier
    );

    // Determine level - job type takes precedence for advisory/manual
    let level = this.config.defaultLevel;
    let confidenceThreshold = this.config.defaultConfidenceThreshold;
    let reason = 'Using default automation level';

    // If job type requires advisory or manual, use that
    if (jobTypeOverride && jobTypeOverride.automationLevel !== AutomationLevel.AUTO) {
      level = jobTypeOverride.automationLevel;
      confidenceThreshold = jobTypeOverride.confidenceThreshold ?? this.config.defaultConfidenceThreshold;
      reason = `Job type '${jobType}' requires ${level} mode`;
    }
    // Otherwise, use customer tier if it allows auto
    else if (tierOverride) {
      level = tierOverride.automationLevel;
      confidenceThreshold = tierOverride.confidenceThreshold ?? this.config.defaultConfidenceThreshold;
      reason = `Customer tier '${customerTier}' configured for ${level} mode`;
    }
    // Fall back to job type override if exists
    else if (jobTypeOverride) {
      level = jobTypeOverride.automationLevel;
      confidenceThreshold = jobTypeOverride.confidenceThreshold ?? this.config.defaultConfidenceThreshold;
      reason = `Job type '${jobType}' configured for ${level} mode`;
    }

    // If confidence is provided and below threshold, force advisory
    if (confidence !== undefined && confidence < confidenceThreshold && level === AutomationLevel.AUTO) {
      return {
        level: AutomationLevel.ADVISORY,
        confidenceThreshold,
        reason: `Confidence ${(confidence * 100).toFixed(1)}% below threshold ${(confidenceThreshold * 100).toFixed(1)}%`,
        requiresHumanApproval: true,
      };
    }

    return {
      level,
      confidenceThreshold,
      reason,
      requiresHumanApproval: level !== AutomationLevel.AUTO,
    };
  }

  /**
   * Checks if a recommendation requires human approval
   *
   * @requirement 6.1 - Advisory level requires human approval
   */
  requiresHumanApproval(
    level: AutomationLevel,
    confidence: number,
    confidenceThreshold: number
  ): boolean {
    // Manual always requires approval
    if (level === AutomationLevel.MANUAL) {
      return true;
    }

    // Advisory always requires approval
    if (level === AutomationLevel.ADVISORY) {
      return true;
    }

    // Auto requires approval if confidence is below threshold
    if (level === AutomationLevel.AUTO && confidence < confidenceThreshold) {
      return true;
    }

    return false;
  }

  /**
   * Gets the confidence threshold for a given context
   */
  getConfidenceThreshold(jobType: JobType, customerTier: CustomerTier): number {
    // Check customer tier override first (higher priority for threshold)
    const tierOverride = this.config.customerTierOverrides.find(
      (o) => o.customerTier === customerTier
    );
    if (tierOverride?.confidenceThreshold !== undefined) {
      return tierOverride.confidenceThreshold;
    }

    // Check job type override
    const jobTypeOverride = this.config.jobTypeOverrides.find(
      (o) => o.jobType === jobType
    );
    if (jobTypeOverride?.confidenceThreshold !== undefined) {
      return jobTypeOverride.confidenceThreshold;
    }

    return this.config.defaultConfidenceThreshold;
  }
}

/**
 * Singleton instance for global access
 */
let automationManager: AutomationLevelManager | null = null;

/**
 * Gets the global automation level manager instance
 */
export function getAutomationManager(): AutomationLevelManager {
  if (!automationManager) {
    automationManager = new AutomationLevelManager();
  }
  return automationManager;
}

/**
 * Resets the global automation manager (for testing)
 */
export function resetAutomationManager(): void {
  automationManager = null;
}

/**
 * Validates automation config
 */
export function validateAutomationConfig(data: unknown): AutomationConfig {
  return AutomationConfigSchema.parse(data);
}
