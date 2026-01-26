/**
 * RetailFixIt Shared Package
 *
 * Exports all shared models, schemas, and utilities for the
 * RetailFixIt Vendor Dispatch System.
 *
 * @requirement 7.1, 7.2, 7.3 - Canonical data model definitions
 * @requirement 10.1, 10.2, 10.4, 11.4 - Logging and metrics
 * @requirement 6.4, 6.5 - Audit trail
 */

// Job models and schemas
export * from './models/job.js';

// Vendor models and schemas
export * from './models/vendor.js';

// Scoring models and schemas
export * from './models/scoring.js';

// Event schemas
export * from './models/events.js';

// Cache client
export * from './cache/redis-client.js';

// Logging
export * from './logging/logger.js';

// Metrics
export * from './metrics/metrics-collector.js';

// Audit trail
export * from './audit/audit-logger.js';
