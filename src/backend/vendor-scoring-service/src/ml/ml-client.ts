/**
 * ML Client with Fallback Handling
 *
 * Implements Azure ML endpoint invocation with timeout handling,
 * circuit breaker pattern, and graceful fallback to rule-based scoring.
 *
 * @requirement 2.2 - ML-based scoring for completion probability, time-to-complete, rework risk
 * @requirement 13.1 - Fall back to rule-based scoring when ML unavailable
 * @requirement 13.2 - Timeout handling (5 second limit)
 * @requirement 13.4 - Circuit breaker pattern
 */

import type { JobEvent, VendorProfile } from '@retailfixit/shared';

/**
 * ML prediction result from the model endpoint
 */
export interface MLPrediction {
  completionProbability: number; // 0-1: Likelihood of successful completion
  timeToComplete: number; // Hours: Predicted time to complete
  reworkRisk: number; // 0-1: Probability of requiring rework
  predictedSatisfaction: number; // 0-5: Predicted customer satisfaction
  confidence: number; // 0-1: Model confidence in predictions
}

/**
 * ML client response including metadata
 */
export interface MLClientResponse {
  prediction: MLPrediction | null;
  fromCache: boolean;
  degradedMode: boolean;
  latencyMs: number;
  error?: string;
}

/**
 * Circuit breaker states
 */
export enum CircuitState {
  CLOSED = 'CLOSED', // Normal operation
  OPEN = 'OPEN', // Failing, use fallback
  HALF_OPEN = 'HALF_OPEN', // Testing recovery
}

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  failureThreshold: number; // Number of failures to open circuit
  successThreshold: number; // Number of successes to close circuit
  timeout: number; // Time in ms before trying half-open
  halfOpenRequests: number; // Number of requests to allow in half-open
}

/**
 * Default circuit breaker configuration
 */
export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  successThreshold: 3,
  timeout: 30000, // 30 seconds
  halfOpenRequests: 1,
};

/**
 * ML endpoint configuration
 */
export interface MLEndpointConfig {
  endpoint: string;
  apiKey: string;
  timeoutMs: number;
  modelVersion: string;
}

/**
 * Default ML endpoint configuration
 */
export const DEFAULT_ML_ENDPOINT_CONFIG: MLEndpointConfig = {
  endpoint: process.env.ML_ENDPOINT || 'https://ml.retailfixit.azure.com/score',
  apiKey: process.env.ML_API_KEY || '',
  timeoutMs: 5000, // 5 second timeout as per requirement 13.2
  modelVersion: process.env.ML_MODEL_VERSION || 'v1.0.0',
};


/**
 * Default fallback prediction when ML is unavailable
 * Uses conservative estimates with low confidence
 */
export const DEFAULT_FALLBACK_PREDICTION: MLPrediction = {
  completionProbability: 0.7,
  timeToComplete: 4.0,
  reworkRisk: 0.15,
  predictedSatisfaction: 3.5,
  confidence: 0.3, // Low confidence indicates fallback
};

/**
 * Circuit Breaker implementation for ML endpoint protection
 *
 * @requirement 13.4 - Circuit breaker pattern for external service calls
 */
export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount: number = 0;
  private successCount: number = 0;
  private lastFailureTime: number = 0;
  private halfOpenRequestCount: number = 0;
  private readonly config: CircuitBreakerConfig;

  constructor(config: CircuitBreakerConfig = DEFAULT_CIRCUIT_BREAKER_CONFIG) {
    this.config = config;
  }

  /**
   * Get current circuit state
   */
  getState(): CircuitState {
    // Check if we should transition from OPEN to HALF_OPEN
    if (this.state === CircuitState.OPEN) {
      const timeSinceFailure = Date.now() - this.lastFailureTime;
      if (timeSinceFailure >= this.config.timeout) {
        this.state = CircuitState.HALF_OPEN;
        this.halfOpenRequestCount = 0;
      }
    }
    return this.state;
  }

  /**
   * Check if request should be allowed
   */
  allowRequest(): boolean {
    const currentState = this.getState();

    switch (currentState) {
      case CircuitState.CLOSED:
        return true;
      case CircuitState.OPEN:
        return false;
      case CircuitState.HALF_OPEN:
        // Allow limited requests in half-open state
        if (this.halfOpenRequestCount < this.config.halfOpenRequests) {
          this.halfOpenRequestCount++;
          return true;
        }
        return false;
      default:
        return false;
    }
  }

  /**
   * Record a successful request
   */
  recordSuccess(): void {
    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++;
      if (this.successCount >= this.config.successThreshold) {
        this.reset();
      }
    } else if (this.state === CircuitState.CLOSED) {
      // Reset failure count on success
      this.failureCount = 0;
    }
  }

  /**
   * Record a failed request
   */
  recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === CircuitState.HALF_OPEN) {
      // Any failure in half-open immediately opens the circuit
      this.state = CircuitState.OPEN;
      this.successCount = 0;
    } else if (this.failureCount >= this.config.failureThreshold) {
      this.state = CircuitState.OPEN;
    }
  }

  /**
   * Reset circuit breaker to closed state
   */
  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.halfOpenRequestCount = 0;
  }

  /**
   * Get circuit breaker statistics
   */
  getStats(): {
    state: CircuitState;
    failureCount: number;
    successCount: number;
    lastFailureTime: number;
  } {
    return {
      state: this.getState(),
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
    };
  }
}


/**
 * ML request payload for the Azure ML endpoint
 */
export interface MLRequestPayload {
  jobId: string;
  jobType: string;
  urgencyLevel: string;
  vendorId: string;
  vendorMetrics: {
    completionRate: number;
    reworkRate: number;
    avgResponseTimeHours: number;
    avgCustomerSatisfaction: number;
  };
  features: Record<string, number>;
}

/**
 * ML Client for Azure ML endpoint invocation
 *
 * Implements timeout handling, circuit breaker pattern, and graceful fallback.
 *
 * @requirement 2.2 - ML-based scoring
 * @requirement 13.1 - Fallback to rule-based scoring
 * @requirement 13.2 - 5 second timeout
 * @requirement 13.4 - Circuit breaker pattern
 */
export class MLClient {
  private readonly config: MLEndpointConfig;
  private readonly circuitBreaker: CircuitBreaker;
  private readonly cache: Map<string, { prediction: MLPrediction; timestamp: number }>;
  private readonly cacheTtlMs: number = 60000; // 1 minute cache

  constructor(
    config: MLEndpointConfig = DEFAULT_ML_ENDPOINT_CONFIG,
    circuitBreakerConfig: CircuitBreakerConfig = DEFAULT_CIRCUIT_BREAKER_CONFIG
  ) {
    this.config = config;
    this.circuitBreaker = new CircuitBreaker(circuitBreakerConfig);
    this.cache = new Map();
  }

  /**
   * Get prediction for a job-vendor pair
   *
   * @param job - The job event
   * @param vendor - The vendor profile
   * @param vendorMetrics - Historical vendor metrics
   * @returns MLClientResponse with prediction or fallback
   */
  async getPrediction(
    job: JobEvent,
    vendor: VendorProfile,
    vendorMetrics?: {
      completionRate: number;
      reworkRate: number;
      avgResponseTimeHours: number;
      avgCustomerSatisfaction: number;
    }
  ): Promise<MLClientResponse> {
    const startTime = Date.now();
    const cacheKey = this.getCacheKey(job.jobId, vendor.vendorId);

    // Check cache first
    const cached = this.getFromCache(cacheKey);
    if (cached) {
      return {
        prediction: cached,
        fromCache: true,
        degradedMode: false,
        latencyMs: Date.now() - startTime,
      };
    }

    // Check circuit breaker
    if (!this.circuitBreaker.allowRequest()) {
      return {
        prediction: DEFAULT_FALLBACK_PREDICTION,
        fromCache: false,
        degradedMode: true,
        latencyMs: Date.now() - startTime,
        error: 'Circuit breaker open - using fallback',
      };
    }

    try {
      const prediction = await this.invokeEndpoint(job, vendor, vendorMetrics);
      this.circuitBreaker.recordSuccess();
      this.setCache(cacheKey, prediction);

      return {
        prediction,
        fromCache: false,
        degradedMode: false,
        latencyMs: Date.now() - startTime,
      };
    } catch (error) {
      this.circuitBreaker.recordFailure();
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      return {
        prediction: DEFAULT_FALLBACK_PREDICTION,
        fromCache: false,
        degradedMode: true,
        latencyMs: Date.now() - startTime,
        error: errorMessage,
      };
    }
  }

  /**
   * Invoke the ML endpoint with timeout handling
   *
   * @requirement 13.2 - 5 second timeout
   */
  private async invokeEndpoint(
    job: JobEvent,
    vendor: VendorProfile,
    vendorMetrics?: {
      completionRate: number;
      reworkRate: number;
      avgResponseTimeHours: number;
      avgCustomerSatisfaction: number;
    }
  ): Promise<MLPrediction> {
    const payload = this.buildRequestPayload(job, vendor, vendorMetrics);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await fetch(this.config.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
          'x-model-version': this.config.modelVersion,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`ML endpoint returned ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      return this.parseResponse(result);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('ML endpoint timeout exceeded');
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Build request payload for ML endpoint
   */
  private buildRequestPayload(
    job: JobEvent,
    vendor: VendorProfile,
    vendorMetrics?: {
      completionRate: number;
      reworkRate: number;
      avgResponseTimeHours: number;
      avgCustomerSatisfaction: number;
    }
  ): MLRequestPayload {
    const defaultMetrics = {
      completionRate: 0.7,
      reworkRate: 0.1,
      avgResponseTimeHours: 4,
      avgCustomerSatisfaction: 3.5,
    };

    return {
      jobId: job.jobId,
      jobType: job.jobType,
      urgencyLevel: job.urgencyLevel,
      vendorId: vendor.vendorId,
      vendorMetrics: vendorMetrics || defaultMetrics,
      features: {}, // Features will be populated by feature extractor
    };
  }

  /**
   * Parse ML endpoint response into MLPrediction
   */
  private parseResponse(response: unknown): MLPrediction {
    // Type guard for response validation
    if (!response || typeof response !== 'object') {
      throw new Error('Invalid ML response format');
    }

    const data = response as Record<string, unknown>;

    return {
      completionProbability: this.parseNumber(data.completionProbability, 0.7),
      timeToComplete: this.parseNumber(data.timeToComplete, 4.0),
      reworkRisk: this.parseNumber(data.reworkRisk, 0.15),
      predictedSatisfaction: this.parseNumber(data.predictedSatisfaction, 3.5),
      confidence: this.parseNumber(data.confidence, 0.5),
    };
  }

  /**
   * Parse a number from response with fallback
   */
  private parseNumber(value: unknown, fallback: number): number {
    if (typeof value === 'number' && !isNaN(value)) {
      return value;
    }
    return fallback;
  }

  /**
   * Generate cache key for job-vendor pair
   */
  private getCacheKey(jobId: string, vendorId: string): string {
    return `${jobId}:${vendorId}`;
  }

  /**
   * Get prediction from cache if valid
   */
  private getFromCache(key: string): MLPrediction | null {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.cacheTtlMs) {
      return cached.prediction;
    }
    return null;
  }

  /**
   * Store prediction in cache
   */
  private setCache(key: string, prediction: MLPrediction): void {
    this.cache.set(key, { prediction, timestamp: Date.now() });
  }

  /**
   * Clear the prediction cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get circuit breaker state
   */
  getCircuitState(): CircuitState {
    return this.circuitBreaker.getState();
  }

  /**
   * Get circuit breaker statistics
   */
  getCircuitStats(): ReturnType<CircuitBreaker['getStats']> {
    return this.circuitBreaker.getStats();
  }

  /**
   * Reset circuit breaker (for testing)
   */
  resetCircuitBreaker(): void {
    this.circuitBreaker.reset();
  }

  /**
   * Get model version
   */
  getModelVersion(): string {
    return this.config.modelVersion;
  }
}

/**
 * Singleton ML client instance
 */
let mlClientInstance: MLClient | null = null;

/**
 * Get or create ML client instance
 */
export function getMLClient(
  config?: MLEndpointConfig,
  circuitBreakerConfig?: CircuitBreakerConfig
): MLClient {
  if (!mlClientInstance) {
    mlClientInstance = new MLClient(config, circuitBreakerConfig);
  }
  return mlClientInstance;
}

/**
 * Reset ML client instance (for testing)
 */
export function resetMLClient(): void {
  mlClientInstance = null;
}
