/**
 * Explainability Layer
 *
 * Entry point for the explainability service that generates
 * human-readable explanations for vendor recommendations.
 *
 * @requirement 3.1 - Human-readable explanations
 * @requirement 3.2 - Top contributing factors
 * @requirement 3.3 - Risk factors
 * @requirement 3.4 - Comparative explanations
 * @requirement 3.5 - Confidence levels
 * @requirement 3.6 - Exclusion reasons
 */

export const VERSION = '1.0.0';

// Factor Analyzer
export {
  analyzeFactors,
  getFactorImportanceRanking,
  identifyMissingDataFactors,
  categorizeFactorByName,
  determineRiskSeverity,
  generateRiskDescription,
  RISK_THRESHOLD,
  LOW_SCORE_THRESHOLD,
  ML_CONFIDENCE_THRESHOLD,
  DEFAULT_ANALYSIS_OPTIONS,
  type AnalyzedFactor,
  type RiskFactor,
  type FactorAnalysisResult,
  type FactorAnalysisOptions,
} from './factor-analyzer.js';

// Narrative Generator
export {
  generateVendorExplanation,
  generateExclusionReason,
  generateBriefRationale,
  generateRiskFactorStrings,
  DEFAULT_NARRATIVE_OPTIONS,
  type VendorExplanation,
  type ExclusionReason,
  type NarrativeOptions,
} from './narrative-generator.js';

// Comparison Engine
export {
  compareVendors,
  generatePairwiseComparisons,
  analyzeComparisons,
  generateBriefComparison,
  getMostSignificantDifference,
  SIGNIFICANT_DIFFERENCE_THRESHOLD,
  type FactorDifference,
  type VendorComparison,
  type ComparisonAnalysis,
} from './comparison-engine.js';
