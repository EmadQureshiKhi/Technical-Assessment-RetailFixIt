/**
 * Event Integration
 *
 * Entry point for event handlers and publishers.
 * Provides event-driven integration for the RetailFixIt system.
 *
 * @requirement 4.1 - JobCreated event consumption
 * @requirement 4.2 - VendorRecommendationGenerated event publishing
 * @requirement 4.3 - Dead-letter handling
 * @requirement 4.5 - Idempotency
 * @requirement 4.6 - Correlation ID propagation
 */

export const VERSION = '1.0.0';

// Export event handlers
export * from './handlers/index.js';

// Export event publishers
export * from './publishers/index.js';
