/**
 * Property 11: Automation Level Behavior
 *
 * For any recommendation with automation level set to 'advisory', the system
 * SHALL NOT automatically dispatch the vendor and SHALL require explicit
 * human approval before proceeding.
 *
 * @validates Requirements 6.1
 * @file src/backend/vendor-scoring-service/src/controls/automation-config.ts
 */

import fc from 'fast-check';
import { describe, expect, it, beforeEach } from 'vitest';

import {
  AutomationLevel,
  AutomationLevelManager,
  DEFAULT_AUTOMATION_CONFIG,
  resetAutomationManager,
  type AutomationLevelInput,
  type AutomationConfig,
} from '../../src/backend/vendor-scoring-service/src/controls/automation-config.js';

// Property test configuration
const propertyConfig = {
  numRuns: 100,
  verbose: false,
};

// Arbitraries for generating test data
const validJobType = fc.constantFrom('repair', 'installation', 'maintenance', 'inspection') as fc.Arbitrary<
  'repair' | 'installation' | 'maintenance' | 'inspection'
>;

const validCustomerTier = fc.constantFrom('standard', 'premium', 'enterprise') as fc.Arbitrary<
  'standard' | 'premium' | 'enterprise'
>;

const validUrgencyLevel = fc.constantFrom('low', 'medium', 'high', 'critical') as fc.Arbitrary<
  'low' | 'medium' | 'high' | 'critical'
>;

const validConfidence = fc.double({ min: 0, max: 1, noNaN: true });

const validAutomationLevelInput: fc.Arbitrary<AutomationLevelInput> = fc.record({
  jobType: validJobType,
  customerTier: validCustomerTier,
  urgencyLevel: fc.option(validUrgencyLevel, { nil: undefined }),
  confidence: fc.option(validConfidence, { nil: undefined }),
});

describe('Property 11: Automation Level Behavior', () => {
  beforeEach(() => {
    resetAutomationManager();
  });

  /**
   * **Validates: Requirements 6.1**
   *
   * Test that advisory level requires human approval
   */
  describe('Advisory Level Requires Human Approval', () => {
    it('advisory automation level SHALL require human approval', () => {
      fc.assert(
        fc.property(validAutomationLevelInput, (input) => {
          // Configure manager to always return advisory
          const config: AutomationConfig = {
            defaultLevel: AutomationLevel.ADVISORY,
            defaultConfidenceThreshold: 0.7,
            jobTypeOverrides: [],
            customerTierOverrides: [],
          };

          const manager = new AutomationLevelManager(config);
          const result = manager.determineAutomationLevel(input);

          // Advisory level should always require human approval
          if (result.level === AutomationLevel.ADVISORY) {
            expect(result.requiresHumanApproval).toBe(true);
          }
        }),
        propertyConfig
      );
    });

    it('manual automation level SHALL require human approval', () => {
      fc.assert(
        fc.property(validAutomationLevelInput, (input) => {
          // Configure manager to always return manual
          const config: AutomationConfig = {
            defaultLevel: AutomationLevel.MANUAL,
            defaultConfidenceThreshold: 0.7,
            jobTypeOverrides: [],
            customerTierOverrides: [],
          };

          const manager = new AutomationLevelManager(config);
          const result = manager.determineAutomationLevel(input);

          // Manual level should always require human approval
          if (result.level === AutomationLevel.MANUAL) {
            expect(result.requiresHumanApproval).toBe(true);
          }
        }),
        propertyConfig
      );
    });

    it('auto level with sufficient confidence SHALL NOT require human approval', () => {
      fc.assert(
        fc.property(
          validJobType,
          validCustomerTier,
          fc.double({ min: 0.8, max: 1, noNaN: true }), // High confidence
          (jobType, customerTier, confidence) => {
            // Configure manager for auto with low threshold
            const config: AutomationConfig = {
              defaultLevel: AutomationLevel.AUTO,
              defaultConfidenceThreshold: 0.5, // Low threshold
              jobTypeOverrides: [],
              customerTierOverrides: [],
            };

            const manager = new AutomationLevelManager(config);
            const result = manager.determineAutomationLevel({
              jobType,
              customerTier,
              confidence,
            });

            // Auto level with high confidence should not require approval
            if (result.level === AutomationLevel.AUTO && confidence >= result.confidenceThreshold) {
              expect(result.requiresHumanApproval).toBe(false);
            }
          }
        ),
        propertyConfig
      );
    });
  });

  describe('Critical Urgency Handling', () => {
    it('critical urgency SHALL always require human review', () => {
      fc.assert(
        fc.property(validJobType, validCustomerTier, (jobType, customerTier) => {
          const manager = new AutomationLevelManager(DEFAULT_AUTOMATION_CONFIG);
          const result = manager.determineAutomationLevel({
            jobType,
            customerTier,
            urgencyLevel: 'critical',
          });

          // Critical urgency should always require human review
          expect(result.level).toBe(AutomationLevel.ADVISORY);
          expect(result.requiresHumanApproval).toBe(true);
          expect(result.reason).toContain('Critical urgency');
        }),
        propertyConfig
      );
    });
  });

  describe('Job Type Override Behavior', () => {
    it('job type override SHALL take precedence for advisory/manual levels', () => {
      fc.assert(
        fc.property(validCustomerTier, (customerTier) => {
          // Configure with job type override for repair
          const config: AutomationConfig = {
            defaultLevel: AutomationLevel.AUTO,
            defaultConfidenceThreshold: 0.7,
            jobTypeOverrides: [
              { jobType: 'repair', automationLevel: AutomationLevel.ADVISORY },
            ],
            customerTierOverrides: [
              { customerTier, automationLevel: AutomationLevel.AUTO },
            ],
          };

          const manager = new AutomationLevelManager(config);
          const result = manager.determineAutomationLevel({
            jobType: 'repair',
            customerTier,
          });

          // Job type advisory should override customer tier auto
          expect(result.level).toBe(AutomationLevel.ADVISORY);
          expect(result.requiresHumanApproval).toBe(true);
        }),
        propertyConfig
      );
    });
  });

  describe('Customer Tier Override Behavior', () => {
    it('customer tier override SHALL apply when job type allows auto', () => {
      fc.assert(
        fc.property(validJobType, (jobType) => {
          // Configure with customer tier override
          const config: AutomationConfig = {
            defaultLevel: AutomationLevel.ADVISORY,
            defaultConfidenceThreshold: 0.7,
            jobTypeOverrides: [
              { jobType, automationLevel: AutomationLevel.AUTO },
            ],
            customerTierOverrides: [
              { customerTier: 'enterprise', automationLevel: AutomationLevel.AUTO, confidenceThreshold: 0.8 },
            ],
          };

          const manager = new AutomationLevelManager(config);
          const result = manager.determineAutomationLevel({
            jobType,
            customerTier: 'enterprise',
          });

          // Should use enterprise tier settings
          expect(result.confidenceThreshold).toBe(0.8);
        }),
        propertyConfig
      );
    });
  });

  describe('Confidence Threshold Behavior', () => {
    it('low confidence SHALL force advisory even when auto is configured', () => {
      fc.assert(
        fc.property(
          validJobType,
          validCustomerTier,
          fc.double({ min: 0, max: 0.5, noNaN: true }), // Low confidence
          (jobType, customerTier, confidence) => {
            // Configure for auto with high threshold
            const config: AutomationConfig = {
              defaultLevel: AutomationLevel.AUTO,
              defaultConfidenceThreshold: 0.7,
              jobTypeOverrides: [],
              customerTierOverrides: [],
            };

            const manager = new AutomationLevelManager(config);
            const result = manager.determineAutomationLevel({
              jobType,
              customerTier,
              confidence,
            });

            // Low confidence should force advisory
            expect(result.level).toBe(AutomationLevel.ADVISORY);
            expect(result.requiresHumanApproval).toBe(true);
          }
        ),
        propertyConfig
      );
    });
  });

  describe('requiresHumanApproval Method', () => {
    it('SHALL return true for advisory level regardless of confidence', () => {
      fc.assert(
        fc.property(validConfidence, (confidence) => {
          const manager = new AutomationLevelManager();
          const result = manager.requiresHumanApproval(
            AutomationLevel.ADVISORY,
            confidence,
            0.7
          );

          expect(result).toBe(true);
        }),
        propertyConfig
      );
    });

    it('SHALL return true for manual level regardless of confidence', () => {
      fc.assert(
        fc.property(validConfidence, (confidence) => {
          const manager = new AutomationLevelManager();
          const result = manager.requiresHumanApproval(
            AutomationLevel.MANUAL,
            confidence,
            0.7
          );

          expect(result).toBe(true);
        }),
        propertyConfig
      );
    });

    it('SHALL return true for auto level when confidence is below threshold', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 0, max: 0.69, noNaN: true }),
          (confidence) => {
            const manager = new AutomationLevelManager();
            const result = manager.requiresHumanApproval(
              AutomationLevel.AUTO,
              confidence,
              0.7
            );

            expect(result).toBe(true);
          }
        ),
        propertyConfig
      );
    });

    it('SHALL return false for auto level when confidence meets threshold', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 0.7, max: 1, noNaN: true }),
          (confidence) => {
            const manager = new AutomationLevelManager();
            const result = manager.requiresHumanApproval(
              AutomationLevel.AUTO,
              confidence,
              0.7
            );

            expect(result).toBe(false);
          }
        ),
        propertyConfig
      );
    });
  });
});
