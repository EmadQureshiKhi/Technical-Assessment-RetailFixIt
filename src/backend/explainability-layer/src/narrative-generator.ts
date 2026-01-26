/**
 * Narrative Generator
 *
 * Generates human-readable explanations from factor analysis results.
 * Produces clear, actionable narratives for vendor recommendations.
 *
 * @requirement 3.1 - Produce human-readable explanation for each ranked vendor
 * @requirement 3.5 - Include confidence levels for ML components
 * @requirement 3.6 - Provide exclusion reasons for filtered vendors
 */

import type { ScoreBreakdown, ScoreFactor } from '@retailfixit/shared';
import {
  analyzeFactors,
  type RiskFactor,
  type AnalyzedFactor,
  ML_CONFIDENCE_THRESHOLD,
} from './factor-analyzer.js';

/**
 * Vendor explanation containing all narrative components
 */
export interface VendorExplanation {
  summary: string;
  topFactorsNarrative: string;
  riskNarrative: string | null;
  confidenceNarrative: string | null;
  dataQualityNarrative: string | null;
  fullNarrative: string;
}

/**
 * Exclusion reason for filtered vendors
 */
export interface ExclusionReason {
  vendorId: string;
  vendorName: string;
  reason: string;
  details: string[];
  category: 'availability' | 'certification' | 'capacity' | 'geographic' | 'status' | 'blocked';
}

/**
 * Options for narrative generation
 */
export interface NarrativeOptions {
  includeConfidence?: boolean;
  includeDataQuality?: boolean;
  verboseMode?: boolean;
  mlConfidence?: number;
}

/**
 * Default narrative options
 */
export const DEFAULT_NARRATIVE_OPTIONS: Required<NarrativeOptions> = {
  includeConfidence: true,
  includeDataQuality: true,
  verboseMode: false,
  mlConfidence: 0,
};

/**
 * Generates a human-readable name for a factor
 */
function humanizeFactor(factorName: string): string {
  const nameMap: Record<string, string> = {
    availability: 'availability',
    proximity: 'geographic proximity',
    certification: 'certification match',
    capacity: 'available capacity',
    historicalCompletion: 'historical completion rate',
    mlCompletionProbability: 'predicted completion probability',
    mlReworkRisk: 'predicted rework risk',
    mlSatisfaction: 'predicted customer satisfaction',
  };
  
  return nameMap[factorName] || factorName.replace(/([A-Z])/g, ' $1').toLowerCase().trim();
}

/**
 * Generates a summary sentence for a vendor recommendation
 */
function generateSummary(
  rank: number,
  overallScore: number,
  confidence: number,
  degradedMode: boolean
): string {
  const scorePercent = (overallScore * 100).toFixed(0);
  const confidencePercent = (confidence * 100).toFixed(0);
  
  let summary = `Ranked #${rank} with an overall score of ${scorePercent}%`;
  
  if (degradedMode) {
    summary += ' (rule-based scoring only)';
  } else if (confidence >= 0.8) {
    summary += ` with high confidence (${confidencePercent}%)`;
  } else if (confidence < 0.5) {
    summary += ` with limited confidence (${confidencePercent}%)`;
  }
  
  return summary + '.';
}

/**
 * Generates narrative for top contributing factors
 */
function generateTopFactorsNarrative(topContributors: AnalyzedFactor[]): string {
  if (topContributors.length === 0) {
    return 'No significant contributing factors identified.';
  }
  
  const factorDescriptions = topContributors.map(af => {
    const name = humanizeFactor(af.factor.name);
    const value = (af.factor.value * 100).toFixed(0);
    return `${name} (${value}%)`;
  });
  
  if (factorDescriptions.length === 1) {
    return `The primary strength is ${factorDescriptions[0]}.`;
  }
  
  const lastFactor = factorDescriptions.pop();
  return `Key strengths include ${factorDescriptions.join(', ')}, and ${lastFactor}.`;
}

/**
 * Generates narrative for risk factors
 */
function generateRiskNarrative(riskFactors: RiskFactor[]): string | null {
  if (riskFactors.length === 0) {
    return null;
  }
  
  const highRisks = riskFactors.filter(rf => rf.severity === 'high');
  const mediumRisks = riskFactors.filter(rf => rf.severity === 'medium');
  const lowRisks = riskFactors.filter(rf => rf.severity === 'low');
  
  const parts: string[] = [];
  
  if (highRisks.length > 0) {
    const descriptions = highRisks.map(rf => rf.description);
    parts.push(`Critical concerns: ${descriptions.join('; ')}`);
  }
  
  if (mediumRisks.length > 0) {
    const descriptions = mediumRisks.map(rf => rf.description);
    parts.push(`Moderate concerns: ${descriptions.join('; ')}`);
  }
  
  if (lowRisks.length > 0) {
    const descriptions = lowRisks.map(rf => rf.description);
    parts.push(`Minor concerns: ${descriptions.join('; ')}`);
  }
  
  return parts.join('. ') + '.';
}

/**
 * Generates narrative for ML confidence levels
 */
function generateConfidenceNarrative(
  mlConfidence: number | null,
  degradedMode: boolean
): string | null {
  if (degradedMode) {
    return 'ML predictions are unavailable; recommendation is based on rule-based scoring only.';
  }
  
  if (mlConfidence === null) {
    return null;
  }
  
  const confidencePercent = (mlConfidence * 100).toFixed(0);
  
  if (mlConfidence >= 0.9) {
    return `ML predictions have very high confidence (${confidencePercent}%).`;
  }
  if (mlConfidence >= ML_CONFIDENCE_THRESHOLD) {
    return `ML predictions have good confidence (${confidencePercent}%).`;
  }
  if (mlConfidence >= 0.5) {
    return `ML predictions have moderate confidence (${confidencePercent}%); consider additional review.`;
  }
  return `ML predictions have low confidence (${confidencePercent}%); human review recommended.`;
}

/**
 * Generates narrative for data quality issues
 */
function generateDataQualityNarrative(issues: string[]): string | null {
  if (issues.length === 0) {
    return null;
  }
  
  if (issues.length === 1) {
    return `Note: ${issues[0]}.`;
  }
  
  return `Data quality notes: ${issues.join('; ')}.`;
}

/**
 * Combines all narrative components into a full explanation
 */
function combineNarratives(
  summary: string,
  topFactors: string,
  risk: string | null,
  confidence: string | null,
  dataQuality: string | null,
  verboseMode: boolean
): string {
  const parts = [summary, topFactors];
  
  if (risk) {
    parts.push(risk);
  }
  
  if (verboseMode) {
    if (confidence) {
      parts.push(confidence);
    }
    if (dataQuality) {
      parts.push(dataQuality);
    }
  }
  
  return parts.join(' ');
}

/**
 * Generates a complete explanation for a vendor recommendation
 *
 * @param rank - Vendor's rank in the recommendation list
 * @param overallScore - Vendor's overall score (0-1)
 * @param confidence - Confidence level of the recommendation (0-1)
 * @param breakdown - Score breakdown with all factors
 * @param degradedMode - Whether ML predictions were unavailable
 * @param options - Narrative generation options
 * @returns VendorExplanation with all narrative components
 *
 * @requirement 3.1 - Human-readable explanation
 * @requirement 3.5 - Confidence levels for ML components
 */
export function generateVendorExplanation(
  rank: number,
  overallScore: number,
  confidence: number,
  breakdown: ScoreBreakdown,
  degradedMode: boolean = false,
  options: NarrativeOptions = {}
): VendorExplanation {
  const opts = { ...DEFAULT_NARRATIVE_OPTIONS, ...options };
  
  // Analyze factors
  const analysis = analyzeFactors(breakdown, {
    topN: 3,
    mlConfidence: opts.mlConfidence,
  });
  
  // Generate individual narratives
  const summary = generateSummary(rank, overallScore, confidence, degradedMode);
  const topFactorsNarrative = generateTopFactorsNarrative(analysis.topContributors);
  const riskNarrative = generateRiskNarrative(analysis.riskFactors);
  
  const confidenceNarrative = opts.includeConfidence
    ? generateConfidenceNarrative(analysis.mlConfidence, degradedMode)
    : null;
  
  const dataQualityNarrative = opts.includeDataQuality
    ? generateDataQualityNarrative(analysis.dataQualityIssues)
    : null;
  
  // Combine into full narrative
  const fullNarrative = combineNarratives(
    summary,
    topFactorsNarrative,
    riskNarrative,
    confidenceNarrative,
    dataQualityNarrative,
    opts.verboseMode
  );
  
  return {
    summary,
    topFactorsNarrative,
    riskNarrative,
    confidenceNarrative,
    dataQualityNarrative,
    fullNarrative,
  };
}

/**
 * Generates an exclusion reason for a filtered vendor
 *
 * @param vendorId - ID of the excluded vendor
 * @param vendorName - Name of the excluded vendor
 * @param failureReasons - Array of reasons why the vendor was filtered
 * @returns ExclusionReason with categorized explanation
 *
 * @requirement 3.6 - Provide exclusion reasons for filtered vendors
 */
export function generateExclusionReason(
  vendorId: string,
  vendorName: string,
  failureReasons: string[]
): ExclusionReason {
  // Determine primary category from failure reasons
  let category: ExclusionReason['category'] = 'status';
  let primaryReason = 'Vendor did not meet eligibility criteria';
  
  for (const reason of failureReasons) {
    const lowerReason = reason.toLowerCase();
    
    if (lowerReason.includes('unavailable') || lowerReason.includes('availability')) {
      category = 'availability';
      primaryReason = 'Vendor is not available for this job';
      break;
    }
    if (lowerReason.includes('certification') || lowerReason.includes('certified')) {
      category = 'certification';
      primaryReason = 'Vendor lacks required certifications';
      break;
    }
    if (lowerReason.includes('capacity') || lowerReason.includes('full')) {
      category = 'capacity';
      primaryReason = 'Vendor has no available capacity';
      break;
    }
    if (lowerReason.includes('distance') || lowerReason.includes('geographic') || lowerReason.includes('coverage')) {
      category = 'geographic';
      primaryReason = 'Vendor is outside service area';
      break;
    }
    if (lowerReason.includes('inactive') || lowerReason.includes('suspended') || lowerReason.includes('status')) {
      category = 'status';
      primaryReason = 'Vendor is not currently active';
      break;
    }
    if (lowerReason.includes('blocked')) {
      category = 'blocked';
      primaryReason = 'Vendor is blocked by customer';
      break;
    }
  }
  
  return {
    vendorId,
    vendorName,
    reason: primaryReason,
    details: failureReasons,
    category,
  };
}

/**
 * Generates a brief rationale string suitable for API responses
 *
 * @param rank - Vendor's rank
 * @param overallScore - Overall score
 * @param topFactors - Top contributing factors
 * @param degradedMode - Whether in degraded mode
 * @returns Brief rationale string
 */
export function generateBriefRationale(
  rank: number,
  overallScore: number,
  topFactors: ScoreFactor[],
  degradedMode: boolean
): string {
  const parts: string[] = [];
  
  // Ranking statement
  parts.push(`Ranked #${rank} with overall score of ${(overallScore * 100).toFixed(1)}%.`);
  
  // Top factors
  if (topFactors.length > 0) {
    const factorDescriptions = topFactors
      .slice(0, 3)
      .map(f => `${humanizeFactor(f.name)} (${(f.value * 100).toFixed(0)}%)`);
    parts.push(`Top factors: ${factorDescriptions.join(', ')}.`);
  }
  
  // Degraded mode note
  if (degradedMode) {
    parts.push('ML predictions unavailable; score based on rules only.');
  }
  
  return parts.join(' ');
}

/**
 * Generates risk factor strings for API responses
 *
 * @param breakdown - Score breakdown to analyze
 * @param riskThreshold - Threshold below which factors are risks
 * @returns Array of risk factor descriptions
 */
export function generateRiskFactorStrings(
  breakdown: ScoreBreakdown,
  riskThreshold: number = 0.5
): string[] {
  const analysis = analyzeFactors(breakdown, { riskThreshold });
  return analysis.riskFactors.map(rf => rf.description);
}
