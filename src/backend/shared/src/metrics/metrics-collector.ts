/**
 * Metrics Collection Module
 *
 * Provides metrics collection for tracking request latency, error rates,
 * model inference time, override rates, and confidence distributions.
 *
 * @requirement 10.4 - Publish metrics to Azure Monitor including: request latency,
 *                    error rates, model inference time, and override rates
 * @property Property 19: Comprehensive Logging
 */

import type { TelemetryClient } from '../logging/logger.js';

/**
 * Metric types supported by the collector
 */
export const MetricType = {
  COUNTER: 'counter',
  GAUGE: 'gauge',
  HISTOGRAM: 'histogram',
  TIMER: 'timer',
} as const;

export type MetricType = (typeof MetricType)[keyof typeof MetricType];

/**
 * Metric entry for tracking
 */
export interface MetricEntry {
  name: string;
  type: MetricType;
  value: number;
  timestamp: Date;
  tags: Record<string, string>;
}

/**
 * Histogram bucket configuration
 */
export interface HistogramBuckets {
  boundaries: number[];
  counts: number[];
  sum: number;
  count: number;
}

/**
 * Timer result
 */
export interface TimerResult {
  durationMs: number;
  startTime: Date;
  endTime: Date;
}

/**
 * Metrics collector configuration
 */
export interface MetricsCollectorConfig {
  serviceName: string;
  enableConsole: boolean;
  enableAppInsights: boolean;
  telemetryClient?: TelemetryClient;
  flushIntervalMs: number;
  defaultTags: Record<string, string>;
}

/**
 * Default metrics collector configuration
 */
export const defaultMetricsConfig: MetricsCollectorConfig = {
  serviceName: 'retailfixit',
  enableConsole: false,
  enableAppInsights: false,
  flushIntervalMs: 60000, // 1 minute
  defaultTags: {},
};

/**
 * Predefined metric names for the RetailFixIt system
 */
export const MetricNames = {
  // Request metrics
  REQUEST_LATENCY: 'request_latency_ms',
  REQUEST_COUNT: 'request_count',
  REQUEST_ERROR_COUNT: 'request_error_count',
  REQUEST_SUCCESS_COUNT: 'request_success_count',

  // Scoring metrics
  SCORING_LATENCY: 'scoring_latency_ms',
  SCORING_COUNT: 'scoring_count',
  SCORING_ERROR_COUNT: 'scoring_error_count',

  // ML metrics
  ML_INFERENCE_LATENCY: 'ml_inference_latency_ms',
  ML_INFERENCE_COUNT: 'ml_inference_count',
  ML_INFERENCE_ERROR_COUNT: 'ml_inference_error_count',
  ML_FALLBACK_COUNT: 'ml_fallback_count',

  // Override metrics
  OVERRIDE_COUNT: 'override_count',
  OVERRIDE_RATE: 'override_rate',

  // Confidence metrics
  CONFIDENCE_SCORE: 'confidence_score',
  LOW_CONFIDENCE_COUNT: 'low_confidence_count',

  // Dependency metrics
  DEPENDENCY_LATENCY: 'dependency_latency_ms',
  DEPENDENCY_ERROR_COUNT: 'dependency_error_count',

  // Cache metrics
  CACHE_HIT_COUNT: 'cache_hit_count',
  CACHE_MISS_COUNT: 'cache_miss_count',
} as const;

/**
 * Default histogram buckets for latency metrics (in milliseconds)
 */
export const DEFAULT_LATENCY_BUCKETS = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

/**
 * Default histogram buckets for confidence scores (0-1)
 */
export const DEFAULT_CONFIDENCE_BUCKETS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];

/**
 * Metrics Collector class
 *
 * @requirement 10.4 - Publish metrics to Azure Monitor
 */
export class MetricsCollector {
  private config: MetricsCollectorConfig;
  private counters: Map<string, number> = new Map();
  private gauges: Map<string, number> = new Map();
  private histograms: Map<string, HistogramBuckets> = new Map();
  private metricEntries: MetricEntry[] = [];
  private flushTimer?: ReturnType<typeof setInterval>;

  constructor(config: Partial<MetricsCollectorConfig> = {}) {
    this.config = { ...defaultMetricsConfig, ...config };
  }

  /**
   * Starts the automatic flush timer
   */
  startFlushTimer(): void {
    if (this.flushTimer) {
      return;
    }

    this.flushTimer = setInterval(() => {
      this.flush();
    }, this.config.flushIntervalMs);
  }

  /**
   * Stops the automatic flush timer
   */
  stopFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }
  }

  /**
   * Gets all metric entries (for testing)
   */
  getMetricEntries(): MetricEntry[] {
    return [...this.metricEntries];
  }

  /**
   * Clears all metrics (for testing)
   */
  clear(): void {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
    this.metricEntries = [];
  }

  /**
   * Creates a metric key with tags
   */
  private createMetricKey(name: string, tags: Record<string, string>): string {
    const sortedTags = Object.entries(tags)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(',');
    return sortedTags ? `${name}:${sortedTags}` : name;
  }

  /**
   * Records a metric entry
   */
  private recordEntry(
    name: string,
    type: MetricType,
    value: number,
    tags: Record<string, string> = {}
  ): void {
    const entry: MetricEntry = {
      name,
      type,
      value,
      timestamp: new Date(),
      tags: { ...this.config.defaultTags, ...tags },
    };

    this.metricEntries.push(entry);

    if (this.config.enableConsole) {
      console.log(JSON.stringify(entry));
    }

    if (this.config.enableAppInsights && this.config.telemetryClient) {
      const properties: Record<string, string> = {
        service: this.config.serviceName,
        metricType: type,
        ...entry.tags,
      };

      this.config.telemetryClient.trackMetric(name, value, properties);
    }
  }

  /**
   * Increments a counter metric
   */
  incrementCounter(name: string, value = 1, tags: Record<string, string> = {}): void {
    const key = this.createMetricKey(name, tags);
    const current = this.counters.get(key) || 0;
    this.counters.set(key, current + value);
    this.recordEntry(name, MetricType.COUNTER, value, tags);
  }

  /**
   * Gets the current value of a counter
   */
  getCounter(name: string, tags: Record<string, string> = {}): number {
    const key = this.createMetricKey(name, tags);
    return this.counters.get(key) || 0;
  }

  /**
   * Sets a gauge metric
   */
  setGauge(name: string, value: number, tags: Record<string, string> = {}): void {
    const key = this.createMetricKey(name, tags);
    this.gauges.set(key, value);
    this.recordEntry(name, MetricType.GAUGE, value, tags);
  }

  /**
   * Gets the current value of a gauge
   */
  getGauge(name: string, tags: Record<string, string> = {}): number {
    const key = this.createMetricKey(name, tags);
    return this.gauges.get(key) || 0;
  }

  /**
   * Records a value in a histogram
   */
  recordHistogram(
    name: string,
    value: number,
    tags: Record<string, string> = {},
    buckets: number[] = DEFAULT_LATENCY_BUCKETS
  ): void {
    const key = this.createMetricKey(name, tags);

    let histogram = this.histograms.get(key);
    if (!histogram) {
      histogram = {
        boundaries: buckets,
        counts: new Array(buckets.length + 1).fill(0),
        sum: 0,
        count: 0,
      };
      this.histograms.set(key, histogram);
    }

    // Find the bucket for this value
    let bucketIndex = histogram.boundaries.length;
    for (let i = 0; i < histogram.boundaries.length; i++) {
      if (value <= histogram.boundaries[i]) {
        bucketIndex = i;
        break;
      }
    }

    histogram.counts[bucketIndex]++;
    histogram.sum += value;
    histogram.count++;

    this.recordEntry(name, MetricType.HISTOGRAM, value, tags);
  }

  /**
   * Gets histogram statistics
   */
  getHistogram(
    name: string,
    tags: Record<string, string> = {}
  ): HistogramBuckets | undefined {
    const key = this.createMetricKey(name, tags);
    return this.histograms.get(key);
  }

  /**
   * Starts a timer and returns a function to stop it
   */
  startTimer(): () => TimerResult {
    const startTime = new Date();

    return () => {
      const endTime = new Date();
      return {
        durationMs: endTime.getTime() - startTime.getTime(),
        startTime,
        endTime,
      };
    };
  }

  /**
   * Records request latency
   * @requirement 10.4 - Track request latency
   */
  recordRequestLatency(
    durationMs: number,
    tags: Record<string, string> = {}
  ): void {
    this.recordHistogram(MetricNames.REQUEST_LATENCY, durationMs, tags);
    this.incrementCounter(MetricNames.REQUEST_COUNT, 1, tags);
  }

  /**
   * Records a request error
   * @requirement 10.4 - Track error rates
   */
  recordRequestError(tags: Record<string, string> = {}): void {
    this.incrementCounter(MetricNames.REQUEST_ERROR_COUNT, 1, tags);
  }

  /**
   * Records a successful request
   */
  recordRequestSuccess(tags: Record<string, string> = {}): void {
    this.incrementCounter(MetricNames.REQUEST_SUCCESS_COUNT, 1, tags);
  }

  /**
   * Records scoring latency
   */
  recordScoringLatency(
    durationMs: number,
    tags: Record<string, string> = {}
  ): void {
    this.recordHistogram(MetricNames.SCORING_LATENCY, durationMs, tags);
    this.incrementCounter(MetricNames.SCORING_COUNT, 1, tags);
  }

  /**
   * Records ML inference latency
   * @requirement 10.4 - Track model inference time
   */
  recordMLInferenceLatency(
    durationMs: number,
    tags: Record<string, string> = {}
  ): void {
    this.recordHistogram(MetricNames.ML_INFERENCE_LATENCY, durationMs, tags);
    this.incrementCounter(MetricNames.ML_INFERENCE_COUNT, 1, tags);
  }

  /**
   * Records ML inference error
   */
  recordMLInferenceError(tags: Record<string, string> = {}): void {
    this.incrementCounter(MetricNames.ML_INFERENCE_ERROR_COUNT, 1, tags);
  }

  /**
   * Records ML fallback usage
   */
  recordMLFallback(tags: Record<string, string> = {}): void {
    this.incrementCounter(MetricNames.ML_FALLBACK_COUNT, 1, tags);
  }

  /**
   * Records an override
   * @requirement 10.4 - Track override rates
   */
  recordOverride(tags: Record<string, string> = {}): void {
    this.incrementCounter(MetricNames.OVERRIDE_COUNT, 1, tags);
  }

  /**
   * Records override rate
   * @requirement 10.4 - Track override rates
   */
  recordOverrideRate(rate: number, tags: Record<string, string> = {}): void {
    this.setGauge(MetricNames.OVERRIDE_RATE, rate, tags);
  }

  /**
   * Records confidence score
   * @requirement 10.4 - Track confidence distributions
   */
  recordConfidenceScore(
    score: number,
    tags: Record<string, string> = {}
  ): void {
    this.recordHistogram(
      MetricNames.CONFIDENCE_SCORE,
      score,
      tags,
      DEFAULT_CONFIDENCE_BUCKETS
    );

    // Track low confidence count
    if (score < 0.7) {
      this.incrementCounter(MetricNames.LOW_CONFIDENCE_COUNT, 1, tags);
    }
  }

  /**
   * Records dependency latency
   */
  recordDependencyLatency(
    dependencyName: string,
    durationMs: number,
    success: boolean
  ): void {
    const tags = { dependency: dependencyName, success: String(success) };
    this.recordHistogram(MetricNames.DEPENDENCY_LATENCY, durationMs, tags);

    if (!success) {
      this.incrementCounter(MetricNames.DEPENDENCY_ERROR_COUNT, 1, tags);
    }
  }

  /**
   * Records cache hit
   */
  recordCacheHit(cacheName: string): void {
    this.incrementCounter(MetricNames.CACHE_HIT_COUNT, 1, { cache: cacheName });
  }

  /**
   * Records cache miss
   */
  recordCacheMiss(cacheName: string): void {
    this.incrementCounter(MetricNames.CACHE_MISS_COUNT, 1, { cache: cacheName });
  }

  /**
   * Gets error rate for a given time window
   */
  getErrorRate(tags: Record<string, string> = {}): number {
    const totalRequests = this.getCounter(MetricNames.REQUEST_COUNT, tags);
    const errorCount = this.getCounter(MetricNames.REQUEST_ERROR_COUNT, tags);

    if (totalRequests === 0) {
      return 0;
    }

    return errorCount / totalRequests;
  }

  /**
   * Gets average latency from histogram
   */
  getAverageLatency(
    metricName: string,
    tags: Record<string, string> = {}
  ): number {
    const histogram = this.getHistogram(metricName, tags);
    if (!histogram || histogram.count === 0) {
      return 0;
    }
    return histogram.sum / histogram.count;
  }

  /**
   * Gets percentile from histogram (approximate)
   */
  getPercentile(
    metricName: string,
    percentile: number,
    tags: Record<string, string> = {}
  ): number {
    const histogram = this.getHistogram(metricName, tags);
    if (!histogram || histogram.count === 0) {
      return 0;
    }

    const targetCount = Math.ceil((percentile / 100) * histogram.count);
    let cumulativeCount = 0;

    for (let i = 0; i < histogram.counts.length; i++) {
      cumulativeCount += histogram.counts[i];
      if (cumulativeCount >= targetCount) {
        // Return the upper bound of this bucket
        if (i < histogram.boundaries.length) {
          return histogram.boundaries[i];
        }
        // For the overflow bucket, return the last boundary
        return histogram.boundaries[histogram.boundaries.length - 1];
      }
    }

    return histogram.boundaries[histogram.boundaries.length - 1];
  }

  /**
   * Flushes metrics to Application Insights
   */
  flush(): void {
    if (this.config.enableAppInsights && this.config.telemetryClient) {
      this.config.telemetryClient.flush();
    }
  }

  /**
   * Gets a summary of all metrics
   */
  getSummary(): Record<string, unknown> {
    const summary: Record<string, unknown> = {
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries(this.gauges),
      histograms: {} as Record<string, unknown>,
    };

    for (const [key, histogram] of this.histograms) {
      (summary.histograms as Record<string, unknown>)[key] = {
        count: histogram.count,
        sum: histogram.sum,
        average: histogram.count > 0 ? histogram.sum / histogram.count : 0,
        buckets: histogram.boundaries.map((boundary, i) => ({
          le: boundary,
          count: histogram.counts[i],
        })),
      };
    }

    return summary;
  }
}

/**
 * Creates a metrics collector instance
 */
export function createMetricsCollector(
  config: Partial<MetricsCollectorConfig> = {}
): MetricsCollector {
  return new MetricsCollector(config);
}

/**
 * Default metrics collector instance
 */
export const defaultMetricsCollector = createMetricsCollector();
