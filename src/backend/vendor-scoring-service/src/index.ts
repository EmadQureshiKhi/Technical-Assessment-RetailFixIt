/**
 * Vendor Scoring Service
 *
 * Entry point for the vendor scoring Azure Function.
 * Exports all scoring components for use by other modules.
 *
 * @requirement 1.1 - Process job data and vendor attributes to generate ranked vendor list
 */

export const VERSION = '1.0.0';

// Export rule-based scoring components
export * from './rules/index.js';

// Export ML integration components
export * from './ml/index.js';

// Export hybrid scoring components
export * from './scoring/index.js';

// Export human-in-the-loop controls
export * from './controls/index.js';
