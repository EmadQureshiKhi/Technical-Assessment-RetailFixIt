/**
 * Property 19: Comprehensive Logging
 *
 * For any scoring request, the system SHALL log: input payload (with PII masked),
 * all intermediate scores, final recommendation, processing time, and model version.
 *
 * @validates Requirements 10.1, 10.4
 * @file src/backend/shared/src/logging/logger.ts
 * @file src/backend/shared/src/metrics/metrics-collector.ts
 */

import fc from 'fast-check';
import { describe, expect, it, beforeEach } from 'vitest';

import {
  Logger,
  createLogger,
  LogLevel,
  type ScoringLogEntry,
} from '../../src/backend/shared/src/logging/logger.js';

import {
  MetricsCollector,
  createMetricsCollector,
  MetricNames,
} from '../../src/backend/shared/src/metrics/metrics-collector.js';

// Property test configuration
const propertyConfig = {
  numRuns: 100,
  verbose: false,
};

// Arbitraries for valid data generation
const validUuid = fc.uuid();

const validGeoLocation = fc.record({
  latitude: fc.double({ min: -90, max: 90, noNaN: true }),
  longitude: fc.double({ min: -180, max: 180, noNaN: true }),
  address: fc.string({ minLength: 1, maxLength: 200 }),
  city: fc.string({ minLength: 1, maxLength: 100 }),
  state: fc.stringOf(fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')), {
    minLength: 2,
    maxLength: 2,
  }),
  zipCode: fc.stringOf(fc.constantFrom(...'0123456789'.split('')), { minLength: 5, maxLength: 5 }),
  serviceRegion: fc.string({ minLength: 1, maxLength: 50 }),
});

const validCustomerDetails = fc.record({
  customerId: validUuid,
  tier: fc.constantFrom('standard', 'premium', 'enterprise'),
});

const validJobInput = fc.record({
  jobId: validUuid,
  jobType: fc.constantFrom('repair', 'installation', 'maintenance', 'inspection'),
  location: validGeoLocation,
  urgencyLevel: fc.constantFrom('low', 'medium', 'high', 'critical'),
  slaDeadline: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') }),
  requiredCertifications: fc.array(fc.string({ minLength: 1, maxLength: 100 }), { maxLength: 5 }),
  customerDetails: validCustomerDetails,
});

const validScoreFactor = fc.record({
  name: fc.string({ minLength: 1, maxLength: 50 }),
  value: fc.double({ min: 0, max: 1, noNaN: true }),
  weight: fc.double({ min: 0, max: 1, noNaN: true }),
  contribution: fc.double({ min: 0, max: 1, noNaN: true }),
  explanation: fc.string({ minLength: 1, maxLength: 200 }),
});

const validIntermediateScores = fc.record({
  ruleBasedScore: fc.double({ min: 0, max: 1, noNaN: true }),
  mlScore: fc.double({ min: 0, max: 1, noNaN: true }),
  factors: fc.array(validScoreFactor, { minLength: 1, maxLength: 5 }),
});

const validVendorRecommendation = fc.record({
  rank: fc.integer({ min: 1, max: 5 }),
  vendorId: validUuid,
  vendorName: fc.string({ minLength: 1, maxLength: 100 }),
  overallScore: fc.double({ min: 0, max: 1, noNaN: true }),
  confidence: fc.double({ min: 0, max: 1, noNaN: true }),
  scoreBreakdown: validIntermediateScores,
  rationale: fc.string({ minLength: 1, maxLength: 500 }),
  riskFactors: fc.array(fc.string({ minLength: 1, maxLength: 100 }), { maxLength: 5 }),
});

const validModelVersion = fc.stringOf(
  fc.constantFrom(...'0123456789.'.split('')),
  { minLength: 3, maxLength: 10 }
).filter(s => /^\d+\.\d+(\.\d+)?$/.test(s));

const validScoringLogEntry: fc.Arbitrary<ScoringLogEntry> = fc.record({
  correlationId: validUuid,
  jobId: validUuid,
  inputPayload: validJobInput.map(job => ({ job })),
  intermediateScores: fc.option(validIntermediateScores, { nil: undefined }),
  finalRecommendation: fc.option(
    fc.array(validVendorRecommendation, { minLength: 1, maxLength: 5 }).map(recs => ({ recommendations: recs })),
    { nil: undefined }
  ),
  processingTimeMs: fc.integer({ min: 1, max: 10000 }),
  modelVersion: fc.option(validModelVersion, { nil: undefined }),
});

describe('Property 19: Comprehensive Logging', () => {
  /**
   * **Validates: Requirements 10.1, 10.4**
   *
   * Property: Scoring logs should contain all required fields.
   */
  describe('Scoring Log Completeness', () => {
    let logger: Logger;

    beforeEach(() => {
      logger = createLogger({
        serviceName: 'scoring-service',
        minLevel: LogLevel.DEBUG,
        enableConsole: false,
        maskPii: true,
      });
    });

    it('scoring logs should contain correlation ID', () => {
      fc.assert(
        fc.property(validScoringLogEntry, (entry) => {
          logger.clearLogEntries();

          logger.logScoring(entry);

          const entries = logger.getLogEntries();
          expect(entries.length).toBe(1);
          expect(entries[0].correlationId).toBe(entry.correlationId);
        }),
        propertyConfig
      );
    });

    it('scoring logs should contain input payload', () => {
      fc.assert(
        fc.property(validScoringLogEntry, (entry) => {
          logger.clearLogEntries();

          logger.logScoring(entry);

          const entries = logger.getLogEntries();
          expect(entries.length).toBe(1);

          const metadata = entries[0].metadata as Record<string, unknown>;
          expect(metadata.inputPayload).toBeDefined();
          expect(metadata.jobId).toBe(entry.jobId);
        }),
        propertyConfig
      );
    });

    it('scoring logs should contain processing time', () => {
      fc.assert(
        fc.property(validScoringLogEntry, (entry) => {
          logger.clearLogEntries();

          logger.logScoring(entry);

          const entries = logger.getLogEntries();
          const metadata = entries[0].metadata as Record<string, unknown>;

          expect(metadata.processingTimeMs).toBe(entry.processingTimeMs);
        }),
        propertyConfig
      );
    });

    it('scoring logs should contain model version when provided', () => {
      fc.assert(
        fc.property(
          validScoringLogEntry.filter(e => e.modelVersion !== undefined),
          (entry) => {
            logger.clearLogEntries();

            logger.logScoring(entry);

            const entries = logger.getLogEntries();
            const metadata = entries[0].metadata as Record<string, unknown>;

            expect(metadata.modelVersion).toBe(entry.modelVersion);
          }
        ),
        propertyConfig
      );
    });

    it('scoring logs should contain intermediate scores when provided', () => {
      fc.assert(
        fc.property(
          validScoringLogEntry.filter(e => e.intermediateScores !== undefined),
          (entry) => {
            logger.clearLogEntries();

            logger.logScoring(entry);

            const entries = logger.getLogEntries();
            const metadata = entries[0].metadata as Record<string, unknown>;

            expect(metadata.intermediateScores).toBeDefined();
          }
        ),
        propertyConfig
      );
    });

    it('scoring logs should contain final recommendation when provided', () => {
      fc.assert(
        fc.property(
          validScoringLogEntry.filter(e => e.finalRecommendation !== undefined),
          (entry) => {
            logger.clearLogEntries();

            logger.logScoring(entry);

            const entries = logger.getLogEntries();
            const metadata = entries[0].metadata as Record<string, unknown>;

            expect(metadata.finalRecommendation).toBeDefined();
          }
        ),
        propertyConfig
      );
    });
  });

  /**
   * **Validates: Requirements 10.1, 10.4**
   *
   * Property: Log entries should have valid structure.
   */
  describe('Log Entry Structure', () => {
    let logger: Logger;

    beforeEach(() => {
      logger = createLogger({
        serviceName: 'test-service',
        minLevel: LogLevel.DEBUG,
        enableConsole: false,
        maskPii: true,
      });
    });

    it('log entries should have timestamp', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 100 }),
          (message) => {
            logger.clearLogEntries();

            logger.info(message);

            const entries = logger.getLogEntries();
            expect(entries.length).toBe(1);
            expect(entries[0].timestamp).toBeDefined();

            // Timestamp should be valid ISO 8601
            const timestamp = new Date(entries[0].timestamp);
            expect(timestamp.getTime()).not.toBeNaN();
          }
        ),
        propertyConfig
      );
    });

    it('log entries should have level', () => {
      fc.assert(
        fc.property(
          fc.constantFrom('debug', 'info', 'warn', 'error') as fc.Arbitrary<'debug' | 'info' | 'warn' | 'error'>,
          fc.string({ minLength: 1, maxLength: 100 }),
          (level, message) => {
            logger.clearLogEntries();

            logger[level](message);

            const entries = logger.getLogEntries();
            expect(entries.length).toBe(1);
            expect(entries[0].level).toBe(level);
          }
        ),
        propertyConfig
      );
    });

    it('log entries should have service name', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 50 }),
          fc.string({ minLength: 1, maxLength: 100 }),
          (serviceName, message) => {
            const customLogger = createLogger({
              serviceName,
              minLevel: LogLevel.DEBUG,
              enableConsole: false,
            });

            customLogger.info(message);

            const entries = customLogger.getLogEntries();
            expect(entries.length).toBe(1);
            expect(entries[0].service).toBe(serviceName);
          }
        ),
        propertyConfig
      );
    });

    it('log entries should have message', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 100 }),
          (message) => {
            logger.clearLogEntries();

            logger.info(message);

            const entries = logger.getLogEntries();
            expect(entries.length).toBe(1);
            expect(entries[0].message).toBe(message);
          }
        ),
        propertyConfig
      );
    });
  });

  /**
   * **Validates: Requirements 10.2**
   *
   * Property: Correlation IDs should be included in all log entries.
   */
  describe('Correlation ID in Logs', () => {
    let logger: Logger;

    beforeEach(() => {
      logger = createLogger({
        serviceName: 'test-service',
        minLevel: LogLevel.DEBUG,
        enableConsole: false,
      });
    });

    it('correlation ID should be included when set', () => {
      fc.assert(
        fc.property(
          validUuid,
          fc.string({ minLength: 1, maxLength: 100 }),
          (correlationId, message) => {
            logger.clearLogEntries();
            logger.setCorrelationId(correlationId);

            logger.info(message);

            const entries = logger.getLogEntries();
            expect(entries.length).toBe(1);
            expect(entries[0].correlationId).toBe(correlationId);
          }
        ),
        propertyConfig
      );
    });

    it('child logger should inherit correlation ID', () => {
      fc.assert(
        fc.property(
          validUuid,
          fc.string({ minLength: 1, maxLength: 100 }),
          (correlationId, message) => {
            const childLogger = logger.child(correlationId);

            childLogger.info(message);

            const entries = childLogger.getLogEntries();
            expect(entries.length).toBe(1);
            expect(entries[0].correlationId).toBe(correlationId);
          }
        ),
        propertyConfig
      );
    });

    it('multiple log entries should have same correlation ID', () => {
      fc.assert(
        fc.property(
          validUuid,
          fc.array(fc.string({ minLength: 1, maxLength: 100 }), { minLength: 2, maxLength: 5 }),
          (correlationId, messages) => {
            logger.clearLogEntries();
            logger.setCorrelationId(correlationId);

            for (const message of messages) {
              logger.info(message);
            }

            const entries = logger.getLogEntries();
            expect(entries.length).toBe(messages.length);

            for (const entry of entries) {
              expect(entry.correlationId).toBe(correlationId);
            }
          }
        ),
        propertyConfig
      );
    });
  });

  /**
   * **Validates: Requirements 10.4**
   *
   * Property: Metrics should be collected for all operations.
   */
  describe('Metrics Collection', () => {
    let metrics: MetricsCollector;

    beforeEach(() => {
      metrics = createMetricsCollector({
        serviceName: 'test-service',
        enableConsole: false,
      });
    });

    it('request latency should be recorded', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 10000 }),
          (latencyMs) => {
            metrics.clear();

            metrics.recordRequestLatency(latencyMs);

            const entries = metrics.getMetricEntries();
            expect(entries.length).toBeGreaterThan(0);

            const latencyEntry = entries.find(e => e.name === MetricNames.REQUEST_LATENCY);
            expect(latencyEntry).toBeDefined();
            expect(latencyEntry?.value).toBe(latencyMs);
          }
        ),
        propertyConfig
      );
    });

    it('request count should be incremented', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 100 }),
          (count) => {
            metrics.clear();

            for (let i = 0; i < count; i++) {
              metrics.recordRequestLatency(100);
            }

            const requestCount = metrics.getCounter(MetricNames.REQUEST_COUNT);
            expect(requestCount).toBe(count);
          }
        ),
        propertyConfig
      );
    });

    it('error count should be tracked', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 50 }),
          (errorCount) => {
            metrics.clear();

            for (let i = 0; i < errorCount; i++) {
              metrics.recordRequestError();
            }

            const count = metrics.getCounter(MetricNames.REQUEST_ERROR_COUNT);
            expect(count).toBe(errorCount);
          }
        ),
        propertyConfig
      );
    });

    it('ML inference latency should be recorded', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 5000 }),
          (latencyMs) => {
            metrics.clear();

            metrics.recordMLInferenceLatency(latencyMs);

            const entries = metrics.getMetricEntries();
            const mlEntry = entries.find(e => e.name === MetricNames.ML_INFERENCE_LATENCY);
            expect(mlEntry).toBeDefined();
            expect(mlEntry?.value).toBe(latencyMs);
          }
        ),
        propertyConfig
      );
    });

    it('override count should be tracked', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 50 }),
          (overrideCount) => {
            metrics.clear();

            for (let i = 0; i < overrideCount; i++) {
              metrics.recordOverride();
            }

            const count = metrics.getCounter(MetricNames.OVERRIDE_COUNT);
            expect(count).toBe(overrideCount);
          }
        ),
        propertyConfig
      );
    });

    it('confidence scores should be recorded in histogram', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 0, max: 1, noNaN: true }),
          (confidence) => {
            metrics.clear();

            metrics.recordConfidenceScore(confidence);

            const histogram = metrics.getHistogram(MetricNames.CONFIDENCE_SCORE);
            expect(histogram).toBeDefined();
            expect(histogram?.count).toBe(1);
            expect(histogram?.sum).toBeCloseTo(confidence, 5);
          }
        ),
        propertyConfig
      );
    });

    it('low confidence should increment low confidence counter', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 0, max: 0.69, noNaN: true }),
          (lowConfidence) => {
            metrics.clear();

            metrics.recordConfidenceScore(lowConfidence);

            const count = metrics.getCounter(MetricNames.LOW_CONFIDENCE_COUNT);
            expect(count).toBe(1);
          }
        ),
        propertyConfig
      );
    });

    it('high confidence should not increment low confidence counter', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 0.7, max: 1, noNaN: true }),
          (highConfidence) => {
            metrics.clear();

            metrics.recordConfidenceScore(highConfidence);

            const count = metrics.getCounter(MetricNames.LOW_CONFIDENCE_COUNT);
            expect(count).toBe(0);
          }
        ),
        propertyConfig
      );
    });
  });

  /**
   * **Validates: Requirements 10.4**
   *
   * Property: Error rate should be calculated correctly.
   */
  describe('Error Rate Calculation', () => {
    let metrics: MetricsCollector;

    beforeEach(() => {
      metrics = createMetricsCollector({
        serviceName: 'test-service',
        enableConsole: false,
      });
    });

    it('error rate should be ratio of errors to total requests', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 100 }),
          fc.integer({ min: 0, max: 100 }),
          (successCount, errorCount) => {
            metrics.clear();

            // Record successful requests
            for (let i = 0; i < successCount; i++) {
              metrics.recordRequestLatency(100);
              metrics.recordRequestSuccess();
            }

            // Record errors
            for (let i = 0; i < errorCount; i++) {
              metrics.recordRequestLatency(100);
              metrics.recordRequestError();
            }

            const totalRequests = successCount + errorCount;
            const expectedErrorRate = errorCount / totalRequests;
            const actualErrorRate = metrics.getErrorRate();

            expect(actualErrorRate).toBeCloseTo(expectedErrorRate, 5);
          }
        ),
        propertyConfig
      );
    });

    it('error rate should be 0 when no requests', () => {
      metrics.clear();
      const errorRate = metrics.getErrorRate();
      expect(errorRate).toBe(0);
    });
  });

  /**
   * **Validates: Requirements 10.4**
   *
   * Property: Histogram statistics should be accurate.
   */
  describe('Histogram Statistics', () => {
    let metrics: MetricsCollector;

    beforeEach(() => {
      metrics = createMetricsCollector({
        serviceName: 'test-service',
        enableConsole: false,
      });
    });

    it('average latency should be calculated correctly', () => {
      fc.assert(
        fc.property(
          fc.array(fc.integer({ min: 1, max: 10000 }), { minLength: 1, maxLength: 50 }),
          (latencies) => {
            metrics.clear();

            for (const latency of latencies) {
              metrics.recordRequestLatency(latency);
            }

            const expectedAverage = latencies.reduce((a, b) => a + b, 0) / latencies.length;
            const actualAverage = metrics.getAverageLatency(MetricNames.REQUEST_LATENCY);

            expect(actualAverage).toBeCloseTo(expectedAverage, 5);
          }
        ),
        propertyConfig
      );
    });

    it('histogram count should match number of recordings', () => {
      fc.assert(
        fc.property(
          fc.array(fc.integer({ min: 1, max: 10000 }), { minLength: 1, maxLength: 50 }),
          (latencies) => {
            metrics.clear();

            for (const latency of latencies) {
              metrics.recordRequestLatency(latency);
            }

            const histogram = metrics.getHistogram(MetricNames.REQUEST_LATENCY);
            expect(histogram?.count).toBe(latencies.length);
          }
        ),
        propertyConfig
      );
    });
  });

  /**
   * **Validates: Requirements 10.1**
   *
   * Property: Log level filtering should work correctly.
   */
  describe('Log Level Filtering', () => {
    it('logs below minimum level should not be recorded', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 100 }),
          (message) => {
            const infoLogger = createLogger({
              serviceName: 'test-service',
              minLevel: LogLevel.INFO,
              enableConsole: false,
            });

            infoLogger.debug(message);

            const entries = infoLogger.getLogEntries();
            expect(entries.length).toBe(0);
          }
        ),
        propertyConfig
      );
    });

    it('logs at or above minimum level should be recorded', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 100 }),
          (message) => {
            const infoLogger = createLogger({
              serviceName: 'test-service',
              minLevel: LogLevel.INFO,
              enableConsole: false,
            });

            infoLogger.info(message);
            infoLogger.warn(message);
            infoLogger.error(message);

            const entries = infoLogger.getLogEntries();
            expect(entries.length).toBe(3);
          }
        ),
        propertyConfig
      );
    });
  });
});
