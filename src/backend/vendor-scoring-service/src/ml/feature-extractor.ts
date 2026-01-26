/**
 * Feature Extractor for ML Model
 *
 * Extracts and normalizes features from job and vendor data
 * for input to the ML scoring model.
 *
 * @requirement 2.2 - ML-based scoring for completion probability, time-to-complete, rework risk
 * @requirement 2.5 - Handle insufficient training data with explicit confidence indicators
 */

import type { JobEvent, VendorProfile, VendorMetricsSummary } from '@retailfixit/shared';

/**
 * Extracted features for ML model input
 */
export interface MLFeatures {
  // Job features
  jobTypeEncoded: number;
  urgencyLevelEncoded: number;
  customerTierEncoded: number;
  requiredCertCount: number;
  specialRequirementCount: number;
  hoursUntilSla: number;

  // Vendor features
  vendorCapacityUtilization: number;
  vendorCertCount: number;
  vendorSpecializationCount: number;
  vendorServiceAreaCount: number;

  // Historical performance features
  historicalCompletionRate: number;
  historicalReworkRate: number;
  historicalAvgResponseTime: number;
  historicalAvgSatisfaction: number;

  // Match features
  certificationMatchRatio: number;
  isInServiceArea: number;

  // Data quality indicators
  hasHistoricalData: number;
  dataCompleteness: number;
}

/**
 * Feature extraction result with metadata
 */
export interface FeatureExtractionResult {
  features: MLFeatures;
  normalizedFeatures: Record<string, number>;
  dataQualityScore: number;
  missingFields: string[];
}

/**
 * Default values for missing data
 */
export const DEFAULT_FEATURE_VALUES: Partial<MLFeatures> = {
  historicalCompletionRate: 0.7,
  historicalReworkRate: 0.1,
  historicalAvgResponseTime: 4.0,
  historicalAvgSatisfaction: 3.5,
  hasHistoricalData: 0,
  dataCompleteness: 0.5,
};

/**
 * Job type encoding map
 */
const JOB_TYPE_ENCODING: Record<string, number> = {
  repair: 0,
  installation: 1,
  maintenance: 2,
  inspection: 3,
};

/**
 * Urgency level encoding map
 */
const URGENCY_LEVEL_ENCODING: Record<string, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

/**
 * Customer tier encoding map
 */
const CUSTOMER_TIER_ENCODING: Record<string, number> = {
  standard: 0,
  premium: 1,
  enterprise: 2,
};


/**
 * Feature Extractor class
 *
 * Extracts features from job and vendor data for ML model input.
 * Handles missing data with sensible defaults and tracks data quality.
 *
 * @requirement 2.2 - ML-based scoring
 * @requirement 2.5 - Handle insufficient training data
 */
export class FeatureExtractor {
  /**
   * Extract features from job and vendor data
   *
   * @param job - The job event
   * @param vendor - The vendor profile
   * @param vendorMetrics - Optional historical metrics
   * @returns FeatureExtractionResult with features and quality indicators
   */
  extractFeatures(
    job: JobEvent,
    vendor: VendorProfile,
    vendorMetrics?: VendorMetricsSummary
  ): FeatureExtractionResult {
    const missingFields: string[] = [];

    // Extract job features
    const jobFeatures = this.extractJobFeatures(job);

    // Extract vendor features
    const vendorFeatures = this.extractVendorFeatures(vendor);

    // Extract historical performance features
    const historicalFeatures = this.extractHistoricalFeatures(vendorMetrics, missingFields);

    // Extract match features
    const matchFeatures = this.extractMatchFeatures(job, vendor);

    // Calculate data quality score
    const dataQualityScore = this.calculateDataQualityScore(
      vendorMetrics,
      missingFields.length
    );

    // Combine all features
    const features: MLFeatures = {
      ...jobFeatures,
      ...vendorFeatures,
      ...historicalFeatures,
      ...matchFeatures,
      hasHistoricalData: vendorMetrics ? 1 : 0,
      dataCompleteness: dataQualityScore,
    };

    // Normalize features for model input
    const normalizedFeatures = this.normalizeFeatures(features);

    return {
      features,
      normalizedFeatures,
      dataQualityScore,
      missingFields,
    };
  }

  /**
   * Extract job-related features
   */
  private extractJobFeatures(job: JobEvent): Pick<
    MLFeatures,
    | 'jobTypeEncoded'
    | 'urgencyLevelEncoded'
    | 'customerTierEncoded'
    | 'requiredCertCount'
    | 'specialRequirementCount'
    | 'hoursUntilSla'
  > {
    const hoursUntilSla = this.calculateHoursUntilSla(job.slaDeadline);

    return {
      jobTypeEncoded: JOB_TYPE_ENCODING[job.jobType] ?? 0,
      urgencyLevelEncoded: URGENCY_LEVEL_ENCODING[job.urgencyLevel] ?? 0,
      customerTierEncoded: CUSTOMER_TIER_ENCODING[job.customerDetails.tier] ?? 0,
      requiredCertCount: job.requiredCertifications.length,
      specialRequirementCount: job.specialRequirements?.length ?? 0,
      hoursUntilSla: Math.max(0, hoursUntilSla),
    };
  }

  /**
   * Extract vendor-related features
   */
  private extractVendorFeatures(vendor: VendorProfile): Pick<
    MLFeatures,
    | 'vendorCapacityUtilization'
    | 'vendorCertCount'
    | 'vendorSpecializationCount'
    | 'vendorServiceAreaCount'
  > {
    const capacityUtilization =
      vendor.maxCapacity > 0
        ? vendor.currentCapacity / vendor.maxCapacity
        : 1;

    return {
      vendorCapacityUtilization: Math.min(1, capacityUtilization),
      vendorCertCount: vendor.certifications.length,
      vendorSpecializationCount: vendor.specializations.length,
      vendorServiceAreaCount: vendor.geographicCoverage.length,
    };
  }

  /**
   * Extract historical performance features with defaults for missing data
   *
   * @requirement 2.5 - Handle insufficient training data with defaults
   */
  private extractHistoricalFeatures(
    vendorMetrics?: VendorMetricsSummary,
    missingFields?: string[]
  ): Pick<
    MLFeatures,
    | 'historicalCompletionRate'
    | 'historicalReworkRate'
    | 'historicalAvgResponseTime'
    | 'historicalAvgSatisfaction'
  > {
    if (!vendorMetrics) {
      missingFields?.push('vendorMetrics');
      return {
        historicalCompletionRate: DEFAULT_FEATURE_VALUES.historicalCompletionRate!,
        historicalReworkRate: DEFAULT_FEATURE_VALUES.historicalReworkRate!,
        historicalAvgResponseTime: DEFAULT_FEATURE_VALUES.historicalAvgResponseTime!,
        historicalAvgSatisfaction: DEFAULT_FEATURE_VALUES.historicalAvgSatisfaction!,
      };
    }

    return {
      historicalCompletionRate: vendorMetrics.completionRate,
      historicalReworkRate: vendorMetrics.reworkRate,
      historicalAvgResponseTime: vendorMetrics.avgResponseTimeHours,
      historicalAvgSatisfaction: vendorMetrics.avgCustomerSatisfaction,
    };
  }

  /**
   * Extract match features between job and vendor
   */
  private extractMatchFeatures(
    job: JobEvent,
    vendor: VendorProfile
  ): Pick<MLFeatures, 'certificationMatchRatio' | 'isInServiceArea'> {
    // Calculate certification match ratio
    const certificationMatchRatio = this.calculateCertificationMatchRatio(
      job.requiredCertifications,
      vendor.certifications
    );

    // Check if vendor serves the job's service region
    const isInServiceArea = this.checkServiceAreaMatch(
      job.location.zipCode,
      job.location.serviceRegion,
      vendor.geographicCoverage
    );

    return {
      certificationMatchRatio,
      isInServiceArea: isInServiceArea ? 1 : 0,
    };
  }

  /**
   * Calculate certification match ratio
   */
  private calculateCertificationMatchRatio(
    requiredCerts: string[],
    vendorCerts: VendorProfile['certifications']
  ): number {
    if (requiredCerts.length === 0) {
      return 1.0; // No requirements means full match
    }

    const now = new Date();
    const validVendorCertNames = vendorCerts
      .filter((cert) => cert.verified && new Date(cert.validUntil) > now)
      .map((cert) => cert.name.toLowerCase());

    const matchedCount = requiredCerts.filter((required) =>
      validVendorCertNames.includes(required.toLowerCase())
    ).length;

    return matchedCount / requiredCerts.length;
  }

  /**
   * Check if vendor serves the job's location
   */
  private checkServiceAreaMatch(
    jobZipCode: string,
    jobServiceRegion: string,
    vendorCoverage: VendorProfile['geographicCoverage']
  ): boolean {
    for (const area of vendorCoverage) {
      // Check zip code match
      if (area.zipCodes.includes(jobZipCode)) {
        return true;
      }
      // Check region match
      if (area.regionName.toLowerCase() === jobServiceRegion.toLowerCase()) {
        return true;
      }
    }
    return false;
  }

  /**
   * Calculate hours until SLA deadline
   */
  private calculateHoursUntilSla(slaDeadline: Date): number {
    const now = new Date();
    const deadline = new Date(slaDeadline);
    const diffMs = deadline.getTime() - now.getTime();
    return diffMs / (1000 * 60 * 60); // Convert to hours
  }

  /**
   * Calculate data quality score based on available data
   *
   * @requirement 2.5 - Explicit confidence indicators
   */
  private calculateDataQualityScore(
    vendorMetrics?: VendorMetricsSummary,
    missingFieldCount: number = 0
  ): number {
    let score = 1.0;

    // Reduce score for missing historical data
    if (!vendorMetrics) {
      score -= 0.3;
    } else {
      // Check for sufficient sample size
      if (vendorMetrics.totalJobs < 10) {
        score -= 0.2;
      } else if (vendorMetrics.totalJobs < 50) {
        score -= 0.1;
      }
    }

    // Reduce score for each missing field
    score -= missingFieldCount * 0.05;

    return Math.max(0, Math.min(1, score));
  }

  /**
   * Normalize features for model input
   *
   * Applies min-max normalization to bring all features to 0-1 range
   */
  private normalizeFeatures(features: MLFeatures): Record<string, number> {
    return {
      // Job features (already encoded or bounded)
      jobType: features.jobTypeEncoded / 3, // 0-3 -> 0-1
      urgencyLevel: features.urgencyLevelEncoded / 3, // 0-3 -> 0-1
      customerTier: features.customerTierEncoded / 2, // 0-2 -> 0-1
      requiredCertCount: Math.min(1, features.requiredCertCount / 5), // Cap at 5
      specialRequirementCount: Math.min(1, features.specialRequirementCount / 5),
      hoursUntilSla: Math.min(1, features.hoursUntilSla / 72), // Normalize to 72 hours

      // Vendor features
      capacityUtilization: features.vendorCapacityUtilization,
      certCount: Math.min(1, features.vendorCertCount / 10), // Cap at 10
      specializationCount: Math.min(1, features.vendorSpecializationCount / 5),
      serviceAreaCount: Math.min(1, features.vendorServiceAreaCount / 10),

      // Historical features (already 0-1 or normalized)
      completionRate: features.historicalCompletionRate,
      reworkRate: features.historicalReworkRate,
      avgResponseTime: Math.min(1, features.historicalAvgResponseTime / 24), // Normalize to 24 hours
      avgSatisfaction: features.historicalAvgSatisfaction / 5, // 0-5 -> 0-1

      // Match features
      certificationMatch: features.certificationMatchRatio,
      inServiceArea: features.isInServiceArea,

      // Data quality
      hasHistory: features.hasHistoricalData,
      dataCompleteness: features.dataCompleteness,
    };
  }
}

/**
 * Singleton feature extractor instance
 */
let featureExtractorInstance: FeatureExtractor | null = null;

/**
 * Get or create feature extractor instance
 */
export function getFeatureExtractor(): FeatureExtractor {
  if (!featureExtractorInstance) {
    featureExtractorInstance = new FeatureExtractor();
  }
  return featureExtractorInstance;
}

/**
 * Extract features using singleton instance
 */
export function extractFeatures(
  job: JobEvent,
  vendor: VendorProfile,
  vendorMetrics?: VendorMetricsSummary
): FeatureExtractionResult {
  return getFeatureExtractor().extractFeatures(job, vendor, vendorMetrics);
}
