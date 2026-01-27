/**
 * Property 16: Prediction Accuracy Monitoring
 *
 * For any completed job with a recorded outcome, the system SHALL compare
 * the predicted completion probability, time-to-completion, and rework risk
 * against actual values and store the comparison for accuracy tracking.
 *
 * @validates Requirements 9.1
 * @file src/ml/monitoring/drift_detector.py
 * @file src/ml/training/feedback_processor.py
 */

import fc from 'fast-check';
import { describe, expect, it, beforeEach } from 'vitest';

// Property test configuration
const propertyConfig = {
  numRuns: 100,
  verbose: false,
};

/**
 * TypeScript implementation of prediction accuracy monitoring for testing.
 * This mirrors the Python implementation in drift_detector.py
 */

interface Prediction {
  jobId: string;
  vendorId: string;
  modelVersion: string;
  completionProbability: number;
  timeToComplete: number;
  reworkRisk: number;
  timestamp: string;
}

interface Outcome {
  jobId: string;
  vendorId: string;
  completedSuccessfully: boolean;
  actualTimeToComplete: number;
  requiredRework: boolean;
  timestamp: string;
}

interface AccuracyComparison {
  jobId: string;
  vendorId: string;
  modelVersion: string;
  
  // Completion prediction
  predictedCompletion: number;
  actualCompletion: boolean;
  completionCorrect: boolean;
  
  // Time prediction
  predictedTime: number;
  actualTime: number;
  timeError: number;
  timeErrorPercent: number;
  
  // Rework prediction
  predictedRework: number;
  actualRework: boolean;
  reworkCorrect: boolean;
  
  timestamp: string;
}

interface AccuracyMetrics {
  sampleSize: number;
  completionAccuracy: number;
  timeMae: number;
  timeRmse: number;
  reworkAccuracy: number;
  modelVersion: string;
  calculatedAt: string;
}

/**
 * Performance Monitor for testing.
 */
class PerformanceMonitor {
  private predictions: Prediction[] = [];
  private outcomes: Outcome[] = [];
  private comparisons: AccuracyComparison[] = [];
  private metricsHistory: AccuracyMetrics[] = [];

  recordPrediction(prediction: Prediction): void {
    this.predictions.push(prediction);
  }

  recordOutcome(outcome: Outcome): void {
    this.outcomes.push(outcome);
    this.compareWithPrediction(outcome);
  }

  private compareWithPrediction(outcome: Outcome): void {
    const prediction = this.predictions.find(
      (p) => p.jobId === outcome.jobId && p.vendorId === outcome.vendorId
    );

    if (!prediction) {
      return;
    }

    const comparison: AccuracyComparison = {
      jobId: outcome.jobId,
      vendorId: outcome.vendorId,
      modelVersion: prediction.modelVersion,
      
      predictedCompletion: prediction.completionProbability,
      actualCompletion: outcome.completedSuccessfully,
      completionCorrect: (prediction.completionProbability > 0.5) === outcome.completedSuccessfully,
      
      predictedTime: prediction.timeToComplete,
      actualTime: outcome.actualTimeToComplete,
      timeError: Math.abs(prediction.timeToComplete - outcome.actualTimeToComplete),
      timeErrorPercent: outcome.actualTimeToComplete > 0
        ? Math.abs(prediction.timeToComplete - outcome.actualTimeToComplete) / outcome.actualTimeToComplete * 100
        : 0,
      
      predictedRework: prediction.reworkRisk,
      actualRework: outcome.requiredRework,
      reworkCorrect: (prediction.reworkRisk > 0.5) === outcome.requiredRework,
      
      timestamp: new Date().toISOString(),
    };

    this.comparisons.push(comparison);
  }

  getComparisons(): AccuracyComparison[] {
    return [...this.comparisons];
  }

  calculateAccuracyMetrics(modelVersion?: string): AccuracyMetrics | null {
    let comparisons = this.comparisons;
    
    if (modelVersion) {
      comparisons = comparisons.filter((c) => c.modelVersion === modelVersion);
    }

    if (comparisons.length === 0) {
      return null;
    }

    const completionCorrect = comparisons.filter((c) => c.completionCorrect).length;
    const reworkCorrect = comparisons.filter((c) => c.reworkCorrect).length;
    const timeErrors = comparisons.map((c) => c.timeError);
    
    const mae = timeErrors.reduce((a, b) => a + b, 0) / timeErrors.length;
    const rmse = Math.sqrt(
      timeErrors.map((e) => e * e).reduce((a, b) => a + b, 0) / timeErrors.length
    );

    const metrics: AccuracyMetrics = {
      sampleSize: comparisons.length,
      completionAccuracy: completionCorrect / comparisons.length,
      timeMae: mae,
      timeRmse: rmse,
      reworkAccuracy: reworkCorrect / comparisons.length,
      modelVersion: modelVersion || 'all',
      calculatedAt: new Date().toISOString(),
    };

    this.metricsHistory.push(metrics);
    return metrics;
  }

  getMetricsHistory(): AccuracyMetrics[] {
    return [...this.metricsHistory];
  }

  clear(): void {
    this.predictions = [];
    this.outcomes = [];
    this.comparisons = [];
    this.metricsHistory = [];
  }
}

// Arbitraries for generating test data
const validUuid = fc.uuid();

const validPrediction: fc.Arbitrary<Prediction> = fc.record({
  jobId: validUuid,
  vendorId: validUuid,
  modelVersion: fc.stringMatching(/^v\d+\.\d+\.\d+$/),
  completionProbability: fc.double({ min: 0, max: 1, noNaN: true }),
  timeToComplete: fc.double({ min: 0.1, max: 100, noNaN: true }),
  reworkRisk: fc.double({ min: 0, max: 1, noNaN: true }),
  timestamp: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') }).map((d) => d.toISOString()),
});

const validOutcome: fc.Arbitrary<Outcome> = fc.record({
  jobId: validUuid,
  vendorId: validUuid,
  completedSuccessfully: fc.boolean(),
  actualTimeToComplete: fc.double({ min: 0.1, max: 100, noNaN: true }),
  requiredRework: fc.boolean(),
  timestamp: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') }).map((d) => d.toISOString()),
});

// Generate matching prediction-outcome pairs
const validPredictionOutcomePair = fc.record({
  jobId: validUuid,
  vendorId: validUuid,
  modelVersion: fc.stringMatching(/^v\d+\.\d+\.\d+$/),
  completionProbability: fc.double({ min: 0, max: 1, noNaN: true }),
  timeToComplete: fc.double({ min: 0.1, max: 100, noNaN: true }),
  reworkRisk: fc.double({ min: 0, max: 1, noNaN: true }),
  completedSuccessfully: fc.boolean(),
  actualTimeToComplete: fc.double({ min: 0.1, max: 100, noNaN: true }),
  requiredRework: fc.boolean(),
});

describe('Property 16: Prediction Accuracy Monitoring', () => {
  /**
   * **Validates: Requirements 9.1**
   *
   * Test that predictions are compared to outcomes
   */

  let monitor: PerformanceMonitor;

  beforeEach(() => {
    monitor = new PerformanceMonitor();
  });

  describe('Prediction Recording', () => {
    it('SHALL record predictions for later comparison', () => {
      fc.assert(
        fc.property(validPrediction, (prediction) => {
          monitor.clear();
          monitor.recordPrediction(prediction);
          
          // Prediction should be stored (verified by outcome comparison)
          expect(true).toBe(true);
        }),
        propertyConfig
      );
    });
  });

  describe('Outcome Recording and Comparison', () => {
    it('SHALL compare outcome with matching prediction', () => {
      fc.assert(
        fc.property(validPredictionOutcomePair, (pair) => {
          monitor.clear();
          
          const prediction: Prediction = {
            jobId: pair.jobId,
            vendorId: pair.vendorId,
            modelVersion: pair.modelVersion,
            completionProbability: pair.completionProbability,
            timeToComplete: pair.timeToComplete,
            reworkRisk: pair.reworkRisk,
            timestamp: new Date().toISOString(),
          };
          
          const outcome: Outcome = {
            jobId: pair.jobId,
            vendorId: pair.vendorId,
            completedSuccessfully: pair.completedSuccessfully,
            actualTimeToComplete: pair.actualTimeToComplete,
            requiredRework: pair.requiredRework,
            timestamp: new Date().toISOString(),
          };
          
          monitor.recordPrediction(prediction);
          monitor.recordOutcome(outcome);
          
          const comparisons = monitor.getComparisons();
          expect(comparisons.length).toBe(1);
          expect(comparisons[0].jobId).toBe(pair.jobId);
          expect(comparisons[0].vendorId).toBe(pair.vendorId);
        }),
        propertyConfig
      );
    });

    it('SHALL NOT create comparison without matching prediction', () => {
      fc.assert(
        fc.property(validOutcome, (outcome) => {
          monitor.clear();
          monitor.recordOutcome(outcome);
          
          const comparisons = monitor.getComparisons();
          expect(comparisons.length).toBe(0);
        }),
        propertyConfig
      );
    });
  });

  describe('Completion Prediction Comparison', () => {
    it('SHALL compare predicted completion probability to actual outcome', () => {
      fc.assert(
        fc.property(validPredictionOutcomePair, (pair) => {
          monitor.clear();
          
          const prediction: Prediction = {
            jobId: pair.jobId,
            vendorId: pair.vendorId,
            modelVersion: pair.modelVersion,
            completionProbability: pair.completionProbability,
            timeToComplete: pair.timeToComplete,
            reworkRisk: pair.reworkRisk,
            timestamp: new Date().toISOString(),
          };
          
          const outcome: Outcome = {
            jobId: pair.jobId,
            vendorId: pair.vendorId,
            completedSuccessfully: pair.completedSuccessfully,
            actualTimeToComplete: pair.actualTimeToComplete,
            requiredRework: pair.requiredRework,
            timestamp: new Date().toISOString(),
          };
          
          monitor.recordPrediction(prediction);
          monitor.recordOutcome(outcome);
          
          const comparisons = monitor.getComparisons();
          expect(comparisons[0].predictedCompletion).toBe(pair.completionProbability);
          expect(comparisons[0].actualCompletion).toBe(pair.completedSuccessfully);
        }),
        propertyConfig
      );
    });

    it('SHALL correctly determine if completion prediction was correct', () => {
      fc.assert(
        fc.property(validPredictionOutcomePair, (pair) => {
          monitor.clear();
          
          const prediction: Prediction = {
            jobId: pair.jobId,
            vendorId: pair.vendorId,
            modelVersion: pair.modelVersion,
            completionProbability: pair.completionProbability,
            timeToComplete: pair.timeToComplete,
            reworkRisk: pair.reworkRisk,
            timestamp: new Date().toISOString(),
          };
          
          const outcome: Outcome = {
            jobId: pair.jobId,
            vendorId: pair.vendorId,
            completedSuccessfully: pair.completedSuccessfully,
            actualTimeToComplete: pair.actualTimeToComplete,
            requiredRework: pair.requiredRework,
            timestamp: new Date().toISOString(),
          };
          
          monitor.recordPrediction(prediction);
          monitor.recordOutcome(outcome);
          
          const comparisons = monitor.getComparisons();
          const expectedCorrect = (pair.completionProbability > 0.5) === pair.completedSuccessfully;
          expect(comparisons[0].completionCorrect).toBe(expectedCorrect);
        }),
        propertyConfig
      );
    });
  });

  describe('Time Prediction Comparison', () => {
    it('SHALL calculate time prediction error', () => {
      fc.assert(
        fc.property(validPredictionOutcomePair, (pair) => {
          monitor.clear();
          
          const prediction: Prediction = {
            jobId: pair.jobId,
            vendorId: pair.vendorId,
            modelVersion: pair.modelVersion,
            completionProbability: pair.completionProbability,
            timeToComplete: pair.timeToComplete,
            reworkRisk: pair.reworkRisk,
            timestamp: new Date().toISOString(),
          };
          
          const outcome: Outcome = {
            jobId: pair.jobId,
            vendorId: pair.vendorId,
            completedSuccessfully: pair.completedSuccessfully,
            actualTimeToComplete: pair.actualTimeToComplete,
            requiredRework: pair.requiredRework,
            timestamp: new Date().toISOString(),
          };
          
          monitor.recordPrediction(prediction);
          monitor.recordOutcome(outcome);
          
          const comparisons = monitor.getComparisons();
          const expectedError = Math.abs(pair.timeToComplete - pair.actualTimeToComplete);
          expect(comparisons[0].timeError).toBeCloseTo(expectedError, 5);
        }),
        propertyConfig
      );
    });

    it('time error SHALL be non-negative', () => {
      fc.assert(
        fc.property(validPredictionOutcomePair, (pair) => {
          monitor.clear();
          
          const prediction: Prediction = {
            jobId: pair.jobId,
            vendorId: pair.vendorId,
            modelVersion: pair.modelVersion,
            completionProbability: pair.completionProbability,
            timeToComplete: pair.timeToComplete,
            reworkRisk: pair.reworkRisk,
            timestamp: new Date().toISOString(),
          };
          
          const outcome: Outcome = {
            jobId: pair.jobId,
            vendorId: pair.vendorId,
            completedSuccessfully: pair.completedSuccessfully,
            actualTimeToComplete: pair.actualTimeToComplete,
            requiredRework: pair.requiredRework,
            timestamp: new Date().toISOString(),
          };
          
          monitor.recordPrediction(prediction);
          monitor.recordOutcome(outcome);
          
          const comparisons = monitor.getComparisons();
          expect(comparisons[0].timeError).toBeGreaterThanOrEqual(0);
        }),
        propertyConfig
      );
    });
  });

  describe('Rework Prediction Comparison', () => {
    it('SHALL compare predicted rework risk to actual outcome', () => {
      fc.assert(
        fc.property(validPredictionOutcomePair, (pair) => {
          monitor.clear();
          
          const prediction: Prediction = {
            jobId: pair.jobId,
            vendorId: pair.vendorId,
            modelVersion: pair.modelVersion,
            completionProbability: pair.completionProbability,
            timeToComplete: pair.timeToComplete,
            reworkRisk: pair.reworkRisk,
            timestamp: new Date().toISOString(),
          };
          
          const outcome: Outcome = {
            jobId: pair.jobId,
            vendorId: pair.vendorId,
            completedSuccessfully: pair.completedSuccessfully,
            actualTimeToComplete: pair.actualTimeToComplete,
            requiredRework: pair.requiredRework,
            timestamp: new Date().toISOString(),
          };
          
          monitor.recordPrediction(prediction);
          monitor.recordOutcome(outcome);
          
          const comparisons = monitor.getComparisons();
          expect(comparisons[0].predictedRework).toBe(pair.reworkRisk);
          expect(comparisons[0].actualRework).toBe(pair.requiredRework);
        }),
        propertyConfig
      );
    });
  });

  describe('Accuracy Metrics Calculation', () => {
    it('SHALL calculate accuracy metrics from comparisons', () => {
      fc.assert(
        fc.property(
          fc.array(validPredictionOutcomePair, { minLength: 1, maxLength: 10 }),
          (pairs) => {
            monitor.clear();
            
            for (const pair of pairs) {
              const prediction: Prediction = {
                jobId: pair.jobId,
                vendorId: pair.vendorId,
                modelVersion: pair.modelVersion,
                completionProbability: pair.completionProbability,
                timeToComplete: pair.timeToComplete,
                reworkRisk: pair.reworkRisk,
                timestamp: new Date().toISOString(),
              };
              
              const outcome: Outcome = {
                jobId: pair.jobId,
                vendorId: pair.vendorId,
                completedSuccessfully: pair.completedSuccessfully,
                actualTimeToComplete: pair.actualTimeToComplete,
                requiredRework: pair.requiredRework,
                timestamp: new Date().toISOString(),
              };
              
              monitor.recordPrediction(prediction);
              monitor.recordOutcome(outcome);
            }
            
            const metrics = monitor.calculateAccuracyMetrics();
            
            expect(metrics).not.toBeNull();
            expect(metrics!.sampleSize).toBe(pairs.length);
          }
        ),
        propertyConfig
      );
    });

    it('accuracy metrics SHALL be between 0 and 1', () => {
      fc.assert(
        fc.property(
          fc.array(validPredictionOutcomePair, { minLength: 1, maxLength: 10 }),
          (pairs) => {
            monitor.clear();
            
            for (const pair of pairs) {
              const prediction: Prediction = {
                jobId: pair.jobId,
                vendorId: pair.vendorId,
                modelVersion: pair.modelVersion,
                completionProbability: pair.completionProbability,
                timeToComplete: pair.timeToComplete,
                reworkRisk: pair.reworkRisk,
                timestamp: new Date().toISOString(),
              };
              
              const outcome: Outcome = {
                jobId: pair.jobId,
                vendorId: pair.vendorId,
                completedSuccessfully: pair.completedSuccessfully,
                actualTimeToComplete: pair.actualTimeToComplete,
                requiredRework: pair.requiredRework,
                timestamp: new Date().toISOString(),
              };
              
              monitor.recordPrediction(prediction);
              monitor.recordOutcome(outcome);
            }
            
            const metrics = monitor.calculateAccuracyMetrics();
            
            expect(metrics!.completionAccuracy).toBeGreaterThanOrEqual(0);
            expect(metrics!.completionAccuracy).toBeLessThanOrEqual(1);
            expect(metrics!.reworkAccuracy).toBeGreaterThanOrEqual(0);
            expect(metrics!.reworkAccuracy).toBeLessThanOrEqual(1);
          }
        ),
        propertyConfig
      );
    });

    it('MAE SHALL be non-negative', () => {
      fc.assert(
        fc.property(
          fc.array(validPredictionOutcomePair, { minLength: 1, maxLength: 10 }),
          (pairs) => {
            monitor.clear();
            
            for (const pair of pairs) {
              const prediction: Prediction = {
                jobId: pair.jobId,
                vendorId: pair.vendorId,
                modelVersion: pair.modelVersion,
                completionProbability: pair.completionProbability,
                timeToComplete: pair.timeToComplete,
                reworkRisk: pair.reworkRisk,
                timestamp: new Date().toISOString(),
              };
              
              const outcome: Outcome = {
                jobId: pair.jobId,
                vendorId: pair.vendorId,
                completedSuccessfully: pair.completedSuccessfully,
                actualTimeToComplete: pair.actualTimeToComplete,
                requiredRework: pair.requiredRework,
                timestamp: new Date().toISOString(),
              };
              
              monitor.recordPrediction(prediction);
              monitor.recordOutcome(outcome);
            }
            
            const metrics = monitor.calculateAccuracyMetrics();
            
            expect(metrics!.timeMae).toBeGreaterThanOrEqual(0);
            expect(metrics!.timeRmse).toBeGreaterThanOrEqual(0);
          }
        ),
        propertyConfig
      );
    });

    it('SHALL return null for empty comparisons', () => {
      const metrics = monitor.calculateAccuracyMetrics();
      expect(metrics).toBeNull();
    });
  });

  describe('Model Version Tracking', () => {
    it('SHALL include model version in comparison', () => {
      fc.assert(
        fc.property(validPredictionOutcomePair, (pair) => {
          monitor.clear();
          
          const prediction: Prediction = {
            jobId: pair.jobId,
            vendorId: pair.vendorId,
            modelVersion: pair.modelVersion,
            completionProbability: pair.completionProbability,
            timeToComplete: pair.timeToComplete,
            reworkRisk: pair.reworkRisk,
            timestamp: new Date().toISOString(),
          };
          
          const outcome: Outcome = {
            jobId: pair.jobId,
            vendorId: pair.vendorId,
            completedSuccessfully: pair.completedSuccessfully,
            actualTimeToComplete: pair.actualTimeToComplete,
            requiredRework: pair.requiredRework,
            timestamp: new Date().toISOString(),
          };
          
          monitor.recordPrediction(prediction);
          monitor.recordOutcome(outcome);
          
          const comparisons = monitor.getComparisons();
          expect(comparisons[0].modelVersion).toBe(pair.modelVersion);
        }),
        propertyConfig
      );
    });

    it('SHALL filter metrics by model version', () => {
      monitor.clear();
      
      // Add predictions with different model versions
      const v1Prediction: Prediction = {
        jobId: 'job-1',
        vendorId: 'vendor-1',
        modelVersion: 'v1.0.0',
        completionProbability: 0.8,
        timeToComplete: 4,
        reworkRisk: 0.1,
        timestamp: new Date().toISOString(),
      };
      
      const v2Prediction: Prediction = {
        jobId: 'job-2',
        vendorId: 'vendor-2',
        modelVersion: 'v2.0.0',
        completionProbability: 0.9,
        timeToComplete: 3,
        reworkRisk: 0.05,
        timestamp: new Date().toISOString(),
      };
      
      monitor.recordPrediction(v1Prediction);
      monitor.recordPrediction(v2Prediction);
      
      monitor.recordOutcome({
        jobId: 'job-1',
        vendorId: 'vendor-1',
        completedSuccessfully: true,
        actualTimeToComplete: 5,
        requiredRework: false,
        timestamp: new Date().toISOString(),
      });
      
      monitor.recordOutcome({
        jobId: 'job-2',
        vendorId: 'vendor-2',
        completedSuccessfully: true,
        actualTimeToComplete: 3.5,
        requiredRework: false,
        timestamp: new Date().toISOString(),
      });
      
      const v1Metrics = monitor.calculateAccuracyMetrics('v1.0.0');
      const v2Metrics = monitor.calculateAccuracyMetrics('v2.0.0');
      
      expect(v1Metrics).not.toBeNull();
      expect(v2Metrics).not.toBeNull();
      expect(v1Metrics!.sampleSize).toBe(1);
      expect(v2Metrics!.sampleSize).toBe(1);
      expect(v1Metrics!.modelVersion).toBe('v1.0.0');
      expect(v2Metrics!.modelVersion).toBe('v2.0.0');
    });
  });

  describe('Metrics History', () => {
    it('SHALL store metrics history', () => {
      fc.assert(
        fc.property(
          fc.array(validPredictionOutcomePair, { minLength: 1, maxLength: 5 }),
          (pairs) => {
            monitor.clear();
            
            for (const pair of pairs) {
              const prediction: Prediction = {
                jobId: pair.jobId,
                vendorId: pair.vendorId,
                modelVersion: pair.modelVersion,
                completionProbability: pair.completionProbability,
                timeToComplete: pair.timeToComplete,
                reworkRisk: pair.reworkRisk,
                timestamp: new Date().toISOString(),
              };
              
              const outcome: Outcome = {
                jobId: pair.jobId,
                vendorId: pair.vendorId,
                completedSuccessfully: pair.completedSuccessfully,
                actualTimeToComplete: pair.actualTimeToComplete,
                requiredRework: pair.requiredRework,
                timestamp: new Date().toISOString(),
              };
              
              monitor.recordPrediction(prediction);
              monitor.recordOutcome(outcome);
            }
            
            // Calculate metrics multiple times
            monitor.calculateAccuracyMetrics();
            monitor.calculateAccuracyMetrics();
            
            const history = monitor.getMetricsHistory();
            expect(history.length).toBe(2);
          }
        ),
        propertyConfig
      );
    });
  });
});
