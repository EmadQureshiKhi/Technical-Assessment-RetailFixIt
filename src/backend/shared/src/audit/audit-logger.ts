/**
 * Audit Trail Logger
 *
 * Logs all AI decisions with full context and human interventions with reasons.
 * Stores audit records in Azure SQL for compliance.
 *
 * @requirement 6.4 - Log overrides with timestamp, operator ID, original recommendation,
 *                   selected vendor, and override reason
 * @requirement 6.5 - Provide audit trail of all AI decisions and human interventions
 */

import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { getLogger, type Logger } from '../logging/logger.js';

/**
 * Audit event types
 */
export const AuditEventType = {
  AI_RECOMMENDATION: 'ai_recommendation',
  HUMAN_OVERRIDE: 'human_override',
  HUMAN_APPROVAL: 'human_approval',
  HUMAN_REJECTION: 'human_rejection',
  AUTO_DISPATCH: 'auto_dispatch',
  SYSTEM_FALLBACK: 'system_fallback',
} as const;

export type AuditEventType = (typeof AuditEventType)[keyof typeof AuditEventType];

/**
 * Override category types for audit
 */
export const AuditOverrideCategory = {
  PREFERENCE: 'preference',
  AVAILABILITY: 'availability',
  RELATIONSHIP: 'relationship',
  PERFORMANCE: 'performance',
  COST: 'cost',
  OTHER: 'other',
} as const;

export type AuditOverrideCategory = (typeof AuditOverrideCategory)[keyof typeof AuditOverrideCategory];

/**
 * Schema for audit event type
 */
export const AuditEventTypeSchema = z.enum([
  'ai_recommendation',
  'human_override',
  'human_approval',
  'human_rejection',
  'auto_dispatch',
  'system_fallback',
]);

/**
 * Schema for override category
 */
export const AuditOverrideCategorySchema = z.enum([
  'preference',
  'availability',
  'relationship',
  'performance',
  'cost',
  'other',
]);

/**
 * Base audit entry interface
 */
export interface AuditEntryBase {
  auditId: string;
  eventType: AuditEventType;
  timestamp: Date;
  correlationId: string;
  jobId: string;
  modelVersion: string;
}

/**
 * AI recommendation audit entry
 */
export interface AIRecommendationAuditEntry extends AuditEntryBase {
  eventType: typeof AuditEventType.AI_RECOMMENDATION;
  recommendationId: string;
  recommendedVendors: RecommendedVendorSummary[];
  overallConfidence: number;
  automationLevel: string;
  degradedMode: boolean;
  processingTimeMs: number;
  inputPayload: Record<string, unknown>;
}

/**
 * Human override audit entry
 *
 * @requirement 6.4 - Log overrides with all required fields
 */
export interface HumanOverrideAuditEntry extends AuditEntryBase {
  eventType: typeof AuditEventType.HUMAN_OVERRIDE;
  recommendationId: string;
  operatorId: string;
  originalVendorId: string;
  originalVendorName: string;
  selectedVendorId: string;
  selectedVendorName: string;
  overrideReason: string;
  overrideCategory: AuditOverrideCategory;
  originalScore: number;
  selectedScore?: number;
}

/**
 * Human approval audit entry
 */
export interface HumanApprovalAuditEntry extends AuditEntryBase {
  eventType: typeof AuditEventType.HUMAN_APPROVAL;
  recommendationId: string;
  operatorId: string;
  approvedVendorId: string;
  approvedVendorName: string;
  approvalNotes?: string;
}

/**
 * Human rejection audit entry
 */
export interface HumanRejectionAuditEntry extends AuditEntryBase {
  eventType: typeof AuditEventType.HUMAN_REJECTION;
  recommendationId: string;
  operatorId: string;
  rejectionReason: string;
}

/**
 * Auto dispatch audit entry
 */
export interface AutoDispatchAuditEntry extends AuditEntryBase {
  eventType: typeof AuditEventType.AUTO_DISPATCH;
  recommendationId: string;
  dispatchedVendorId: string;
  dispatchedVendorName: string;
  confidence: number;
}

/**
 * System fallback audit entry
 */
export interface SystemFallbackAuditEntry extends AuditEntryBase {
  eventType: typeof AuditEventType.SYSTEM_FALLBACK;
  fallbackReason: string;
  originalError?: string;
}

/**
 * Union type for all audit entries
 */
export type AuditEntry =
  | AIRecommendationAuditEntry
  | HumanOverrideAuditEntry
  | HumanApprovalAuditEntry
  | HumanRejectionAuditEntry
  | AutoDispatchAuditEntry
  | SystemFallbackAuditEntry;

/**
 * Summary of a recommended vendor for audit purposes
 */
export interface RecommendedVendorSummary {
  rank: number;
  vendorId: string;
  vendorName: string;
  overallScore: number;
  confidence: number;
}

/**
 * Schema for recommended vendor summary
 */
export const RecommendedVendorSummarySchema = z.object({
  rank: z.number().int().min(1),
  vendorId: z.string().uuid(),
  vendorName: z.string(),
  overallScore: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
});

/**
 * Schema for human override audit entry
 *
 * @requirement 6.4 - Validate override audit entries
 */
export const HumanOverrideAuditEntrySchema = z.object({
  auditId: z.string().uuid(),
  eventType: z.literal('human_override'),
  timestamp: z.coerce.date(),
  correlationId: z.string(),
  jobId: z.string().uuid(),
  modelVersion: z.string(),
  recommendationId: z.string().uuid(),
  operatorId: z.string(),
  originalVendorId: z.string().uuid(),
  originalVendorName: z.string(),
  selectedVendorId: z.string().uuid(),
  selectedVendorName: z.string(),
  overrideReason: z.string().min(1),
  overrideCategory: AuditOverrideCategorySchema,
  originalScore: z.number().min(0).max(1),
  selectedScore: z.number().min(0).max(1).optional(),
});

/**
 * Storage interface for audit entries
 */
export interface AuditStorage {
  save(entry: AuditEntry): Promise<void>;
  getByJobId(jobId: string): Promise<AuditEntry[]>;
  getByCorrelationId(correlationId: string): Promise<AuditEntry[]>;
  getByOperatorId(operatorId: string, startDate: Date, endDate: Date): Promise<AuditEntry[]>;
  getOverrides(startDate: Date, endDate: Date): Promise<HumanOverrideAuditEntry[]>;
}

/**
 * In-memory audit storage for testing
 */
export class InMemoryAuditStorage implements AuditStorage {
  private entries: AuditEntry[] = [];

  async save(entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
  }

  async getByJobId(jobId: string): Promise<AuditEntry[]> {
    return this.entries.filter((e) => e.jobId === jobId);
  }

  async getByCorrelationId(correlationId: string): Promise<AuditEntry[]> {
    return this.entries.filter((e) => e.correlationId === correlationId);
  }

  async getByOperatorId(
    operatorId: string,
    startDate: Date,
    endDate: Date
  ): Promise<AuditEntry[]> {
    return this.entries.filter((e) => {
      if (!('operatorId' in e)) return false;
      const entry = e as HumanOverrideAuditEntry | HumanApprovalAuditEntry | HumanRejectionAuditEntry;
      return (
        entry.operatorId === operatorId &&
        entry.timestamp >= startDate &&
        entry.timestamp <= endDate
      );
    });
  }

  async getOverrides(startDate: Date, endDate: Date): Promise<HumanOverrideAuditEntry[]> {
    return this.entries.filter(
      (e): e is HumanOverrideAuditEntry =>
        e.eventType === AuditEventType.HUMAN_OVERRIDE &&
        e.timestamp >= startDate &&
        e.timestamp <= endDate
    );
  }

  // For testing
  clear(): void {
    this.entries = [];
  }

  getAll(): AuditEntry[] {
    return [...this.entries];
  }
}

/**
 * Audit Logger
 *
 * Provides methods for logging all AI decisions and human interventions.
 *
 * @requirement 6.5 - Audit trail of all AI decisions and human interventions
 */
export class AuditLogger {
  private storage: AuditStorage;
  private logger: Logger;

  constructor(storage: AuditStorage) {
    this.storage = storage;
    this.logger = getLogger();
  }

  /**
   * Logs an AI recommendation
   *
   * @requirement 6.5 - Log all AI decisions with full context
   */
  async logAIRecommendation(params: {
    correlationId: string;
    jobId: string;
    recommendationId: string;
    recommendedVendors: RecommendedVendorSummary[];
    overallConfidence: number;
    automationLevel: string;
    degradedMode: boolean;
    processingTimeMs: number;
    modelVersion: string;
    inputPayload: Record<string, unknown>;
  }): Promise<AIRecommendationAuditEntry> {
    const entry: AIRecommendationAuditEntry = {
      auditId: uuidv4(),
      eventType: AuditEventType.AI_RECOMMENDATION,
      timestamp: new Date(),
      correlationId: params.correlationId,
      jobId: params.jobId,
      modelVersion: params.modelVersion,
      recommendationId: params.recommendationId,
      recommendedVendors: params.recommendedVendors,
      overallConfidence: params.overallConfidence,
      automationLevel: params.automationLevel,
      degradedMode: params.degradedMode,
      processingTimeMs: params.processingTimeMs,
      inputPayload: params.inputPayload,
    };

    await this.storage.save(entry);

    this.logger.info('AI recommendation logged', {
      auditId: entry.auditId,
      jobId: entry.jobId,
      recommendationId: entry.recommendationId,
      vendorCount: entry.recommendedVendors.length,
      confidence: entry.overallConfidence,
      correlationId: entry.correlationId,
    });

    return entry;
  }

  /**
   * Logs a human override
   *
   * @requirement 6.4 - Log overrides with timestamp, operator ID, original recommendation,
   *                   selected vendor, and override reason
   */
  async logHumanOverride(params: {
    correlationId: string;
    jobId: string;
    recommendationId: string;
    operatorId: string;
    originalVendorId: string;
    originalVendorName: string;
    selectedVendorId: string;
    selectedVendorName: string;
    overrideReason: string;
    overrideCategory: AuditOverrideCategory;
    originalScore: number;
    selectedScore?: number;
    modelVersion: string;
  }): Promise<HumanOverrideAuditEntry> {
    // Validate override reason is not empty
    if (!params.overrideReason || params.overrideReason.trim().length === 0) {
      throw new Error('Override reason is required');
    }

    const entry: HumanOverrideAuditEntry = {
      auditId: uuidv4(),
      eventType: AuditEventType.HUMAN_OVERRIDE,
      timestamp: new Date(),
      correlationId: params.correlationId,
      jobId: params.jobId,
      modelVersion: params.modelVersion,
      recommendationId: params.recommendationId,
      operatorId: params.operatorId,
      originalVendorId: params.originalVendorId,
      originalVendorName: params.originalVendorName,
      selectedVendorId: params.selectedVendorId,
      selectedVendorName: params.selectedVendorName,
      overrideReason: params.overrideReason.trim(),
      overrideCategory: params.overrideCategory,
      originalScore: params.originalScore,
      selectedScore: params.selectedScore,
    };

    await this.storage.save(entry);

    this.logger.warn('Human override logged', {
      auditId: entry.auditId,
      jobId: entry.jobId,
      operatorId: entry.operatorId,
      originalVendorId: entry.originalVendorId,
      selectedVendorId: entry.selectedVendorId,
      overrideCategory: entry.overrideCategory,
      correlationId: entry.correlationId,
    });

    return entry;
  }

  /**
   * Logs a human approval of an AI recommendation
   */
  async logHumanApproval(params: {
    correlationId: string;
    jobId: string;
    recommendationId: string;
    operatorId: string;
    approvedVendorId: string;
    approvedVendorName: string;
    approvalNotes?: string;
    modelVersion: string;
  }): Promise<HumanApprovalAuditEntry> {
    const entry: HumanApprovalAuditEntry = {
      auditId: uuidv4(),
      eventType: AuditEventType.HUMAN_APPROVAL,
      timestamp: new Date(),
      correlationId: params.correlationId,
      jobId: params.jobId,
      modelVersion: params.modelVersion,
      recommendationId: params.recommendationId,
      operatorId: params.operatorId,
      approvedVendorId: params.approvedVendorId,
      approvedVendorName: params.approvedVendorName,
      approvalNotes: params.approvalNotes,
    };

    await this.storage.save(entry);

    this.logger.info('Human approval logged', {
      auditId: entry.auditId,
      jobId: entry.jobId,
      operatorId: entry.operatorId,
      approvedVendorId: entry.approvedVendorId,
      correlationId: entry.correlationId,
    });

    return entry;
  }

  /**
   * Logs a human rejection of an AI recommendation
   */
  async logHumanRejection(params: {
    correlationId: string;
    jobId: string;
    recommendationId: string;
    operatorId: string;
    rejectionReason: string;
    modelVersion: string;
  }): Promise<HumanRejectionAuditEntry> {
    const entry: HumanRejectionAuditEntry = {
      auditId: uuidv4(),
      eventType: AuditEventType.HUMAN_REJECTION,
      timestamp: new Date(),
      correlationId: params.correlationId,
      jobId: params.jobId,
      modelVersion: params.modelVersion,
      recommendationId: params.recommendationId,
      operatorId: params.operatorId,
      rejectionReason: params.rejectionReason,
    };

    await this.storage.save(entry);

    this.logger.warn('Human rejection logged', {
      auditId: entry.auditId,
      jobId: entry.jobId,
      operatorId: entry.operatorId,
      rejectionReason: entry.rejectionReason,
      correlationId: entry.correlationId,
    });

    return entry;
  }

  /**
   * Logs an automatic dispatch
   */
  async logAutoDispatch(params: {
    correlationId: string;
    jobId: string;
    recommendationId: string;
    dispatchedVendorId: string;
    dispatchedVendorName: string;
    confidence: number;
    modelVersion: string;
  }): Promise<AutoDispatchAuditEntry> {
    const entry: AutoDispatchAuditEntry = {
      auditId: uuidv4(),
      eventType: AuditEventType.AUTO_DISPATCH,
      timestamp: new Date(),
      correlationId: params.correlationId,
      jobId: params.jobId,
      modelVersion: params.modelVersion,
      recommendationId: params.recommendationId,
      dispatchedVendorId: params.dispatchedVendorId,
      dispatchedVendorName: params.dispatchedVendorName,
      confidence: params.confidence,
    };

    await this.storage.save(entry);

    this.logger.info('Auto dispatch logged', {
      auditId: entry.auditId,
      jobId: entry.jobId,
      dispatchedVendorId: entry.dispatchedVendorId,
      confidence: entry.confidence,
      correlationId: entry.correlationId,
    });

    return entry;
  }

  /**
   * Logs a system fallback event
   */
  async logSystemFallback(params: {
    correlationId: string;
    jobId: string;
    fallbackReason: string;
    originalError?: string;
    modelVersion: string;
  }): Promise<SystemFallbackAuditEntry> {
    const entry: SystemFallbackAuditEntry = {
      auditId: uuidv4(),
      eventType: AuditEventType.SYSTEM_FALLBACK,
      timestamp: new Date(),
      correlationId: params.correlationId,
      jobId: params.jobId,
      modelVersion: params.modelVersion,
      fallbackReason: params.fallbackReason,
      originalError: params.originalError,
    };

    await this.storage.save(entry);

    this.logger.warn('System fallback logged', {
      auditId: entry.auditId,
      jobId: entry.jobId,
      fallbackReason: entry.fallbackReason,
      correlationId: entry.correlationId,
    });

    return entry;
  }

  /**
   * Gets audit entries for a job
   */
  async getAuditTrail(jobId: string): Promise<AuditEntry[]> {
    return this.storage.getByJobId(jobId);
  }

  /**
   * Gets audit entries by correlation ID
   */
  async getByCorrelationId(correlationId: string): Promise<AuditEntry[]> {
    return this.storage.getByCorrelationId(correlationId);
  }

  /**
   * Gets overrides for a date range (for feedback loop)
   */
  async getOverridesForRetraining(
    startDate: Date,
    endDate: Date
  ): Promise<HumanOverrideAuditEntry[]> {
    return this.storage.getOverrides(startDate, endDate);
  }
}

/**
 * Singleton instance
 */
let auditLogger: AuditLogger | null = null;
let defaultStorage: AuditStorage | null = null;

/**
 * Gets the global audit logger instance
 */
export function getAuditLogger(): AuditLogger {
  if (!auditLogger) {
    if (!defaultStorage) {
      defaultStorage = new InMemoryAuditStorage();
    }
    auditLogger = new AuditLogger(defaultStorage);
  }
  return auditLogger;
}

/**
 * Sets the audit storage (for production use with Azure SQL)
 */
export function setAuditStorage(storage: AuditStorage): void {
  defaultStorage = storage;
  auditLogger = new AuditLogger(storage);
}

/**
 * Resets the audit logger (for testing)
 */
export function resetAuditLogger(): void {
  auditLogger = null;
  defaultStorage = null;
}

/**
 * Validates a human override audit entry
 *
 * @requirement 6.4 - Validate override entries have all required fields
 */
export function validateOverrideAuditEntry(
  data: unknown
): HumanOverrideAuditEntry {
  return HumanOverrideAuditEntrySchema.parse(data) as HumanOverrideAuditEntry;
}

/**
 * Checks if an override audit entry has all required fields
 *
 * @requirement 6.4 - All required fields must be present
 */
export function hasRequiredOverrideFields(entry: HumanOverrideAuditEntry): boolean {
  return !!(
    entry.auditId &&
    entry.timestamp &&
    entry.correlationId &&
    entry.jobId &&
    entry.recommendationId &&
    entry.operatorId &&
    entry.originalVendorId &&
    entry.selectedVendorId &&
    entry.overrideReason &&
    entry.overrideReason.trim().length > 0 &&
    entry.overrideCategory
  );
}
