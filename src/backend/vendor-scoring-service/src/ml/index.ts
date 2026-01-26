/**
 * ML Integration Module
 *
 * Exports ML client, feature extraction, and related utilities
 * for the vendor scoring service.
 *
 * @requirement 2.2 - ML-based scoring
 * @requirement 13.1 - Fallback handling
 * @requirement 13.4 - Circuit breaker pattern
 */

export * from './ml-client.js';
export * from './feature-extractor.js';
