/**
 * JobCreated Event Handler
 *
 * Handles JobCreated events from Azure Event Grid/Service Bus.
 * Implements idempotency checking and triggers the scoring workflow.
 *
 * @requirement 4.1 - JobCreated event consumption
 * @requirement 4.5 - Idempotency to prevent duplicate recommendations
 * @property Property 8: Event Processing Idempotency
 */

import {
  type JobCreatedEvent,
  validateJobCreatedEvent,
  safeValidateJobCreatedEvent,
} from '@retailfixit/shared';

/**
 * Result of processing a JobCreated event
 */
export interface JobCreatedHandlerResult {
  success: boolean;
  jobId: string;
  correlationId: string;
  recommendationId: string | null;
  skipped: boolean;
  skipReason?: string;
  error?: string;
  processingTimeMs: number;
}

/**
 * Interface for idempotency store
 * Implementations can use Redis, Cosmos DB, or in-memory for testing
 */
export interface IdempotencyStore {
  /**
   * Check if a job has already been processed
   * @param jobId - The job ID to check
   * @returns The existing recommendation ID if processed, null otherwise
   */
  getProcessedJob(jobId: string): Promise<string | null>;

  /**
   * Mark a job as processed with its recommendation ID
   * @param jobId - The job ID
   * @param recommendationId - The generated recommendation ID
   * @param ttlSeconds - Time to live for the idempotency record
   */
  markJobProcessed(jobId: string, recommendationId: string, ttlSeconds?: number): Promise<void>;
}

/**
 * Interface for the scoring service
 */
export interface ScoringService {
  /**
   * Generate vendor recommendations for a job
   * @param event - The JobCreated event
   * @returns The recommendation ID
   */
  generateRecommendations(event: JobCreatedEvent): Promise<string>;
}

/**
 * Configuration for the JobCreated handler
 */
export interface JobCreatedHandlerConfig {
  /** Time to live for idempotency records in seconds (default: 24 hours) */
  idempotencyTtlSeconds: number;
  /** Whether to validate events strictly (default: true) */
  strictValidation: boolean;
}

/**
 * Default handler configuration
 */
export const DEFAULT_HANDLER_CONFIG: JobCreatedHandlerConfig = {
  idempotencyTtlSeconds: 86400, // 24 hours
  strictValidation: true,
};

/**
 * In-memory idempotency store for testing
 */
export class InMemoryIdempotencyStore implements IdempotencyStore {
  private store: Map<string, { recommendationId: string; expiresAt: number }> = new Map();

  async getProcessedJob(jobId: string): Promise<string | null> {
    const entry = this.store.get(jobId);
    if (!entry) {
      return null;
    }
    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.store.delete(jobId);
      return null;
    }
    return entry.recommendationId;
  }

  async markJobProcessed(jobId: string, recommendationId: string, ttlSeconds: number = 86400): Promise<void> {
    this.store.set(jobId, {
      recommendationId,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  /** Clear all entries (for testing) */
  clear(): void {
    this.store.clear();
  }

  /** Get store size (for testing) */
  size(): number {
    return this.store.size;
  }
}

/**
 * Generates a deterministic recommendation ID from job ID
 * This ensures idempotency - same job always gets same recommendation ID
 *
 * @property Property 8: Event Processing Idempotency
 */
export function generateRecommendationId(jobId: string): string {
  // Use a deterministic approach: recommendation ID is derived from job ID
  // This ensures that duplicate events for the same job produce the same recommendation ID
  return `rec-${jobId}`;
}

/**
 * JobCreated Event Handler
 *
 * Processes JobCreated events with idempotency checking.
 * Triggers the scoring workflow for new jobs.
 *
 * @requirement 4.1 - JobCreated event consumption
 * @requirement 4.5 - Idempotency to prevent duplicate recommendations
 */
export class JobCreatedHandler {
  private idempotencyStore: IdempotencyStore;
  private scoringService: ScoringService;
  private config: JobCreatedHandlerConfig;

  constructor(
    idempotencyStore: IdempotencyStore,
    scoringService: ScoringService,
    config: Partial<JobCreatedHandlerConfig> = {}
  ) {
    this.idempotencyStore = idempotencyStore;
    this.scoringService = scoringService;
    this.config = { ...DEFAULT_HANDLER_CONFIG, ...config };
  }

  /**
   * Handle a JobCreated event
   *
   * @param rawEvent - The raw event data (will be validated)
   * @returns Handler result with processing details
   *
   * @requirement 4.1 - Parse and validate JobCreated events
   * @requirement 4.5 - Implement idempotency check using jobId
   * @property Property 8: Event Processing Idempotency
   */
  async handle(rawEvent: unknown): Promise<JobCreatedHandlerResult> {
    const startTime = Date.now();

    // Validate the event
    const validationResult = safeValidateJobCreatedEvent(rawEvent);

    if (!validationResult.success) {
      const errorMessage = validationResult.error.errors
        .map((e) => `${e.path.join('.')}: ${e.message}`)
        .join('; ');

      return {
        success: false,
        jobId: '',
        correlationId: '',
        recommendationId: null,
        skipped: false,
        error: `Validation failed: ${errorMessage}`,
        processingTimeMs: Date.now() - startTime,
      };
    }

    const event = validationResult.data;
    const { jobId } = event.data;
    const { correlationId } = event;

    // Check idempotency - has this job already been processed?
    const existingRecommendationId = await this.idempotencyStore.getProcessedJob(jobId);

    if (existingRecommendationId) {
      // Job already processed - return existing recommendation ID
      return {
        success: true,
        jobId,
        correlationId,
        recommendationId: existingRecommendationId,
        skipped: true,
        skipReason: 'Job already processed (idempotency check)',
        processingTimeMs: Date.now() - startTime,
      };
    }

    // Generate deterministic recommendation ID
    const recommendationId = generateRecommendationId(jobId);

    try {
      // Trigger scoring workflow
      await this.scoringService.generateRecommendations(event);

      // Mark job as processed
      await this.idempotencyStore.markJobProcessed(
        jobId,
        recommendationId,
        this.config.idempotencyTtlSeconds
      );

      return {
        success: true,
        jobId,
        correlationId,
        recommendationId,
        skipped: false,
        processingTimeMs: Date.now() - startTime,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      return {
        success: false,
        jobId,
        correlationId,
        recommendationId: null,
        skipped: false,
        error: `Scoring failed: ${errorMessage}`,
        processingTimeMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Handle a pre-validated JobCreated event
   * Use this when the event has already been validated
   */
  async handleValidated(event: JobCreatedEvent): Promise<JobCreatedHandlerResult> {
    const startTime = Date.now();
    const { jobId } = event.data;
    const { correlationId } = event;

    // Check idempotency
    const existingRecommendationId = await this.idempotencyStore.getProcessedJob(jobId);

    if (existingRecommendationId) {
      return {
        success: true,
        jobId,
        correlationId,
        recommendationId: existingRecommendationId,
        skipped: true,
        skipReason: 'Job already processed (idempotency check)',
        processingTimeMs: Date.now() - startTime,
      };
    }

    const recommendationId = generateRecommendationId(jobId);

    try {
      await this.scoringService.generateRecommendations(event);

      await this.idempotencyStore.markJobProcessed(
        jobId,
        recommendationId,
        this.config.idempotencyTtlSeconds
      );

      return {
        success: true,
        jobId,
        correlationId,
        recommendationId,
        skipped: false,
        processingTimeMs: Date.now() - startTime,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      return {
        success: false,
        jobId,
        correlationId,
        recommendationId: null,
        skipped: false,
        error: `Scoring failed: ${errorMessage}`,
        processingTimeMs: Date.now() - startTime,
      };
    }
  }
}

/**
 * Validates a JobCreated event (re-export for convenience)
 */
export { validateJobCreatedEvent, safeValidateJobCreatedEvent };
