/**
 * Property 10: Override Requires Reason
 *
 * For any manual override attempt, the system SHALL reject the override if the
 * reason field is empty or contains only whitespace, returning a validation error.
 *
 * @validates Requirements 5.4
 * @file src/backend/api/src/routes/overrides.ts
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { OverrideRequestSchema } from '../../src/backend/api/src/routes/overrides.js';

// Property test configuration
const propertyConfig = {
  numRuns: 100,
  verbose: false,
};

// Arbitraries for valid data generation
const validUuid = fc.uuid();

const validOverrideCategory = fc.constantFrom('preference', 'availability', 'relationship', 'other');

const validOverrideReason = fc.string({ minLength: 1, maxLength: 1000 }).filter((s) => s.trim().length > 0);

const validOverrideRequest = fc.record({
  jobId: validUuid,
  originalVendorId: validUuid,
  selectedVendorId: validUuid,
  overrideReason: validOverrideReason,
  overrideCategory: validOverrideCategory,
});

// Arbitraries for invalid data
const emptyOrWhitespaceReason = fc.constantFrom('', ' ', '  ', '\t', '\n', '\r\n', '   \t   ', '\n\n\n');

describe('Property 10: Override Requires Reason', () => {
  /**
   * **Validates: Requirements 5.4**
   *
   * Valid override requests with non-empty reasons should pass validation.
   */
  it('valid override requests with non-empty reasons should pass validation', () => {
    fc.assert(
      fc.property(validOverrideRequest, (request) => {
        const result = OverrideRequestSchema.safeParse(request);
        expect(result.success).toBe(true);
      }),
      propertyConfig
    );
  });

  /**
   * **Validates: Requirements 5.4**
   *
   * Override requests with empty reasons should be rejected.
   */
  it('override requests with empty reasons should be rejected', () => {
    fc.assert(
      fc.property(emptyOrWhitespaceReason, (emptyReason) => {
        const invalidRequest = {
          jobId: crypto.randomUUID(),
          originalVendorId: crypto.randomUUID(),
          selectedVendorId: crypto.randomUUID(),
          overrideReason: emptyReason,
          overrideCategory: 'preference',
        };

        const result = OverrideRequestSchema.safeParse(invalidRequest);
        expect(result.success).toBe(false);

        if (!result.success) {
          // Should have error related to overrideReason
          const hasReasonError = result.error.issues.some(
            (issue) =>
              issue.path.includes('overrideReason') ||
              issue.message.toLowerCase().includes('empty') ||
              issue.message.toLowerCase().includes('whitespace') ||
              issue.message.toLowerCase().includes('required')
          );
          expect(hasReasonError).toBe(true);
        }
      }),
      propertyConfig
    );
  });

  /**
   * **Validates: Requirements 5.4**
   *
   * Override requests with missing reason field should be rejected.
   */
  it('override requests with missing reason field should be rejected', () => {
    const requestWithoutReason = {
      jobId: crypto.randomUUID(),
      originalVendorId: crypto.randomUUID(),
      selectedVendorId: crypto.randomUUID(),
      overrideCategory: 'preference',
      // overrideReason is missing
    };

    const result = OverrideRequestSchema.safeParse(requestWithoutReason);
    expect(result.success).toBe(false);
  });

  /**
   * **Validates: Requirements 5.4**
   *
   * Override requests with reason exceeding max length should be rejected.
   */
  it('override requests with reason exceeding max length should be rejected', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1001, maxLength: 2000 }),
        (longReason) => {
          const invalidRequest = {
            jobId: crypto.randomUUID(),
            originalVendorId: crypto.randomUUID(),
            selectedVendorId: crypto.randomUUID(),
            overrideReason: longReason,
            overrideCategory: 'preference',
          };

          const result = OverrideRequestSchema.safeParse(invalidRequest);
          expect(result.success).toBe(false);
        }
      ),
      propertyConfig
    );
  });

  /**
   * **Validates: Requirements 5.4**
   *
   * Override requests with invalid category should be rejected.
   */
  it('override requests with invalid category should be rejected', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }).filter(
          (s) => !['preference', 'availability', 'relationship', 'other'].includes(s)
        ),
        (invalidCategory) => {
          const invalidRequest = {
            jobId: crypto.randomUUID(),
            originalVendorId: crypto.randomUUID(),
            selectedVendorId: crypto.randomUUID(),
            overrideReason: 'Valid reason for override',
            overrideCategory: invalidCategory,
          };

          const result = OverrideRequestSchema.safeParse(invalidRequest);
          expect(result.success).toBe(false);
        }
      ),
      propertyConfig
    );
  });

  /**
   * **Validates: Requirements 5.4**
   *
   * Override requests with invalid UUID formats should be rejected.
   */
  it('override requests with invalid UUID formats should be rejected', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('jobId', 'originalVendorId', 'selectedVendorId'),
        fc.string({ minLength: 1, maxLength: 50 }).filter((s) => {
          // Filter out strings that happen to be valid UUIDs
          const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
          return !uuidRegex.test(s);
        }),
        (field, invalidUuid) => {
          const request: Record<string, string> = {
            jobId: crypto.randomUUID(),
            originalVendorId: crypto.randomUUID(),
            selectedVendorId: crypto.randomUUID(),
            overrideReason: 'Valid reason for override',
            overrideCategory: 'preference',
          };

          request[field] = invalidUuid;

          const result = OverrideRequestSchema.safeParse(request);
          expect(result.success).toBe(false);
        }
      ),
      propertyConfig
    );
  });

  /**
   * **Validates: Requirements 5.4**
   *
   * Trimmed non-empty reasons should pass validation.
   */
  it('reasons with leading/trailing whitespace but non-empty content should pass', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
        (reason) => {
          const request = {
            jobId: crypto.randomUUID(),
            originalVendorId: crypto.randomUUID(),
            selectedVendorId: crypto.randomUUID(),
            overrideReason: `  ${reason}  `, // Add whitespace around valid content
            overrideCategory: 'preference',
          };

          const result = OverrideRequestSchema.safeParse(request);
          expect(result.success).toBe(true);
        }
      ),
      propertyConfig
    );
  });
});
