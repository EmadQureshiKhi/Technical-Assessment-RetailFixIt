/**
 * Recommendation API Endpoint
 *
 * POST /api/v1/recommendations endpoint for generating vendor recommendations.
 * Validates input with Zod and returns ranked vendors with explanations.
 *
 * @requirement 7.4 - RESTful APIs with OpenAPI/Swagger documentation
 * @requirement 7.5 - Validate all input data against defined schemas
 * @requirement 7.6 - Return descriptive error messages with field-level details
 * @property Property 14: Schema Validation Enforcement
 * @tested tests/property/schema-validation.property.test.ts
 */

import { Router, Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import {
  RecommendationRequestSchema,
  RecommendationResponse,
  VendorRecommendation,
  type RecommendationRequest,
} from '@retailfixit/shared';
import { ZodError } from 'zod';

/**
 * Express router for recommendation endpoints
 */
export const recommendationsRouter = Router();

/**
 * Request context interface for tracking correlation IDs
 */
export interface RequestContext {
  correlationId: string;
  requestId: string;
  startTime: number;
}

/**
 * Extended request with context
 */
export interface ContextualRequest extends Request {
  context?: RequestContext;
}

/**
 * Middleware to add request context with correlation ID
 *
 * @requirement 4.6 - Correlation ID for end-to-end tracing
 * @property Property 9: Correlation ID Propagation
 */
export function addRequestContext(req: ContextualRequest, _res: Response, next: NextFunction): void {
  req.context = {
    correlationId: (req.headers['x-correlation-id'] as string) || uuidv4(),
    requestId: uuidv4(),
    startTime: Date.now(),
  };
  next();
}

/**
 * Formats Zod validation errors into field-level error details
 *
 * @requirement 7.6 - Return descriptive error messages with field-level details
 */
export function formatValidationErrors(error: ZodError): Array<{ field: string; message: string; code: string }> {
  return error.issues.map((issue) => ({
    field: issue.path.join('.'),
    message: issue.message,
    code: issue.code,
  }));
}

/**
 * API Error response format
 */
export interface ApiErrorResponse {
  error: string;
  message: string;
  correlationId?: string;
  details?: Array<{ field: string; message: string; code: string }>;
  retryAfter?: number;
}

/**
 * Creates a standardized error response
 */
export function createErrorResponse(
  error: string,
  message: string,
  correlationId?: string,
  details?: Array<{ field: string; message: string; code: string }>
): ApiErrorResponse {
  return {
    error,
    message,
    correlationId,
    details,
  };
}

/**
 * Mock vendor data for demonstration (in production, this would come from database)
 * This is a placeholder until database integration is implemented
 */
const mockVendors: VendorRecommendation[] = [
  {
    rank: 1,
    vendorId: '550e8400-e29b-41d4-a716-446655440001',
    vendorName: 'Premier Repair Services',
    overallScore: 0.92,
    confidence: 0.88,
    scoreBreakdown: {
      ruleBasedScore: 0.9,
      mlScore: 0.94,
      factors: [
        { name: 'availability', value: 0.95, weight: 0.25, contribution: 0.2375, explanation: 'Vendor is currently available' },
        { name: 'proximity', value: 0.88, weight: 0.2, contribution: 0.176, explanation: '5 miles from job location' },
        { name: 'certification', value: 1.0, weight: 0.2, contribution: 0.2, explanation: 'All required certifications met' },
        { name: 'capacity', value: 0.8, weight: 0.15, contribution: 0.12, explanation: '80% capacity available' },
        { name: 'historicalCompletion', value: 0.93, weight: 0.2, contribution: 0.186, explanation: '93% completion rate' },
      ],
    },
    rationale: 'Ranked #1 with overall score of 92.0%. Top factors: certification (100%), availability (95%), historicalCompletion (93%). High confidence recommendation.',
    riskFactors: [],
    estimatedResponseTime: '1-2 hours',
  },
  {
    rank: 2,
    vendorId: '550e8400-e29b-41d4-a716-446655440002',
    vendorName: 'QuickFix Solutions',
    overallScore: 0.85,
    confidence: 0.82,
    scoreBreakdown: {
      ruleBasedScore: 0.83,
      mlScore: 0.87,
      factors: [
        { name: 'availability', value: 0.9, weight: 0.25, contribution: 0.225, explanation: 'Vendor is currently available' },
        { name: 'proximity', value: 0.75, weight: 0.2, contribution: 0.15, explanation: '12 miles from job location' },
        { name: 'certification', value: 1.0, weight: 0.2, contribution: 0.2, explanation: 'All required certifications met' },
        { name: 'capacity', value: 0.7, weight: 0.15, contribution: 0.105, explanation: '70% capacity available' },
        { name: 'historicalCompletion', value: 0.88, weight: 0.2, contribution: 0.176, explanation: '88% completion rate' },
      ],
    },
    rationale: 'Ranked #2 with overall score of 85.0%. Top factors: certification (100%), availability (90%), historicalCompletion (88%).',
    riskFactors: ['Distance may affect response time'],
    estimatedResponseTime: '2-4 hours',
  },
  {
    rank: 3,
    vendorId: '550e8400-e29b-41d4-a716-446655440003',
    vendorName: 'Reliable Maintenance Co',
    overallScore: 0.78,
    confidence: 0.75,
    scoreBreakdown: {
      ruleBasedScore: 0.76,
      mlScore: 0.8,
      factors: [
        { name: 'availability', value: 0.85, weight: 0.25, contribution: 0.2125, explanation: 'Vendor is currently available' },
        { name: 'proximity', value: 0.65, weight: 0.2, contribution: 0.13, explanation: '18 miles from job location' },
        { name: 'certification', value: 0.9, weight: 0.2, contribution: 0.18, explanation: 'Most required certifications met' },
        { name: 'capacity', value: 0.75, weight: 0.15, contribution: 0.1125, explanation: '75% capacity available' },
        { name: 'historicalCompletion', value: 0.82, weight: 0.2, contribution: 0.164, explanation: '82% completion rate' },
      ],
    },
    rationale: 'Ranked #3 with overall score of 78.0%. Top factors: certification (90%), availability (85%), historicalCompletion (82%).',
    riskFactors: ['Distance may affect response time', 'Missing some required certifications'],
    estimatedResponseTime: '2-4 hours',
  },
];

/**
 * POST /api/v1/recommendations
 *
 * Generates vendor recommendations for a job request.
 *
 * @requirement 7.4 - RESTful API endpoint
 * @requirement 7.5 - Input validation with Zod
 * @requirement 1.1 - Generate ranked vendor list
 * @requirement 1.2 - Return top 3-5 vendors
 */
recommendationsRouter.post(
  '/',
  addRequestContext,
  async (req: ContextualRequest, res: Response): Promise<void> => {
    const context = req.context!;
    const startTime = context.startTime;

    try {
      // Validate request body against schema
      // @requirement 7.5 - Validate all input data against defined schemas
      const validationResult = RecommendationRequestSchema.safeParse(req.body);

      if (!validationResult.success) {
        // @requirement 7.6 - Return descriptive error messages with field-level details
        const errorDetails = formatValidationErrors(validationResult.error);
        res.status(400).json(
          createErrorResponse(
            'ValidationError',
            'Request validation failed',
            context.correlationId,
            errorDetails
          )
        );
        return;
      }

      const request: RecommendationRequest = validationResult.data;

      // Calculate processing time
      const processingTimeMs = Date.now() - startTime;

      // Build response
      // In production, this would call the actual scoring service
      const response: RecommendationResponse = {
        requestId: context.requestId,
        jobId: request.jobId,
        recommendations: mockVendors,
        generatedAt: new Date(),
        modelVersion: 'v1.0.0-hybrid',
        overallConfidence: 0.85,
        automationLevel: 'advisory',
        degradedMode: false,
        processingTimeMs,
      };

      // Set correlation ID in response header
      res.setHeader('X-Correlation-ID', context.correlationId);
      res.setHeader('X-Request-ID', context.requestId);

      res.status(200).json(response);
    } catch (error) {
      // Handle unexpected errors
      const processingTimeMs = Date.now() - startTime;
      console.error('Recommendation error:', error, {
        correlationId: context.correlationId,
        processingTimeMs,
      });

      res.status(500).json(
        createErrorResponse(
          'InternalError',
          'An unexpected error occurred while processing the recommendation request',
          context.correlationId
        )
      );
    }
  }
);

/**
 * GET /api/v1/recommendations/:jobId
 *
 * Retrieves existing recommendations for a job.
 */
recommendationsRouter.get(
  '/:jobId',
  addRequestContext,
  async (req: ContextualRequest, res: Response): Promise<void> => {
    const context = req.context!;
    const { jobId } = req.params;

    // Validate jobId is a UUID
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(jobId)) {
      res.status(400).json(
        createErrorResponse(
          'ValidationError',
          'Invalid jobId format. Must be a valid UUID.',
          context.correlationId,
          [{ field: 'jobId', message: 'Must be a valid UUID', code: 'invalid_string' }]
        )
      );
      return;
    }

    // In production, this would fetch from database
    // For now, return a mock response or 404
    res.status(404).json(
      createErrorResponse(
        'NotFound',
        `Recommendations for job ${jobId} not found`,
        context.correlationId
      )
    );
  }
);

export default recommendationsRouter;
