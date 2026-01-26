/**
 * Property 22: PII Masking in Logs
 *
 * For any log entry containing customer data, PII fields (name, email, phone, address)
 * SHALL be masked or excluded, verifiable by searching logs for PII patterns.
 *
 * @validates Requirements 11.4
 * @file src/backend/shared/src/logging/logger.ts
 */

import fc from 'fast-check';
import { describe, expect, it, beforeEach } from 'vitest';

import {
  Logger,
  maskPiiInString,
  maskPiiInObject,
  isPiiFieldName,
  PII_PATTERNS,
  PII_FIELD_NAMES,
  createLogger,
  LogLevel,
} from '../../src/backend/shared/src/logging/logger.js';

// Property test configuration
const propertyConfig = {
  numRuns: 100,
  verbose: false,
};

// Arbitraries for generating PII data
// Use realistic email format that starts with alphanumeric
const validEmail = fc.tuple(
  fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')), { minLength: 1, maxLength: 10 }),
  fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')), { minLength: 2, maxLength: 10 }),
  fc.constantFrom('com', 'org', 'net', 'io', 'co')
).map(([local, domain, tld]) => `${local}@${domain}.${tld}`);

// Use realistic phone formats that will be matched by the restrictive regex
// Only formats with parentheses or +1 prefix are matched to avoid UUID false positives
const validPhone = fc.oneof(
  // Format: (xxx) xxx-xxxx
  fc.tuple(
    fc.integer({ min: 200, max: 999 }),
    fc.integer({ min: 200, max: 999 }),
    fc.integer({ min: 1000, max: 9999 })
  ).map(([area, exchange, subscriber]) => `(${area}) ${exchange}-${subscriber}`),
  // Format: +1 xxx xxx xxxx
  fc.tuple(
    fc.integer({ min: 200, max: 999 }),
    fc.integer({ min: 200, max: 999 }),
    fc.integer({ min: 1000, max: 9999 })
  ).map(([area, exchange, subscriber]) => `+1 ${area} ${exchange} ${subscriber}`),
  // Format: +1-xxx-xxx-xxxx
  fc.tuple(
    fc.integer({ min: 200, max: 999 }),
    fc.integer({ min: 200, max: 999 }),
    fc.integer({ min: 1000, max: 9999 })
  ).map(([area, exchange, subscriber]) => `+1-${area}-${exchange}-${subscriber}`)
);

// SSN with valid area codes (001-899)
const validSsn = fc.tuple(
  fc.integer({ min: 1, max: 899 }),
  fc.integer({ min: 1, max: 99 }),
  fc.integer({ min: 1000, max: 9999 })
).map(([area, group, serial]) => {
  const areaStr = area.toString().padStart(3, '0');
  const groupStr = group.toString().padStart(2, '0');
  return `${areaStr}-${groupStr}-${serial}`;
});

// Credit card with valid prefixes (3xxx-6xxx)
const validCreditCard = fc.tuple(
  fc.integer({ min: 3000, max: 6999 }),
  fc.integer({ min: 1000, max: 9999 }),
  fc.integer({ min: 1000, max: 9999 }),
  fc.integer({ min: 1000, max: 9999 })
).map(([a, b, c, d]) => `${a}-${b}-${c}-${d}`);

const validName = fc.string({ minLength: 2, maxLength: 50 }).filter(s => /^[a-zA-Z\s]+$/.test(s));

const validAddress = fc.record({
  street: fc.string({ minLength: 5, maxLength: 100 }),
  city: fc.string({ minLength: 2, maxLength: 50 }),
  state: fc.stringOf(fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')), { minLength: 2, maxLength: 2 }),
  zip: fc.stringOf(fc.constantFrom(...'0123456789'.split('')), { minLength: 5, maxLength: 5 }),
}).map(addr => `${addr.street}, ${addr.city}, ${addr.state} ${addr.zip}`);

// Customer data with PII
const customerDataWithPii = fc.record({
  customerId: fc.uuid(),
  name: validName,
  email: validEmail,
  phone: validPhone,
  address: validAddress,
  tier: fc.constantFrom('standard', 'premium', 'enterprise'),
});

// Nested object with PII
const nestedObjectWithPii = fc.record({
  jobId: fc.uuid(),
  customerDetails: customerDataWithPii,
  vendorContact: fc.record({
    primaryContact: validName,
    email: validEmail,
    phoneNumber: validPhone,
  }),
  metadata: fc.record({
    createdBy: validName,
    notes: fc.string({ minLength: 0, maxLength: 200 }),
  }),
});

describe('Property 22: PII Masking in Logs', () => {
  /**
   * **Validates: Requirements 11.4**
   *
   * Property: Email addresses should be masked in strings.
   */
  describe('Email Masking', () => {
    it('email addresses should be masked in strings', () => {
      fc.assert(
        fc.property(validEmail, (email) => {
          const input = `Contact email: ${email}`;
          const masked = maskPiiInString(input);

          // Original email should not appear in masked output
          expect(masked).not.toContain(email);
          // Masked placeholder should appear
          expect(masked).toContain('[EMAIL_MASKED]');
        }),
        propertyConfig
      );
    });

    it('multiple email addresses should all be masked', () => {
      fc.assert(
        fc.property(
          fc.array(validEmail, { minLength: 2, maxLength: 5 }),
          (emails) => {
            // Ensure unique emails
            fc.pre(new Set(emails).size === emails.length);

            const input = emails.join(', ');
            const masked = maskPiiInString(input);

            // No original emails should appear
            for (const email of emails) {
              expect(masked).not.toContain(email);
            }
          }
        ),
        propertyConfig
      );
    });
  });

  /**
   * **Validates: Requirements 11.4**
   *
   * Property: Phone numbers should be masked in strings.
   */
  describe('Phone Number Masking', () => {
    it('phone numbers should be masked in strings', () => {
      fc.assert(
        fc.property(validPhone, (phone) => {
          const input = `Call us at ${phone}`;
          const masked = maskPiiInString(input);

          // Masked placeholder should appear
          expect(masked).toContain('[PHONE_MASKED]');
        }),
        propertyConfig
      );
    });
  });

  /**
   * **Validates: Requirements 11.4**
   *
   * Property: SSN should be masked in strings.
   */
  describe('SSN Masking', () => {
    it('SSN should be masked in strings', () => {
      fc.assert(
        fc.property(validSsn, (ssn) => {
          const input = `SSN: ${ssn}`;
          const masked = maskPiiInString(input);

          // Original SSN should not appear
          expect(masked).not.toContain(ssn);
          // Masked placeholder should appear
          expect(masked).toContain('[SSN_MASKED]');
        }),
        propertyConfig
      );
    });
  });

  /**
   * **Validates: Requirements 11.4**
   *
   * Property: Credit card numbers should be masked in strings.
   */
  describe('Credit Card Masking', () => {
    it('credit card numbers should be masked in strings', () => {
      fc.assert(
        fc.property(validCreditCard, (card) => {
          const input = `Card: ${card}`;
          const masked = maskPiiInString(input);

          // Original card should not appear
          expect(masked).not.toContain(card);
          // Masked placeholder should appear
          expect(masked).toContain('[CARD_MASKED]');
        }),
        propertyConfig
      );
    });
  });

  /**
   * **Validates: Requirements 11.4**
   *
   * Property: PII field names should be correctly identified.
   */
  describe('PII Field Name Detection', () => {
    it('known PII field names should be detected', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...PII_FIELD_NAMES),
          (fieldName) => {
            expect(isPiiFieldName(fieldName)).toBe(true);
          }
        ),
        propertyConfig
      );
    });

    it('PII field names should be case-insensitive', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...PII_FIELD_NAMES),
          fc.constantFrom('toLowerCase', 'toUpperCase') as fc.Arbitrary<'toLowerCase' | 'toUpperCase'>,
          (fieldName, caseMethod) => {
            const transformed = fieldName[caseMethod]();
            expect(isPiiFieldName(transformed)).toBe(true);
          }
        ),
        propertyConfig
      );
    });

    it('non-PII field names should not be detected as PII', () => {
      const nonPiiFields = ['jobId', 'vendorId', 'status', 'score', 'timestamp', 'correlationId'];
      fc.assert(
        fc.property(
          fc.constantFrom(...nonPiiFields),
          (fieldName) => {
            expect(isPiiFieldName(fieldName)).toBe(false);
          }
        ),
        propertyConfig
      );
    });
  });

  /**
   * **Validates: Requirements 11.4**
   *
   * Property: PII fields in objects should be masked.
   */
  describe('Object PII Masking', () => {
    it('PII fields in flat objects should be masked', () => {
      fc.assert(
        fc.property(customerDataWithPii, (customer) => {
          const masked = maskPiiInObject(customer) as Record<string, unknown>;

          // PII fields should be masked
          expect(masked.name).toBe('[PII_MASKED]');
          expect(masked.email).toBe('[PII_MASKED]');
          expect(masked.phone).toBe('[PII_MASKED]');
          expect(masked.address).toBe('[PII_MASKED]');

          // Non-PII fields should be preserved
          expect(masked.customerId).toBe(customer.customerId);
          expect(masked.tier).toBe(customer.tier);
        }),
        propertyConfig
      );
    });

    it('PII fields in nested objects should be masked', () => {
      fc.assert(
        fc.property(nestedObjectWithPii, (data) => {
          const masked = maskPiiInObject(data) as Record<string, unknown>;

          // Top-level non-PII should be preserved
          expect(masked.jobId).toBe(data.jobId);

          // Nested PII should be masked
          const customerDetails = masked.customerDetails as Record<string, unknown>;
          expect(customerDetails.name).toBe('[PII_MASKED]');
          expect(customerDetails.email).toBe('[PII_MASKED]');

          const vendorContact = masked.vendorContact as Record<string, unknown>;
          expect(vendorContact.primaryContact).toBe('[PII_MASKED]');
          expect(vendorContact.email).toBe('[PII_MASKED]');
          expect(vendorContact.phoneNumber).toBe('[PII_MASKED]');
        }),
        propertyConfig
      );
    });

    it('arrays with PII should have all elements masked', () => {
      fc.assert(
        fc.property(
          fc.array(customerDataWithPii, { minLength: 1, maxLength: 5 }),
          (customers) => {
            const masked = maskPiiInObject(customers) as Array<Record<string, unknown>>;

            expect(masked.length).toBe(customers.length);

            for (let i = 0; i < masked.length; i++) {
              expect(masked[i].name).toBe('[PII_MASKED]');
              expect(masked[i].email).toBe('[PII_MASKED]');
              expect(masked[i].customerId).toBe(customers[i].customerId);
            }
          }
        ),
        propertyConfig
      );
    });
  });

  /**
   * **Validates: Requirements 11.4**
   *
   * Property: Logger should mask PII in log entries.
   */
  describe('Logger PII Masking', () => {
    let logger: Logger;

    beforeEach(() => {
      logger = createLogger({
        serviceName: 'test-service',
        minLevel: LogLevel.DEBUG,
        enableConsole: false,
        maskPii: true,
      });
    });

    it('logger should mask PII in metadata', () => {
      fc.assert(
        fc.property(customerDataWithPii, (customer) => {
          logger.clearLogEntries();

          logger.info('Customer action', { customer });

          const entries = logger.getLogEntries();
          expect(entries.length).toBe(1);

          const metadata = entries[0].metadata as Record<string, unknown>;
          const loggedCustomer = metadata.customer as Record<string, unknown>;

          // PII should be masked
          expect(loggedCustomer.name).toBe('[PII_MASKED]');
          expect(loggedCustomer.email).toBe('[PII_MASKED]');
          expect(loggedCustomer.phone).toBe('[PII_MASKED]');
          expect(loggedCustomer.address).toBe('[PII_MASKED]');

          // Non-PII should be preserved
          expect(loggedCustomer.customerId).toBe(customer.customerId);
        }),
        propertyConfig
      );
    });

    it('logger should mask PII in error messages', () => {
      fc.assert(
        fc.property(validEmail, (email) => {
          logger.clearLogEntries();

          const error = new Error(`Failed to send email to ${email}`);
          logger.error('Email error', error);

          const entries = logger.getLogEntries();
          expect(entries.length).toBe(1);

          // Error message should have email masked
          expect(entries[0].error?.message).not.toContain(email);
          expect(entries[0].error?.message).toContain('[EMAIL_MASKED]');
        }),
        propertyConfig
      );
    });

    it('logger with maskPii=false should not mask PII', () => {
      const noMaskLogger = createLogger({
        serviceName: 'test-service',
        minLevel: LogLevel.DEBUG,
        enableConsole: false,
        maskPii: false,
      });

      fc.assert(
        fc.property(validEmail, (email) => {
          noMaskLogger.clearLogEntries();

          noMaskLogger.info('Contact', { email });

          const entries = noMaskLogger.getLogEntries();
          const metadata = entries[0].metadata as Record<string, unknown>;

          // Email should NOT be masked when maskPii is false
          expect(metadata.email).toBe(email);
        }),
        propertyConfig
      );
    });
  });

  /**
   * **Validates: Requirements 11.4**
   *
   * Property: Scoring logs should have PII masked.
   */
  describe('Scoring Log PII Masking', () => {
    let logger: Logger;

    beforeEach(() => {
      logger = createLogger({
        serviceName: 'scoring-service',
        minLevel: LogLevel.DEBUG,
        enableConsole: false,
        maskPii: true,
      });
    });

    it('scoring logs should mask customer PII in input payload', () => {
      fc.assert(
        fc.property(
          fc.uuid(), // correlationId
          fc.uuid(), // jobId
          customerDataWithPii,
          fc.integer({ min: 100, max: 2000 }), // processingTimeMs
          (correlationId, jobId, customer, processingTimeMs) => {
            logger.clearLogEntries();

            logger.logScoring({
              correlationId,
              jobId,
              inputPayload: {
                job: { jobId, customerDetails: customer },
              },
              processingTimeMs,
            });

            const entries = logger.getLogEntries();
            expect(entries.length).toBe(1);

            const metadata = entries[0].metadata as Record<string, unknown>;
            const inputPayload = metadata.inputPayload as Record<string, unknown>;
            const job = inputPayload.job as Record<string, unknown>;
            const customerDetails = job.customerDetails as Record<string, unknown>;

            // Customer PII should be masked
            expect(customerDetails.name).toBe('[PII_MASKED]');
            expect(customerDetails.email).toBe('[PII_MASKED]');

            // Non-PII should be preserved
            expect(job.jobId).toBe(jobId);
            expect(metadata.processingTimeMs).toBe(processingTimeMs);
          }
        ),
        propertyConfig
      );
    });
  });

  /**
   * **Validates: Requirements 11.4**
   *
   * Property: No PII patterns should appear in masked output.
   */
  describe('No PII Leakage', () => {
    it('masked strings should not contain email patterns', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 0, maxLength: 100 }),
          validEmail,
          fc.string({ minLength: 0, maxLength: 100 }),
          (prefix, email, suffix) => {
            const input = `${prefix}${email}${suffix}`;
            const masked = maskPiiInString(input);

            // Check that no email pattern exists in output
            const emailMatches = masked.match(PII_PATTERNS.email);
            expect(emailMatches).toBeNull();
          }
        ),
        propertyConfig
      );
    });

    it('masked objects should not contain PII in stringified form', () => {
      fc.assert(
        fc.property(nestedObjectWithPii, (data) => {
          const masked = maskPiiInObject(data);
          const stringified = JSON.stringify(masked);

          // Check that no email pattern exists
          const emailMatches = stringified.match(PII_PATTERNS.email);
          expect(emailMatches).toBeNull();
        }),
        propertyConfig
      );
    });
  });
});
