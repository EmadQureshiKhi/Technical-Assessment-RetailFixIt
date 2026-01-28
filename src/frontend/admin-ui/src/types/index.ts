/**
 * Admin UI Type Definitions
 *
 * Shared types for the RetailFixIt Admin UI frontend.
 * These types mirror the backend API contracts.
 *
 * @requirement 5.1 - Admin UI for operator interaction
 * @requirement 7.4 - RESTful API contracts
 */

// Job types
export type JobType = 'repair' | 'installation' | 'maintenance' | 'inspection';
export type UrgencyLevel = 'low' | 'medium' | 'high' | 'critical';
export type JobStatus = 'pending' | 'assigned' | 'in_progress' | 'completed' | 'cancelled';
export type CustomerTier = 'standard' | 'premium' | 'enterprise';
export type AutomationLevel = 'auto' | 'advisory' | 'manual';
export type OverrideCategory = 'preference' | 'availability' | 'relationship' | 'other';

/**
 * Geographic location
 */
export interface GeoLocation {
  latitude: number;
  longitude: number;
  address: string;
  city: string;
  state: string;
  zipCode: string;
  serviceRegion: string;
}

/**
 * Customer details
 */
export interface CustomerDetails {
  customerId: string;
  tier: CustomerTier;
  preferredVendors?: string[];
  blockedVendors?: string[];
}

/**
 * Job event representing a service request
 * @requirement 5.1 - Display pending jobs
 */
export interface Job {
  jobId: string;
  jobType: JobType;
  location: GeoLocation;
  urgencyLevel: UrgencyLevel;
  slaDeadline: string;
  requiredCertifications: string[];
  customerDetails: CustomerDetails;
  specialRequirements: string[];
  createdAt: string;
  status: JobStatus;
  recommendationStatus?: 'pending' | 'generated' | 'accepted' | 'overridden';
}

/**
 * Score factor breakdown
 * @requirement 5.2 - Display scores
 */
export interface ScoreFactor {
  name: string;
  value: number;
  weight: number;
  contribution: number;
  explanation: string;
}

/**
 * Score breakdown showing rule-based and ML components
 */
export interface ScoreBreakdown {
  ruleBasedScore: number;
  mlScore: number;
  factors: ScoreFactor[];
}

/**
 * ML Model Predictions from trained GradientBoosting models
 * @requirement 8.1 - ML model integration
 */
export interface MLPredictions {
  completionProbability: number;
  estimatedTimeHours: number;
  reworkProbability: number;
}

/**
 * ML Model Info with accuracy metrics
 * @requirement 8.1 - ML model integration
 */
export interface MLModelInfo {
  version: string;
  completionModel: { accuracy: number; f1Score: number };
  timeModel: { r2Score: number; mae: number };
  reworkModel: { accuracy: number; f1Score: number };
  trainedAt: string;
  algorithm: string;
}

/**
 * Vendor recommendation
 * @requirement 5.2 - Display recommended vendors and rationale
 */
export interface VendorRecommendation {
  rank: number;
  vendorId: string;
  vendorName: string;
  overallScore: number;
  confidence: number;
  scoreBreakdown: ScoreBreakdown;
  mlPredictions?: MLPredictions;
  rationale: string;
  riskFactors: string[];
  estimatedResponseTime: string;
}

/**
 * Recommendation response from API
 * @requirement 5.5 - Display confidence indicators
 */
export interface RecommendationResponse {
  requestId: string;
  jobId: string;
  recommendations: VendorRecommendation[];
  generatedAt: string;
  modelVersion: string;
  overallConfidence: number;
  automationLevel: AutomationLevel;
  degradedMode: boolean;
  processingTimeMs: number;
  mlModelInfo?: MLModelInfo;
}

/**
 * Override request payload
 * @requirement 5.3 - Allow vendor override
 * @requirement 5.4 - Require override reason
 */
export interface OverrideRequest {
  jobId: string;
  originalVendorId: string;
  originalVendorName?: string;
  selectedVendorId: string;
  selectedVendorName?: string;
  overrideReason: string;
  overrideCategory: OverrideCategory;
}

/**
 * Override response from API
 */
export interface OverrideResponse {
  overrideId: string;
  jobId: string;
  originalVendorId: string;
  selectedVendorId: string;
  operatorId: string;
  overrideReason: string;
  overrideCategory: string;
  recordedAt: string;
  correlationId: string;
}

/**
 * API error response
 */
export interface ApiError {
  error: string;
  message: string;
  correlationId?: string;
  details?: Array<{ field: string; message: string; code: string }>;
}

/**
 * Filter options for job list
 * @requirement 5.6 - Filtering and sorting capabilities
 */
export interface JobFilters {
  status?: JobStatus;
  urgencyLevel?: UrgencyLevel;
  jobType?: JobType;
  recommendationStatus?: 'pending' | 'generated' | 'accepted' | 'overridden';
  searchQuery?: string;
}

/**
 * Sort options for job list
 * @requirement 5.6 - Filtering and sorting capabilities
 */
export interface JobSortOptions {
  field: 'createdAt' | 'slaDeadline' | 'urgencyLevel' | 'status';
  direction: 'asc' | 'desc';
}
