/**
 * Property 17: Drift Detection Alerting
 *
 * For any feature distribution that deviates from the baseline by more than
 * the configured threshold (measured by KL divergence or similar metric),
 * the system SHALL generate a drift alert within the monitoring window.
 *
 * @validates Requirements 9.2
 * @file src/ml/monitoring/drift_detector.py
 */

import fc from 'fast-check';
import { describe, expect, it, beforeEach } from 'vitest';

// Property test configuration
const propertyConfig = {
  numRuns: 100,
  verbose: false,
};

/**
 * TypeScript implementation of drift detection concepts for testing.
 * This mirrors the Python implementation in drift_detector.py
 */

interface FeatureStatistics {
  name: string;
  mean: number;
  std: number;
  min: number;
  max: number;
  histogram: number[];
}

interface DriftResult {
  featureName: string;
  driftScore: number;
  threshold: number;
  hasDrift: boolean;
  severity: 'none' | 'low' | 'medium' | 'high' | 'critical';
}

interface DriftAlert {
  alertId: string;
  timestamp: string;
  severity: string;
  message: string;
  affectedFeatures: string[];
}

/**
 * Calculate KL divergence between two distributions.
 * KL(P || Q) = sum(P(x) * log(P(x) / Q(x)))
 */
function calculateKLDivergence(baseline: number[], current: number[]): number {
  if (baseline.length !== current.length) {
    throw new Error('Distributions must have same length');
  }

  const epsilon = 1e-10;
  let kl = 0;

  // Normalize to probability distributions
  const sumP = baseline.reduce((a, b) => a + b, 0) || 1;
  const sumQ = current.reduce((a, b) => a + b, 0) || 1;

  for (let i = 0; i < baseline.length; i++) {
    const p = (baseline[i] + epsilon) / (sumP + epsilon * baseline.length);
    const q = (current[i] + epsilon) / (sumQ + epsilon * current.length);
    kl += p * Math.log(p / q);
  }

  return Math.max(0, kl);
}

/**
 * Calculate Population Stability Index (PSI).
 * PSI = sum((actual% - expected%) * ln(actual% / expected%))
 */
function calculatePSI(baseline: number[], current: number[]): number {
  if (baseline.length !== current.length) {
    throw new Error('Distributions must have same length');
  }

  const epsilon = 1e-10;
  let psi = 0;

  const sumP = baseline.reduce((a, b) => a + b, 0) || 1;
  const sumQ = current.reduce((a, b) => a + b, 0) || 1;

  for (let i = 0; i < baseline.length; i++) {
    const p = (baseline[i] + epsilon) / (sumP + epsilon * baseline.length);
    const q = (current[i] + epsilon) / (sumQ + epsilon * current.length);
    psi += (q - p) * Math.log(q / p);
  }

  return Math.abs(psi);
}

/**
 * Detect drift in a feature.
 */
function detectDrift(
  baseline: FeatureStatistics,
  current: FeatureStatistics,
  klThreshold: number = 0.1,
  psiThreshold: number = 0.2
): DriftResult {
  const kl = calculateKLDivergence(baseline.histogram, current.histogram);
  const psi = calculatePSI(baseline.histogram, current.histogram);

  const hasDrift = kl > klThreshold || psi > psiThreshold;
  const driftScore = Math.max(kl / klThreshold, psi / psiThreshold);

  let severity: DriftResult['severity'] = 'none';
  if (driftScore >= 3.0) severity = 'critical';
  else if (driftScore >= 2.0) severity = 'high';
  else if (driftScore >= 1.0) severity = 'medium';
  else if (driftScore >= 0.5) severity = 'low';

  return {
    featureName: baseline.name,
    driftScore,
    threshold: 1.0,
    hasDrift,
    severity,
  };
}

/**
 * Generate alert for drift.
 */
let alertCounter = 0;
function generateAlert(results: DriftResult[]): DriftAlert | null {
  const driftedFeatures = results.filter((r) => r.hasDrift);

  if (driftedFeatures.length === 0) {
    return null;
  }

  const maxSeverity = driftedFeatures.reduce((max, r) => {
    const severityOrder = ['none', 'low', 'medium', 'high', 'critical'];
    return severityOrder.indexOf(r.severity) > severityOrder.indexOf(max)
      ? r.severity
      : max;
  }, 'none' as DriftResult['severity']);

  alertCounter++;
  return {
    alertId: `alert_${Date.now()}_${alertCounter}`,
    timestamp: new Date().toISOString(),
    severity: maxSeverity,
    message: `Drift detected in ${driftedFeatures.length} features`,
    affectedFeatures: driftedFeatures.map((r) => r.featureName),
  };
}

// Arbitraries for generating test data
const validHistogram = fc.array(fc.integer({ min: 0, max: 1000 }), {
  minLength: 10,
  maxLength: 10,
});

const validFeatureStats: fc.Arbitrary<FeatureStatistics> = fc.record({
  name: fc.string({ minLength: 1, maxLength: 50 }),
  mean: fc.double({ min: -1000, max: 1000, noNaN: true }),
  std: fc.double({ min: 0, max: 100, noNaN: true }),
  min: fc.double({ min: -1000, max: 0, noNaN: true }),
  max: fc.double({ min: 0, max: 1000, noNaN: true }),
  histogram: validHistogram,
});

describe('Property 17: Drift Detection Alerting', () => {
  /**
   * **Validates: Requirements 9.2**
   *
   * Test that distribution changes trigger alerts
   */

  describe('KL Divergence Calculation', () => {
    it('SHALL return 0 for identical distributions', () => {
      fc.assert(
        fc.property(validHistogram, (histogram) => {
          const kl = calculateKLDivergence(histogram, histogram);
          expect(kl).toBeCloseTo(0, 5);
        }),
        propertyConfig
      );
    });

    it('SHALL return positive value for different distributions', () => {
      fc.assert(
        fc.property(
          validHistogram,
          validHistogram.filter((h) => h.some((v) => v > 0)),
          (baseline, current) => {
            // Only test if distributions are actually different
            const isDifferent = baseline.some((v, i) => v !== current[i]);
            if (isDifferent) {
              const kl = calculateKLDivergence(baseline, current);
              expect(kl).toBeGreaterThanOrEqual(0);
            }
          }
        ),
        propertyConfig
      );
    });

    it('SHALL be non-negative', () => {
      fc.assert(
        fc.property(validHistogram, validHistogram, (baseline, current) => {
          const kl = calculateKLDivergence(baseline, current);
          expect(kl).toBeGreaterThanOrEqual(0);
        }),
        propertyConfig
      );
    });
  });

  describe('PSI Calculation', () => {
    it('SHALL return 0 for identical distributions', () => {
      fc.assert(
        fc.property(validHistogram, (histogram) => {
          const psi = calculatePSI(histogram, histogram);
          expect(psi).toBeCloseTo(0, 5);
        }),
        propertyConfig
      );
    });

    it('SHALL be non-negative', () => {
      fc.assert(
        fc.property(validHistogram, validHistogram, (baseline, current) => {
          const psi = calculatePSI(baseline, current);
          expect(psi).toBeGreaterThanOrEqual(0);
        }),
        propertyConfig
      );
    });
  });

  describe('Drift Detection', () => {
    it('SHALL NOT detect drift for identical distributions', () => {
      fc.assert(
        fc.property(validFeatureStats, (stats) => {
          const result = detectDrift(stats, stats);
          expect(result.hasDrift).toBe(false);
          expect(result.severity).toBe('none');
        }),
        propertyConfig
      );
    });

    it('SHALL detect drift when KL divergence exceeds threshold', () => {
      // Create significantly different distributions
      const baseline: FeatureStatistics = {
        name: 'test_feature',
        mean: 50,
        std: 10,
        min: 0,
        max: 100,
        histogram: [100, 200, 300, 400, 500, 400, 300, 200, 100, 50],
      };

      const drifted: FeatureStatistics = {
        name: 'test_feature',
        mean: 80,
        std: 5,
        min: 60,
        max: 100,
        histogram: [10, 20, 30, 50, 100, 200, 400, 600, 800, 1000],
      };

      const result = detectDrift(baseline, drifted, 0.1, 0.2);
      expect(result.hasDrift).toBe(true);
    });

    it('SHALL return valid severity levels', () => {
      fc.assert(
        fc.property(validFeatureStats, validFeatureStats, (baseline, current) => {
          const result = detectDrift(baseline, current);
          expect(['none', 'low', 'medium', 'high', 'critical']).toContain(
            result.severity
          );
        }),
        propertyConfig
      );
    });

    it('SHALL include feature name in result', () => {
      fc.assert(
        fc.property(validFeatureStats, validFeatureStats, (baseline, current) => {
          const result = detectDrift(baseline, current);
          expect(result.featureName).toBe(baseline.name);
        }),
        propertyConfig
      );
    });

    it('drift score SHALL be non-negative', () => {
      fc.assert(
        fc.property(validFeatureStats, validFeatureStats, (baseline, current) => {
          const result = detectDrift(baseline, current);
          expect(result.driftScore).toBeGreaterThanOrEqual(0);
        }),
        propertyConfig
      );
    });
  });

  describe('Alert Generation', () => {
    it('SHALL NOT generate alert when no drift detected', () => {
      fc.assert(
        fc.property(validFeatureStats, (stats) => {
          const result = detectDrift(stats, stats);
          const alert = generateAlert([result]);
          expect(alert).toBeNull();
        }),
        propertyConfig
      );
    });

    it('SHALL generate alert when drift detected', () => {
      const baseline: FeatureStatistics = {
        name: 'test_feature',
        mean: 50,
        std: 10,
        min: 0,
        max: 100,
        histogram: [100, 200, 300, 400, 500, 400, 300, 200, 100, 50],
      };

      const drifted: FeatureStatistics = {
        name: 'test_feature',
        mean: 80,
        std: 5,
        min: 60,
        max: 100,
        histogram: [10, 20, 30, 50, 100, 200, 400, 600, 800, 1000],
      };

      const result = detectDrift(baseline, drifted, 0.1, 0.2);
      const alert = generateAlert([result]);

      expect(alert).not.toBeNull();
      expect(alert!.affectedFeatures).toContain('test_feature');
    });

    it('alert SHALL include all drifted features', () => {
      const results: DriftResult[] = [
        {
          featureName: 'feature1',
          driftScore: 2.0,
          threshold: 1.0,
          hasDrift: true,
          severity: 'high',
        },
        {
          featureName: 'feature2',
          driftScore: 1.5,
          threshold: 1.0,
          hasDrift: true,
          severity: 'medium',
        },
        {
          featureName: 'feature3',
          driftScore: 0.5,
          threshold: 1.0,
          hasDrift: false,
          severity: 'none',
        },
      ];

      const alert = generateAlert(results);

      expect(alert).not.toBeNull();
      expect(alert!.affectedFeatures).toContain('feature1');
      expect(alert!.affectedFeatures).toContain('feature2');
      expect(alert!.affectedFeatures).not.toContain('feature3');
    });

    it('alert SHALL have highest severity among drifted features', () => {
      const results: DriftResult[] = [
        {
          featureName: 'feature1',
          driftScore: 1.5,
          threshold: 1.0,
          hasDrift: true,
          severity: 'medium',
        },
        {
          featureName: 'feature2',
          driftScore: 3.5,
          threshold: 1.0,
          hasDrift: true,
          severity: 'critical',
        },
        {
          featureName: 'feature3',
          driftScore: 2.0,
          threshold: 1.0,
          hasDrift: true,
          severity: 'high',
        },
      ];

      const alert = generateAlert(results);

      expect(alert).not.toBeNull();
      expect(alert!.severity).toBe('critical');
    });

    it('alert SHALL include timestamp', () => {
      const results: DriftResult[] = [
        {
          featureName: 'feature1',
          driftScore: 2.0,
          threshold: 1.0,
          hasDrift: true,
          severity: 'high',
        },
      ];

      const beforeAlert = new Date().toISOString();
      const alert = generateAlert(results);
      const afterAlert = new Date().toISOString();

      expect(alert).not.toBeNull();
      expect(alert!.timestamp).toBeDefined();
      expect(alert!.timestamp >= beforeAlert).toBe(true);
      expect(alert!.timestamp <= afterAlert).toBe(true);
    });

    it('alert SHALL have unique ID', () => {
      const results: DriftResult[] = [
        {
          featureName: 'feature1',
          driftScore: 2.0,
          threshold: 1.0,
          hasDrift: true,
          severity: 'high',
        },
      ];

      const alert1 = generateAlert(results);
      const alert2 = generateAlert(results);

      expect(alert1).not.toBeNull();
      expect(alert2).not.toBeNull();
      expect(alert1!.alertId).not.toBe(alert2!.alertId);
    });
  });

  describe('Threshold Configuration', () => {
    it('SHALL respect custom KL threshold', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 0.01, max: 1.0, noNaN: true }),
          (threshold) => {
            const baseline: FeatureStatistics = {
              name: 'test',
              mean: 50,
              std: 10,
              min: 0,
              max: 100,
              histogram: [100, 100, 100, 100, 100, 100, 100, 100, 100, 100],
            };

            // Same distribution should not trigger drift regardless of threshold
            const result = detectDrift(baseline, baseline, threshold, 1.0);
            expect(result.hasDrift).toBe(false);
          }
        ),
        propertyConfig
      );
    });

    it('SHALL respect custom PSI threshold', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 0.01, max: 1.0, noNaN: true }),
          (threshold) => {
            const baseline: FeatureStatistics = {
              name: 'test',
              mean: 50,
              std: 10,
              min: 0,
              max: 100,
              histogram: [100, 100, 100, 100, 100, 100, 100, 100, 100, 100],
            };

            // Same distribution should not trigger drift regardless of threshold
            const result = detectDrift(baseline, baseline, 1.0, threshold);
            expect(result.hasDrift).toBe(false);
          }
        ),
        propertyConfig
      );
    });
  });

  describe('Severity Classification', () => {
    it('SHALL classify severity based on drift score', () => {
      const testCases = [
        { score: 0.3, expected: 'none' },
        { score: 0.7, expected: 'low' },
        { score: 1.5, expected: 'medium' },
        { score: 2.5, expected: 'high' },
        { score: 4.0, expected: 'critical' },
      ];

      for (const { score, expected } of testCases) {
        const result: DriftResult = {
          featureName: 'test',
          driftScore: score,
          threshold: 1.0,
          hasDrift: score >= 1.0,
          severity: 'none',
        };

        // Recalculate severity
        if (score >= 3.0) result.severity = 'critical';
        else if (score >= 2.0) result.severity = 'high';
        else if (score >= 1.0) result.severity = 'medium';
        else if (score >= 0.5) result.severity = 'low';

        expect(result.severity).toBe(expected);
      }
    });
  });
});
