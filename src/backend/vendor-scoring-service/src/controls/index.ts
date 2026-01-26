/**
 * Human-in-the-Loop Controls
 *
 * Exports automation level configuration and confidence-based routing
 * for human oversight of AI decisions.
 *
 * @requirement 6.1 - Configurable automation levels
 * @requirement 6.2 - Low confidence requires human approval
 * @requirement 13.3 - Confidence below 70% flagged for review
 */

export * from './automation-config.js';
export * from './confidence-router.js';
