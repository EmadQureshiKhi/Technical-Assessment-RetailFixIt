/**
 * Property 13: Override Audit Completeness
 *
 * For any human override, the audit log entry SHALL contain: timestamp,
 * operatorId, jobId, originalVendorId, selectedVendorId, overrideReason,
 * and overrideCategory.
 *
 * @validates Requirements 6.4
 * @file src/backend/shared/src/audit/audit-logger.ts
 */

import fc from 'fast-check';
import { describe, expect, it, beforeEach } from 'vitest';

import {
  AuditLogger,
  AuditEventType,
  AuditOverrideCategory,
  InMemoryAuditStorage,
  hasRequiredOverrideFields,
  type HumanOverrideAuditEntry,
} from '../../src/backend/shared/src/audit/audit-logger.js';
import { resetLogger } from '../../src/backend/shared/src/logging/logger.js';

// Property test configuration
const propertyConfig = {
  numRuns: 100,
  verbose: false,
};

// Arbitraries for generating test data
const validUuid = fc.uuid();

const validOverrideCategory = fc.constantFrom(
  AuditOverrideCategory.PREFERENCE,
  AuditOverrideCategory.AVAILABILITY,
  AuditOverrideCategory.RELATIONSHIP,
  AuditOverrideCategory.PERFORMANCE,
  AuditOverrideCategory.COST,
  AuditOverrideCategory.OTHER
) as fc.Arbitrary<AuditOverrideCategory>;

const validOverrideReason = fc.string({ minLength: 1, maxLength: 500 }).filter(
  (s) => s.trim().length > 0
);

const validScore = fc.double({ min: 0, max: 1, noNaN: true });

const validModelVersion = fc.string({ minLength: 1, maxLength: 20 });

const validVendorName = fc.string({ minLength: 1, maxLength: 100 });

describe('Property 13: Override Audit Completeness', () => {
  let storage: InMemoryAuditStorage;
  let auditLogger: AuditLogger;

  beforeEach(() => {
    resetLogger();
    storage = new InMemoryAuditStorage();
    auditLogger = new AuditLogger(storage);
  });

  /**
   * **Validates: Requirements 6.4**
   *
   * Test that all required fields are in audit log
   */
  describe('Override Audit Entry Contains All Required Fields', () => {
    it('human override audit entry SHALL contain all required fields', async () => {
      await fc.assert(
        fc.asyncProperty(
          validUuid, // correlationId
          validUuid, // jobId
          validUuid, // recommendationId
          validUuid, // operatorId
          validUuid, // originalVendorId
          validVendorName, // originalVendorName
          validUuid, // selectedVendorId
          validVendorName, // selectedVendorName
          validOverrideReason,
          validOverrideCategory,
          validScore, // originalScore
          validModelVersion,
          async (
            correlationId,
            jobId,
            recommendationId,
            operatorId,
            originalVendorId,
            originalVendorName,
            selectedVendorId,
            selectedVendorName,
            overrideReason,
            overrideCategory,
            originalScore,
            modelVersion
          ) => {
            const entry = await auditLogger.logHumanOverride({
              correlationId,
              jobId,
              recommendationId,
              operatorId,
              originalVendorId,
              originalVendorName,
              selectedVendorId,
              selectedVendorName,
              overrideReason,
              overrideCategory,
              originalScore,
              modelVersion,
            });

            // Verify all required fields are present
            expect(entry.auditId).toBeDefined();
            expect(entry.auditId.length).toBeGreaterThan(0);

            expect(entry.timestamp).toBeDefined();
            expect(entry.timestamp).toBeInstanceOf(Date);

            expect(entry.correlationId).toBe(correlationId);
            expect(entry.jobId).toBe(jobId);
            expect(entry.recommendationId).toBe(recommendationId);
            expect(entry.operatorId).toBe(operatorId);
            expect(entry.originalVendorId).toBe(originalVendorId);
            expect(entry.selectedVendorId).toBe(selectedVendorId);
            expect(entry.overrideReason).toBe(overrideReason.trim());
            expect(entry.overrideCategory).toBe(overrideCategory);
            expect(entry.modelVersion).toBe(modelVersion);

            // Verify event type
            expect(entry.eventType).toBe(AuditEventType.HUMAN_OVERRIDE);
          }
        ),
        propertyConfig
      );
    });

    it('hasRequiredOverrideFields SHALL return true for complete entries', async () => {
      await fc.assert(
        fc.asyncProperty(
          validUuid,
          validUuid,
          validUuid,
          validUuid,
          validUuid,
          validVendorName,
          validUuid,
          validVendorName,
          validOverrideReason,
          validOverrideCategory,
          validScore,
          validModelVersion,
          async (
            correlationId,
            jobId,
            recommendationId,
            operatorId,
            originalVendorId,
            originalVendorName,
            selectedVendorId,
            selectedVendorName,
            overrideReason,
            overrideCategory,
            originalScore,
            modelVersion
          ) => {
            const entry = await auditLogger.logHumanOverride({
              correlationId,
              jobId,
              recommendationId,
              operatorId,
              originalVendorId,
              originalVendorName,
              selectedVendorId,
              selectedVendorName,
              overrideReason,
              overrideCategory,
              originalScore,
              modelVersion,
            });

            // Verify hasRequiredOverrideFields returns true
            expect(hasRequiredOverrideFields(entry)).toBe(true);
          }
        ),
        propertyConfig
      );
    });
  });

  describe('Override Reason Validation', () => {
    it('empty override reason SHALL be rejected', async () => {
      await fc.assert(
        fc.asyncProperty(
          validUuid,
          validUuid,
          validUuid,
          validUuid,
          validUuid,
          validVendorName,
          validUuid,
          validVendorName,
          validOverrideCategory,
          validScore,
          validModelVersion,
          async (
            correlationId,
            jobId,
            recommendationId,
            operatorId,
            originalVendorId,
            originalVendorName,
            selectedVendorId,
            selectedVendorName,
            overrideCategory,
            originalScore,
            modelVersion
          ) => {
            // Empty reason should throw
            await expect(
              auditLogger.logHumanOverride({
                correlationId,
                jobId,
                recommendationId,
                operatorId,
                originalVendorId,
                originalVendorName,
                selectedVendorId,
                selectedVendorName,
                overrideReason: '',
                overrideCategory,
                originalScore,
                modelVersion,
              })
            ).rejects.toThrow('Override reason is required');
          }
        ),
        propertyConfig
      );
    });

    it('whitespace-only override reason SHALL be rejected', async () => {
      await fc.assert(
        fc.asyncProperty(
          validUuid,
          validUuid,
          validUuid,
          validUuid,
          validUuid,
          validVendorName,
          validUuid,
          validVendorName,
          validOverrideCategory,
          validScore,
          validModelVersion,
          fc.stringOf(fc.constantFrom(' ', '\t', '\n'), { minLength: 1, maxLength: 10 }),
          async (
            correlationId,
            jobId,
            recommendationId,
            operatorId,
            originalVendorId,
            originalVendorName,
            selectedVendorId,
            selectedVendorName,
            overrideCategory,
            originalScore,
            modelVersion,
            whitespaceReason
          ) => {
            // Whitespace-only reason should throw
            await expect(
              auditLogger.logHumanOverride({
                correlationId,
                jobId,
                recommendationId,
                operatorId,
                originalVendorId,
                originalVendorName,
                selectedVendorId,
                selectedVendorName,
                overrideReason: whitespaceReason,
                overrideCategory,
                originalScore,
                modelVersion,
              })
            ).rejects.toThrow('Override reason is required');
          }
        ),
        propertyConfig
      );
    });
  });

  describe('Audit Entry Storage', () => {
    it('override entries SHALL be retrievable by jobId', async () => {
      await fc.assert(
        fc.asyncProperty(
          validUuid,
          validUuid,
          validUuid,
          validUuid,
          validUuid,
          validVendorName,
          validUuid,
          validVendorName,
          validOverrideReason,
          validOverrideCategory,
          validScore,
          validModelVersion,
          async (
            correlationId,
            jobId,
            recommendationId,
            operatorId,
            originalVendorId,
            originalVendorName,
            selectedVendorId,
            selectedVendorName,
            overrideReason,
            overrideCategory,
            originalScore,
            modelVersion
          ) => {
            await auditLogger.logHumanOverride({
              correlationId,
              jobId,
              recommendationId,
              operatorId,
              originalVendorId,
              originalVendorName,
              selectedVendorId,
              selectedVendorName,
              overrideReason,
              overrideCategory,
              originalScore,
              modelVersion,
            });

            const entries = await auditLogger.getAuditTrail(jobId);
            expect(entries.length).toBe(1);
            expect(entries[0].jobId).toBe(jobId);
            expect(entries[0].eventType).toBe(AuditEventType.HUMAN_OVERRIDE);
          }
        ),
        propertyConfig
      );
    });

    it('override entries SHALL be retrievable by correlationId', async () => {
      await fc.assert(
        fc.asyncProperty(
          validUuid,
          validUuid,
          validUuid,
          validUuid,
          validUuid,
          validVendorName,
          validUuid,
          validVendorName,
          validOverrideReason,
          validOverrideCategory,
          validScore,
          validModelVersion,
          async (
            correlationId,
            jobId,
            recommendationId,
            operatorId,
            originalVendorId,
            originalVendorName,
            selectedVendorId,
            selectedVendorName,
            overrideReason,
            overrideCategory,
            originalScore,
            modelVersion
          ) => {
            await auditLogger.logHumanOverride({
              correlationId,
              jobId,
              recommendationId,
              operatorId,
              originalVendorId,
              originalVendorName,
              selectedVendorId,
              selectedVendorName,
              overrideReason,
              overrideCategory,
              originalScore,
              modelVersion,
            });

            const entries = await auditLogger.getByCorrelationId(correlationId);
            expect(entries.length).toBe(1);
            expect(entries[0].correlationId).toBe(correlationId);
          }
        ),
        propertyConfig
      );
    });
  });

  describe('hasRequiredOverrideFields Validation', () => {
    it('SHALL return false for entries with missing auditId', () => {
      const entry: HumanOverrideAuditEntry = {
        auditId: '', // Missing
        eventType: AuditEventType.HUMAN_OVERRIDE,
        timestamp: new Date(),
        correlationId: '123',
        jobId: '456',
        modelVersion: '1.0',
        recommendationId: '789',
        operatorId: 'op1',
        originalVendorId: 'v1',
        originalVendorName: 'Vendor 1',
        selectedVendorId: 'v2',
        selectedVendorName: 'Vendor 2',
        overrideReason: 'Test reason',
        overrideCategory: AuditOverrideCategory.PREFERENCE,
        originalScore: 0.8,
      };

      expect(hasRequiredOverrideFields(entry)).toBe(false);
    });

    it('SHALL return false for entries with empty overrideReason', () => {
      const entry: HumanOverrideAuditEntry = {
        auditId: '123',
        eventType: AuditEventType.HUMAN_OVERRIDE,
        timestamp: new Date(),
        correlationId: '123',
        jobId: '456',
        modelVersion: '1.0',
        recommendationId: '789',
        operatorId: 'op1',
        originalVendorId: 'v1',
        originalVendorName: 'Vendor 1',
        selectedVendorId: 'v2',
        selectedVendorName: 'Vendor 2',
        overrideReason: '   ', // Whitespace only
        overrideCategory: AuditOverrideCategory.PREFERENCE,
        originalScore: 0.8,
      };

      expect(hasRequiredOverrideFields(entry)).toBe(false);
    });
  });

  describe('AI Recommendation Audit', () => {
    it('AI recommendation audit entry SHALL contain all required fields', async () => {
      await fc.assert(
        fc.asyncProperty(
          validUuid, // correlationId
          validUuid, // jobId
          validUuid, // recommendationId
          fc.double({ min: 0, max: 1, noNaN: true }), // overallConfidence
          fc.constantFrom('auto', 'advisory', 'manual'),
          fc.boolean(), // degradedMode
          fc.integer({ min: 0, max: 5000 }), // processingTimeMs
          validModelVersion,
          async (
            correlationId,
            jobId,
            recommendationId,
            overallConfidence,
            automationLevel,
            degradedMode,
            processingTimeMs,
            modelVersion
          ) => {
            const entry = await auditLogger.logAIRecommendation({
              correlationId,
              jobId,
              recommendationId,
              recommendedVendors: [],
              overallConfidence,
              automationLevel,
              degradedMode,
              processingTimeMs,
              modelVersion,
              inputPayload: {},
            });

            // Verify all required fields are present
            expect(entry.auditId).toBeDefined();
            expect(entry.timestamp).toBeDefined();
            expect(entry.correlationId).toBe(correlationId);
            expect(entry.jobId).toBe(jobId);
            expect(entry.recommendationId).toBe(recommendationId);
            expect(entry.overallConfidence).toBe(overallConfidence);
            expect(entry.automationLevel).toBe(automationLevel);
            expect(entry.degradedMode).toBe(degradedMode);
            expect(entry.processingTimeMs).toBe(processingTimeMs);
            expect(entry.modelVersion).toBe(modelVersion);
            expect(entry.eventType).toBe(AuditEventType.AI_RECOMMENDATION);
          }
        ),
        propertyConfig
      );
    });
  });

  describe('Override Retrieval for Retraining', () => {
    it('overrides SHALL be retrievable for feedback loop', async () => {
      // Create some overrides
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      await auditLogger.logHumanOverride({
        correlationId: '00000000-0000-0000-0000-000000000001',
        jobId: '00000000-0000-0000-0000-000000000002',
        recommendationId: '00000000-0000-0000-0000-000000000003',
        operatorId: '00000000-0000-0000-0000-000000000004',
        originalVendorId: '00000000-0000-0000-0000-000000000005',
        originalVendorName: 'Original Vendor',
        selectedVendorId: '00000000-0000-0000-0000-000000000006',
        selectedVendorName: 'Selected Vendor',
        overrideReason: 'Test reason',
        overrideCategory: AuditOverrideCategory.PREFERENCE,
        originalScore: 0.8,
        modelVersion: '1.0',
      });

      const overrides = await auditLogger.getOverridesForRetraining(yesterday, tomorrow);
      expect(overrides.length).toBe(1);
      expect(overrides[0].eventType).toBe(AuditEventType.HUMAN_OVERRIDE);
    });
  });
});
