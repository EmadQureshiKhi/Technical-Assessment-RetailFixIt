/**
 * Factor Analyzer
 *
 * Analyzes score breakdowns to identify top contributing factors,
 * risk factors, and calculate factor importance rankings.
 *
 * @requirement 3.2 - Explain top contributing factors to each vendor's score
 * @requirement 3.3 - Highlight risk factors or concerns for each vendor
 */

import type { ScoreBreakdown, ScoreFactor } from '@retailfixit/shared';

/**
 * Threshold below which a factor is considered a risk
 */
export const RISK_THRESHOLD = 0.5;

/**
 * Threshold below which a factor is considered low
 */
export const LOW_SCORE_THRESHOLD = 0.3;

/**
 * Minimum confidence for ML predictions to be considered reliable
 */
export const ML_CONFIDENCE_THRESHOLD = 0.7;

/**
 * Analyzed factor with additional metadata
 */
export interface AnalyzedFactor {
  factor: ScoreFactor;
  rank: number;
  isTopContributor: boolean;
  isRiskFactor: boolean;
  riskSeverity: 'low' | 'medium' | 'high' | null;
  category: 'rule-based' | 'ml-based' | 'historical';
}

/**
 * Risk factor with severity and description
 */
export interface RiskFactor {
  factorName: string;
  value: number;
  severity: 'low' | 'medium' | 'high';
  description: string;
  category: 'rule-based' | 'ml-based' | 'historical' | 'data-quality';
}

/**
 * Result of factor analysis
 */
export interface FactorAnalysisResult {
  topContributors: AnalyzedFactor[];
  riskFactors: RiskFactor[];
  allFactors: AnalyzedFactor[];
  overallRiskLevel: 'low' | 'medium' | 'high';
  dataQualityIssues: string[];
  mlConfidence: number | null;
}

/**
 * Options for factor analysis
 */
export interface FactorAnalysisOptions {
  topN?: number;
  riskThreshold?: number;
  includeMLFactors?: boolean;
  mlConfidence?: number;
}

/**
 * Default analysis options
 */
export const DEFAULT_ANALYSIS_OPTIONS: Required<FactorAnalysisOptions> = {
  topN: 3,
  riskThreshold: RISK_THRESHOLD,
  includeMLFactors: true,
  mlConfidence: 0,
};

/**
 * Categorizes a factor based on its name
 */
export function categorizeFactorByName(factorName: string): 'rule-based' | 'ml-based' | 'historical' {
  if (factorName.startsWith('ml') || factorName.startsWith('predicted')) {
    return 'ml-based';
  }
  if (factorName.includes('historical') || factorName.includes('completion') || factorName.includes('rework')) {
    return 'historical';
  }
  return 'rule-based';
}

/**
 * Determines risk severity based on factor value
 */
export function determineRiskSeverity(value: number): 'low' | 'medium' | 'high' | null {
  if (value >= RISK_THRESHOLD) {
    return null; // Not a risk
  }
  if (value < LOW_SCORE_THRESHOLD) {
    return 'high';
  }
  if (value < 0.4) {
    return 'medium';
  }
  return 'low';
}

/**
 * Generates a human-readable description for a risk factor
 */
export function generateRiskDescription(factorName: string, value: number): string {
  const percentage = (value * 100).toFixed(0);
  
  switch (factorName) {
    case 'availability':
      return value === 0 
        ? 'Vendor is currently unavailable'
        : `Limited availability (${percentage}% available)`;
    case 'proximity':
      return `Distance may affect response time (proximity score: ${percentage}%)`;
    case 'certification':
      return value === 0
        ? 'Missing all required certifications'
        : `Missing some required certifications (${percentage}% match)`;
    case 'capacity':
      return value === 0
        ? 'Vendor is at full capacity'
        : `Near capacity limit (${percentage}% available)`;
    case 'historicalCompletion':
      return `Below average completion rate (${percentage}%)`;
    case 'mlCompletionProbability':
      return `Lower predicted completion probability (${percentage}%)`;
    case 'mlReworkRisk':
      // Note: mlReworkRisk is inverted (1 - risk), so low value means high risk
      return `Higher predicted rework risk (${(100 - parseFloat(percentage)).toFixed(0)}% risk)`;
    case 'mlSatisfaction':
      return `Lower predicted customer satisfaction (${(value * 5).toFixed(1)}/5)`;
    default:
      return `${factorName} score is below threshold (${percentage}%)`;
  }
}

/**
 * Analyzes a single factor and returns analyzed metadata
 */
function analyzeFactor(
  factor: ScoreFactor,
  rank: number,
  topN: number,
  riskThreshold: number
): AnalyzedFactor {
  const category = categorizeFactorByName(factor.name);
  const riskSeverity = determineRiskSeverity(factor.value);
  
  return {
    factor,
    rank,
    isTopContributor: rank <= topN,
    isRiskFactor: factor.value < riskThreshold,
    riskSeverity,
    category,
  };
}

/**
 * Extracts risk factors from analyzed factors
 */
function extractRiskFactors(
  analyzedFactors: AnalyzedFactor[],
  _riskThreshold: number
): RiskFactor[] {
  return analyzedFactors
    .filter(af => af.isRiskFactor && af.riskSeverity !== null)
    .map(af => ({
      factorName: af.factor.name,
      value: af.factor.value,
      severity: af.riskSeverity!,
      description: generateRiskDescription(af.factor.name, af.factor.value),
      category: af.category,
    }))
    .sort((a, b) => {
      // Sort by severity (high first), then by value (lower first)
      const severityOrder = { high: 0, medium: 1, low: 2 };
      const severityDiff = severityOrder[a.severity] - severityOrder[b.severity];
      if (severityDiff !== 0) return severityDiff;
      return a.value - b.value;
    });
}

/**
 * Identifies data quality issues from the score breakdown
 */
function identifyDataQualityIssues(
  breakdown: ScoreBreakdown,
  mlConfidence: number | null
): string[] {
  const issues: string[] = [];
  
  // Check for missing factors
  const expectedFactors = ['availability', 'proximity', 'certification', 'capacity', 'historicalCompletion'];
  const presentFactors = new Set(breakdown.factors.map(f => f.name));
  
  for (const expected of expectedFactors) {
    if (!presentFactors.has(expected)) {
      issues.push(`Missing ${expected} factor data`);
    }
  }
  
  // Check ML confidence
  if (mlConfidence !== null && mlConfidence < ML_CONFIDENCE_THRESHOLD) {
    issues.push(`ML predictions have low confidence (${(mlConfidence * 100).toFixed(0)}%)`);
  }
  
  // Check for zero ML score when ML factors are present
  const hasMLFactors = breakdown.factors.some(f => f.name.startsWith('ml'));
  if (hasMLFactors && breakdown.mlScore === 0) {
    issues.push('ML predictions returned zero scores');
  }
  
  return issues;
}

/**
 * Calculates overall risk level based on risk factors
 */
function calculateOverallRiskLevel(riskFactors: RiskFactor[]): 'low' | 'medium' | 'high' {
  if (riskFactors.length === 0) {
    return 'low';
  }
  
  const hasHighRisk = riskFactors.some(rf => rf.severity === 'high');
  const hasMediumRisk = riskFactors.some(rf => rf.severity === 'medium');
  const multipleRisks = riskFactors.length >= 3;
  
  if (hasHighRisk || multipleRisks) {
    return 'high';
  }
  if (hasMediumRisk || riskFactors.length >= 2) {
    return 'medium';
  }
  return 'low';
}

/**
 * Analyzes a score breakdown to identify top contributors and risk factors
 *
 * @param breakdown - The score breakdown to analyze
 * @param options - Analysis options
 * @returns FactorAnalysisResult with top contributors, risks, and data quality issues
 *
 * @requirement 3.2 - Explain top contributing factors
 * @requirement 3.3 - Highlight risk factors
 */
export function analyzeFactors(
  breakdown: ScoreBreakdown,
  options: FactorAnalysisOptions = {}
): FactorAnalysisResult {
  const opts = { ...DEFAULT_ANALYSIS_OPTIONS, ...options };
  
  // Filter factors based on options
  let factors = [...breakdown.factors];
  if (!opts.includeMLFactors) {
    factors = factors.filter(f => !f.name.startsWith('ml'));
  }
  
  // Sort factors by contribution (descending)
  const sortedFactors = factors.sort((a, b) => b.contribution - a.contribution);
  
  // Analyze each factor
  const analyzedFactors = sortedFactors.map((factor, index) =>
    analyzeFactor(factor, index + 1, opts.topN, opts.riskThreshold)
  );
  
  // Extract top contributors
  const topContributors = analyzedFactors.filter(af => af.isTopContributor);
  
  // Extract risk factors
  const riskFactors = extractRiskFactors(analyzedFactors, opts.riskThreshold);
  
  // Identify data quality issues
  const mlConfidence = opts.mlConfidence > 0 ? opts.mlConfidence : null;
  const dataQualityIssues = identifyDataQualityIssues(breakdown, mlConfidence);
  
  // Calculate overall risk level
  const overallRiskLevel = calculateOverallRiskLevel(riskFactors);
  
  return {
    topContributors,
    riskFactors,
    allFactors: analyzedFactors,
    overallRiskLevel,
    dataQualityIssues,
    mlConfidence,
  };
}

/**
 * Gets the importance ranking of factors by contribution
 *
 * @param breakdown - The score breakdown to analyze
 * @returns Array of factor names sorted by importance (contribution)
 */
export function getFactorImportanceRanking(breakdown: ScoreBreakdown): string[] {
  return [...breakdown.factors]
    .sort((a, b) => b.contribution - a.contribution)
    .map(f => f.name);
}

/**
 * Identifies factors that are missing or have insufficient data
 *
 * @param breakdown - The score breakdown to analyze
 * @returns Array of factor names with data issues
 */
export function identifyMissingDataFactors(breakdown: ScoreBreakdown): string[] {
  const expectedFactors = [
    'availability',
    'proximity', 
    'certification',
    'capacity',
    'historicalCompletion',
  ];
  
  const presentFactors = new Set(breakdown.factors.map(f => f.name));
  return expectedFactors.filter(f => !presentFactors.has(f));
}
