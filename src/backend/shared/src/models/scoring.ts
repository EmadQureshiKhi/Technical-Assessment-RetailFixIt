/**
 * Scoring Data Models and Zod Schemas
 *
 * Defines the canonical schemas for score factors, breakdowns, and recommendations
 * in the RetailFixIt vendor scoring system.
 *
 * @requirement 7.3 - Define Score_Factors schema
 * @property Property 2: Score Breakdown Completeness
 * @property Property 14: Schema Validation Enforcement
 * @tested tests/property/schema-validation.property.test.ts
 */

import { z } from 'zod';

/**
 * Individual score factor schema
 *
 * @requirement 7.3 - Score factor with value, weight, and contribution
 * @property Property 2: weights must sum to 1.0, contribution = value × weight
 */
export const ScoreFactorSchema = z.object({
  name: z.string().min(1).max(100),
  value: z.number().min(0).max(1),
  weight: z.number().min(0).max(1),
  contribution: z.number().min(0).max(1),
  explanation: z.string().min(1).max(500),
});

export type ScoreFactor = z.infer<typeof ScoreFactorSchema>;

/**
 * Score breakdown schema showing rule-based and ML components
 *
 * @requirement 7.3 - Score breakdown with factor contributions
 * @property Property 2: Score Breakdown Completeness
 */
export const ScoreBreakdownSchema = z.object({
  ruleBasedScore: z.number().min(0).max(1),
  mlScore: z.number().min(0).max(1),
  factors: z.array(ScoreFactorSchema),
});

export type ScoreBreakdown = z.infer<typeof ScoreBreakdownSchema>;

/**
 * Score factors schema - all factors used in scoring
 *
 * @requirement 7.3 - Define Score_Factors schema including: completion rate,
 *                   rework rate, response time, customer satisfaction,
 *                   availability score, and proximity score
 */
export const ScoreFactorsSchema = z.object({
  // Rule-based factors
  availabilityScore: z.number().min(0).max(1),
  proximityScore: z.number().min(0).max(1),
  certificationScore: z.number().min(0).max(1),
  capacityScore: z.number().min(0).max(1),

  // Historical performance factors
  completionRate: z.number().min(0).max(1),
  reworkRate: z.number().min(0).max(1),
  avgResponseTime: z.number().min(0), // Hours
  customerSatisfaction: z.number().min(0).max(5),

  // ML-predicted factors
  predictedCompletionProb: z.number().min(0).max(1),
  predictedTimeToComplete: z.number().min(0), // Hours
  predictedReworkRisk: z.number().min(0).max(1),
  predictedSatisfaction: z.number().min(0).max(5),

  // Confidence indicators
  dataQualityScore: z.number().min(0).max(1),
  predictionConfidence: z.number().min(0).max(1),
});

export type ScoreFactors = z.infer<typeof ScoreFactorsSchema>;

/**
 * Vendor recommendation schema
 *
 * @requirement 1.2 - Return top 3-5 vendors ranked by overall score
 * @requirement 1.4 - Include score breakdown
 * @requirement 3.1 - Include human-readable rationale
 */
export const VendorRecommendationSchema = z.object({
  rank: z.number().int().min(1).max(10),
  vendorId: z.string().uuid(),
  vendorName: z.string().min(1).max(200),
  overallScore: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  scoreBreakdown: ScoreBreakdownSchema,
  rationale: z.string().min(1).max(2000),
  riskFactors: z.array(z.string().min(1).max(500)),
  estimatedResponseTime: z.string().min(1).max(50),
});

export type VendorRecommendation = z.infer<typeof VendorRecommendationSchema>;

/**
 * Recommendation response schema
 *
 * @requirement 1.1 - Process job data and vendor attributes to generate ranked vendor list
 * @requirement 8.3 - Include model version used
 */
export const RecommendationResponseSchema = z.object({
  requestId: z.string().uuid(),
  jobId: z.string().uuid(),
  recommendations: z.array(VendorRecommendationSchema).min(0).max(5),
  generatedAt: z.coerce.date(),
  modelVersion: z.string().min(1).max(50),
  overallConfidence: z.number().min(0).max(1),
  automationLevel: z.enum(['auto', 'advisory', 'manual']),
  degradedMode: z.boolean().default(false),
  processingTimeMs: z.number().int().min(0),
});

export type RecommendationResponse = z.infer<typeof RecommendationResponseSchema>;

/**
 * Recommendation request schema
 *
 * @requirement 7.4 - RESTful API input validation
 */
export const RecommendationRequestSchema = z.object({
  jobId: z.string().uuid(),
  jobType: z.enum(['repair', 'installation', 'maintenance', 'inspection']),
  location: z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    address: z.string().min(1).max(200),
    city: z.string().min(1).max(100),
    state: z.string().min(2).max(2),
    zipCode: z.string().regex(/^\d{5}(-\d{4})?$/),
    serviceRegion: z.string().min(1).max(50),
  }),
  urgencyLevel: z.enum(['low', 'medium', 'high', 'critical']),
  slaDeadline: z.coerce.date(),
  requiredCertifications: z.array(z.string()),
  customerTier: z.enum(['standard', 'premium', 'enterprise']),
  specialRequirements: z.array(z.string()).optional(),
});

export type RecommendationRequest = z.infer<typeof RecommendationRequestSchema>;

/**
 * Scoring weights configuration schema
 *
 * @requirement 2.4 - Configurable weights between rule-based and ML-based components
 */
export const ScoringWeightsSchema = z
  .object({
    ruleWeight: z.number().min(0).max(1),
    mlWeight: z.number().min(0).max(1),
    contextWeight: z.number().min(0).max(1),
  })
  .refine((data) => Math.abs(data.ruleWeight + data.mlWeight + data.contextWeight - 1) < 0.001, {
    message: 'Weights must sum to 1.0',
  });

export type ScoringWeights = z.infer<typeof ScoringWeightsSchema>;

/**
 * Default scoring weights
 */
export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  ruleWeight: 0.4,
  mlWeight: 0.5,
  contextWeight: 0.1,
};

/**
 * Rule-based factor weights
 */
export const RULE_FACTOR_WEIGHTS = {
  availability: 0.25,
  proximity: 0.2,
  certification: 0.2,
  capacity: 0.15,
  historicalCompletion: 0.2,
} as const;

/**
 * Validates a recommendation request against the schema
 *
 * @requirement 7.5 - Validate all input data against defined schemas
 * @requirement 7.6 - Return descriptive error messages with field-level details
 */
export function validateRecommendationRequest(data: unknown): RecommendationRequest {
  return RecommendationRequestSchema.parse(data);
}

/**
 * Safely validates a recommendation request
 *
 * @requirement 7.6 - Return descriptive error messages with field-level details
 */
export function safeValidateRecommendationRequest(
  data: unknown
): z.SafeParseReturnType<unknown, RecommendationRequest> {
  return RecommendationRequestSchema.safeParse(data);
}

/**
 * Validates score factors
 *
 * @requirement 7.5 - Validate all input data against defined schemas
 */
export function validateScoreFactors(data: unknown): ScoreFactors {
  return ScoreFactorsSchema.parse(data);
}

/**
 * Validates that score breakdown factors sum correctly
 *
 * @property Property 2: Score Breakdown Completeness
 * @param breakdown - Score breakdown to validate
 * @returns true if valid, throws error if invalid
 */
export function validateScoreBreakdownCompleteness(breakdown: ScoreBreakdown): boolean {
  const totalWeight = breakdown.factors.reduce((sum, f) => sum + f.weight, 0);

  if (Math.abs(totalWeight - 1.0) > 0.001) {
    throw new Error(`Factor weights must sum to 1.0, got ${totalWeight}`);
  }

  for (const factor of breakdown.factors) {
    const expectedContribution = factor.value * factor.weight;
    if (Math.abs(factor.contribution - expectedContribution) > 0.001) {
      throw new Error(
        `Factor ${factor.name} contribution mismatch: expected ${expectedContribution}, got ${factor.contribution}`
      );
    }
  }

  return true;
}
