/**
 * Comparison Engine
 *
 * Generates comparative explanations between ranked vendors,
 * highlighting differentiating factors that explain ranking differences.
 *
 * @requirement 3.4 - Explain why higher-ranked vendors scored better than lower-ranked ones
 */

import type { ScoreBreakdown, ScoreFactor, VendorRecommendation } from '@retailfixit/shared';

/**
 * Difference between two vendors on a specific factor
 */
export interface FactorDifference {
  factorName: string;
  higherRankedValue: number;
  lowerRankedValue: number;
  difference: number;
  percentageDifference: number;
  favorsBetter: boolean;
  explanation: string;
}

/**
 * Comparison result between two vendors
 */
export interface VendorComparison {
  higherRankedVendor: {
    vendorId: string;
    vendorName: string;
    rank: number;
    overallScore: number;
  };
  lowerRankedVendor: {
    vendorId: string;
    vendorName: string;
    rank: number;
    overallScore: number;
  };
  scoreDifference: number;
  keyDifferentiators: FactorDifference[];
  comparisonNarrative: string;
}

/**
 * Full comparison analysis for a set of recommendations
 */
export interface ComparisonAnalysis {
  comparisons: VendorComparison[];
  topVendorAdvantages: string[];
  overallNarrative: string;
}

/**
 * Threshold for considering a factor difference significant
 */
export const SIGNIFICANT_DIFFERENCE_THRESHOLD = 0.1;

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
    mlReworkRisk: 'rework risk profile',
    mlSatisfaction: 'predicted satisfaction',
  };
  
  return nameMap[factorName] || factorName.replace(/([A-Z])/g, ' $1').toLowerCase().trim();
}

/**
 * Generates explanation for a factor difference
 */
function generateDifferenceExplanation(
  factorName: string,
  higherValue: number,
  lowerValue: number,
  favorsBetter: boolean
): string {
  const humanName = humanizeFactor(factorName);
  const higherPercent = (higherValue * 100).toFixed(0);
  const lowerPercent = (lowerValue * 100).toFixed(0);
  
  if (favorsBetter) {
    return `Higher-ranked vendor has better ${humanName} (${higherPercent}% vs ${lowerPercent}%)`;
  } else {
    return `Lower-ranked vendor has better ${humanName} (${lowerPercent}% vs ${higherPercent}%), but other factors outweigh this`;
  }
}

/**
 * Compares factors between two score breakdowns
 */
function compareFactors(
  higherBreakdown: ScoreBreakdown,
  lowerBreakdown: ScoreBreakdown
): FactorDifference[] {
  const differences: FactorDifference[] = [];
  
  // Create a map of lower-ranked vendor's factors
  const lowerFactorMap = new Map<string, ScoreFactor>();
  for (const factor of lowerBreakdown.factors) {
    lowerFactorMap.set(factor.name, factor);
  }
  
  // Compare each factor from higher-ranked vendor
  for (const higherFactor of higherBreakdown.factors) {
    const lowerFactor = lowerFactorMap.get(higherFactor.name);
    
    if (!lowerFactor) {
      // Factor only exists in higher-ranked vendor
      differences.push({
        factorName: higherFactor.name,
        higherRankedValue: higherFactor.value,
        lowerRankedValue: 0,
        difference: higherFactor.value,
        percentageDifference: 100,
        favorsBetter: true,
        explanation: `${humanizeFactor(higherFactor.name)} data available only for higher-ranked vendor`,
      });
      continue;
    }
    
    const diff = higherFactor.value - lowerFactor.value;
    const absDiff = Math.abs(diff);
    
    // Only include significant differences
    if (absDiff >= SIGNIFICANT_DIFFERENCE_THRESHOLD) {
      const percentDiff = lowerFactor.value > 0 
        ? (diff / lowerFactor.value) * 100 
        : diff * 100;
      
      differences.push({
        factorName: higherFactor.name,
        higherRankedValue: higherFactor.value,
        lowerRankedValue: lowerFactor.value,
        difference: diff,
        percentageDifference: percentDiff,
        favorsBetter: diff > 0,
        explanation: generateDifferenceExplanation(
          higherFactor.name,
          higherFactor.value,
          lowerFactor.value,
          diff > 0
        ),
      });
    }
    
    // Remove from map to track processed factors
    lowerFactorMap.delete(higherFactor.name);
  }
  
  // Check for factors only in lower-ranked vendor
  for (const [name, lowerFactor] of lowerFactorMap) {
    differences.push({
      factorName: name,
      higherRankedValue: 0,
      lowerRankedValue: lowerFactor.value,
      difference: -lowerFactor.value,
      percentageDifference: -100,
      favorsBetter: false,
      explanation: `${humanizeFactor(name)} data available only for lower-ranked vendor`,
    });
  }
  
  // Sort by absolute difference (most significant first)
  return differences.sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference));
}

/**
 * Generates a narrative comparing two vendors
 */
function generateComparisonNarrative(
  higherName: string,
  lowerName: string,
  scoreDiff: number,
  keyDifferentiators: FactorDifference[]
): string {
  const parts: string[] = [];
  
  // Score difference statement
  const scoreDiffPercent = (scoreDiff * 100).toFixed(1);
  parts.push(`${higherName} ranks higher than ${lowerName} by ${scoreDiffPercent} percentage points.`);
  
  // Key differentiators
  const advantages = keyDifferentiators.filter(d => d.favorsBetter);
  if (advantages.length > 0) {
    const advantageNames = advantages.slice(0, 3).map(d => humanizeFactor(d.factorName));
    if (advantageNames.length === 1) {
      parts.push(`The primary advantage is ${advantageNames[0]}.`);
    } else {
      const last = advantageNames.pop();
      parts.push(`Key advantages include ${advantageNames.join(', ')}, and ${last}.`);
    }
  }
  
  // Note any areas where lower-ranked vendor is better
  const disadvantages = keyDifferentiators.filter(d => !d.favorsBetter);
  if (disadvantages.length > 0 && disadvantages.length <= 2) {
    const disadvNames = disadvantages.map(d => humanizeFactor(d.factorName));
    parts.push(`${lowerName} has better ${disadvNames.join(' and ')}, but overall score favors ${higherName}.`);
  }
  
  return parts.join(' ');
}

/**
 * Compares two vendor recommendations
 *
 * @param higher - Higher-ranked vendor recommendation
 * @param lower - Lower-ranked vendor recommendation
 * @returns VendorComparison with differentiating factors and narrative
 *
 * @requirement 3.4 - Explain why higher-ranked vendors scored better
 */
export function compareVendors(
  higher: VendorRecommendation,
  lower: VendorRecommendation
): VendorComparison {
  const keyDifferentiators = compareFactors(higher.scoreBreakdown, lower.scoreBreakdown);
  const scoreDifference = higher.overallScore - lower.overallScore;
  
  const comparisonNarrative = generateComparisonNarrative(
    higher.vendorName,
    lower.vendorName,
    scoreDifference,
    keyDifferentiators
  );
  
  return {
    higherRankedVendor: {
      vendorId: higher.vendorId,
      vendorName: higher.vendorName,
      rank: higher.rank,
      overallScore: higher.overallScore,
    },
    lowerRankedVendor: {
      vendorId: lower.vendorId,
      vendorName: lower.vendorName,
      rank: lower.rank,
      overallScore: lower.overallScore,
    },
    scoreDifference,
    keyDifferentiators,
    comparisonNarrative,
  };
}

/**
 * Generates pairwise comparisons for all adjacent vendors in a ranking
 *
 * @param recommendations - Array of vendor recommendations sorted by rank
 * @returns Array of VendorComparison for each adjacent pair
 */
export function generatePairwiseComparisons(
  recommendations: VendorRecommendation[]
): VendorComparison[] {
  if (recommendations.length < 2) {
    return [];
  }
  
  const comparisons: VendorComparison[] = [];
  
  // Sort by rank to ensure correct order
  const sorted = [...recommendations].sort((a, b) => a.rank - b.rank);
  
  // Compare each adjacent pair
  for (let i = 0; i < sorted.length - 1; i++) {
    comparisons.push(compareVendors(sorted[i], sorted[i + 1]));
  }
  
  return comparisons;
}

/**
 * Identifies the key advantages of the top-ranked vendor
 *
 * @param recommendations - Array of vendor recommendations
 * @returns Array of advantage descriptions for the top vendor
 */
function identifyTopVendorAdvantages(recommendations: VendorRecommendation[]): string[] {
  if (recommendations.length < 2) {
    return [];
  }
  
  const sorted = [...recommendations].sort((a, b) => a.rank - b.rank);
  const topVendor = sorted[0];
  const advantages: Set<string> = new Set();
  
  // Compare top vendor against all others
  for (let i = 1; i < sorted.length; i++) {
    const comparison = compareVendors(topVendor, sorted[i]);
    
    for (const diff of comparison.keyDifferentiators) {
      if (diff.favorsBetter && diff.difference >= SIGNIFICANT_DIFFERENCE_THRESHOLD) {
        advantages.add(humanizeFactor(diff.factorName));
      }
    }
  }
  
  return Array.from(advantages);
}

/**
 * Generates an overall narrative explaining the ranking
 */
function generateOverallNarrative(
  recommendations: VendorRecommendation[],
  topAdvantages: string[]
): string {
  if (recommendations.length === 0) {
    return 'No vendors available for comparison.';
  }
  
  if (recommendations.length === 1) {
    return `${recommendations[0].vendorName} is the only eligible vendor.`;
  }
  
  const sorted = [...recommendations].sort((a, b) => a.rank - b.rank);
  const topVendor = sorted[0];
  const parts: string[] = [];
  
  // Top vendor statement
  parts.push(`${topVendor.vendorName} is the top recommendation with a score of ${(topVendor.overallScore * 100).toFixed(1)}%.`);
  
  // Advantages
  if (topAdvantages.length > 0) {
    if (topAdvantages.length === 1) {
      parts.push(`The primary differentiator is ${topAdvantages[0]}.`);
    } else {
      const last = topAdvantages.pop();
      parts.push(`Key differentiators include ${topAdvantages.join(', ')}, and ${last}.`);
    }
  }
  
  // Score spread
  const lowestVendor = sorted[sorted.length - 1];
  const spread = topVendor.overallScore - lowestVendor.overallScore;
  if (spread < 0.1) {
    parts.push('Scores are closely clustered; consider reviewing all options.');
  } else if (spread > 0.3) {
    parts.push('There is significant differentiation between vendors.');
  }
  
  return parts.join(' ');
}

/**
 * Performs a complete comparison analysis for a set of recommendations
 *
 * @param recommendations - Array of vendor recommendations
 * @returns ComparisonAnalysis with all comparisons and narratives
 *
 * @requirement 3.4 - Comparative explanations between ranked vendors
 */
export function analyzeComparisons(recommendations: VendorRecommendation[]): ComparisonAnalysis {
  const comparisons = generatePairwiseComparisons(recommendations);
  const topAdvantages = identifyTopVendorAdvantages(recommendations);
  const overallNarrative = generateOverallNarrative(recommendations, [...topAdvantages]);
  
  return {
    comparisons,
    topVendorAdvantages: topAdvantages,
    overallNarrative,
  };
}

/**
 * Generates a brief comparison string between two vendors
 *
 * @param higher - Higher-ranked vendor
 * @param lower - Lower-ranked vendor
 * @returns Brief comparison string
 */
export function generateBriefComparison(
  higher: VendorRecommendation,
  lower: VendorRecommendation
): string {
  const comparison = compareVendors(higher, lower);
  const topDiff = comparison.keyDifferentiators[0];
  
  if (!topDiff) {
    return `${higher.vendorName} edges out ${lower.vendorName} by ${(comparison.scoreDifference * 100).toFixed(1)}%.`;
  }
  
  return `${higher.vendorName} outperforms ${lower.vendorName} primarily due to better ${humanizeFactor(topDiff.factorName)}.`;
}

/**
 * Gets the most significant differentiating factor between two vendors
 *
 * @param higher - Higher-ranked vendor
 * @param lower - Lower-ranked vendor
 * @returns The most significant factor difference, or null if none
 */
export function getMostSignificantDifference(
  higher: VendorRecommendation,
  lower: VendorRecommendation
): FactorDifference | null {
  const comparison = compareVendors(higher, lower);
  return comparison.keyDifferentiators[0] || null;
}
