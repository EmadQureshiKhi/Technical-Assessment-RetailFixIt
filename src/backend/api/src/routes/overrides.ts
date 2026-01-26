/**
 * Override API Endpoint
 *
 * POST /api/v1/overrides endpoint for recording vendor overrides.
 * Validates override reason is provided and logs to audit trail.
 *
 * @requirement 5.4 - Override requires reason
 * @requirement 6.4 - Log override to audit trail
 * @property Property 10: Override Requires Reason
 * @property Property 13: Override Audit Completeness
 * @tested tests/property/override-validation.property.test.ts
 */

import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import {
  type ContextualRequest,
  addRequestContext,
  formatValidationErrors,
  createErrorResponse,
} from './recommendations.js';

/**
 * Express router for override endpoints
 */
export const overridesRouter = Router();

/**
 * Override request schema
 *
 * @requirement 5.4 - Override requires reason
 * @property Property 10: Override Requires Reason
 */
export const OverrideRequestSchema = z.object({
  jobId: z.string().uuid('Job ID must be a valid UUID'),
  originalVendorId: z.string().uuid('Original vendor ID must be a valid UUID'),
  selectedVendorId: z.string().uuid('Selected vendor ID must be a valid UUID'),
  overrideReason: z
    .string()
    .min(1, 'Override reason is required')
    .max(1000, 'Override reason must be 1000 characters or less')
    .refine((val) => val.trim().length > 0, {
      message: 'Override reason cannot be empty or whitespace only',
    }),
  overrideCategory: z.enum(['preference', 'availability', 'relationship', 'other'], {
    errorMap: () => ({ message: 'Override category must be one of: preference, availability, relationship, other' }),
  }),
});

export type OverrideRequest = z.infer<typeof OverrideRequestSchema>;

/**
 * Override response schema
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
 * Audit log entry for override
 *
 * @requirement 6.4 - Log override with timestamp, operator ID, original recommendation,
 *                   selected vendor, and override reason
 * @property Property 13: Override Audit Completeness
 */
export interface OverrideAuditEntry {
  auditId: string;
  timestamp: Date;
  operatorId: string;
  jobId: string;
  originalVendorId: string;
  selectedVendorId: string;
  overrideReason: string;
  overrideCategory: string;
  correlationId: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * In-memory audit log (in production, this would be Azure SQL)
 */
const auditLog: OverrideAuditEntry[] = [];

/**
 * Logs an override to the audit trail
 *
 * @requirement 6.4 - Log override to audit trail
 * @property Property 13: Override Audit Completeness
 */
export function logOverrideToAudit(entry: OverrideAuditEntry): void {
  auditLog.push(entry);
  // In production, this would write to Azure SQL
  console.log('Override audit entry:', JSON.stringify({
    auditId: entry.auditId,
    timestamp: entry.timestamp.toISOString(),
    operatorId: entry.operatorId,
    jobId: entry.jobId,
    originalVendorId: entry.originalVendorId,
    selectedVendorId: entry.selectedVendorId,
    overrideCategory: entry.overrideCategory,
    correlationId: entry.correlationId,
    // Note: overrideReason logged separately for PII considerations
  }));
}

/**
 * Gets audit log entries (for testing/admin purposes)
 */
export function getAuditLog(): OverrideAuditEntry[] {
  return [...auditLog];
}

/**
 * Clears audit log (for testing purposes only)
 */
export function clearAuditLog(): void {
  auditLog.length = 0;
}

/**
 * POST /api/v1/overrides
 *
 * Records a vendor override with required reason.
 *
 * @requirement 5.4 - Override requires reason
 * @requirement 6.4 - Log override to audit trail
 * @property Property 10: Override Requires Reason
 * @property Property 13: Override Audit Completeness
 */
overridesRouter.post(
  '/',
  addRequestContext,
  async (req: ContextualRequest, res: Response): Promise<void> => {
    const context = req.context!;

    try {
      // Validate request body against schema
      // @requirement 5.4 - Validate override reason is provided
      const validationResult = OverrideRequestSchema.safeParse(req.body);

      if (!validationResult.success) {
        // @property Property 10: Override Requires Reason - reject empty reasons
        const errorDetails = formatValidationErrors(validationResult.error);
        res.status(400).json(
          createErrorResponse(
            'ValidationError',
            'Override request validation failed',
            context.correlationId,
            errorDetails
          )
        );
        return;
      }

      const request: OverrideRequest = validationResult.data;

      // Get operator ID from auth context (mock for now)
      // In production, this would come from the authenticated user
      const operatorId = (req.headers['x-operator-id'] as string) || uuidv4();

      // Generate override ID
      const overrideId = uuidv4();
      const recordedAt = new Date();

      // Create audit entry
      // @requirement 6.4 - Log override with all required fields
      // @property Property 13: Override Audit Completeness
      const auditEntry: OverrideAuditEntry = {
        auditId: overrideId,
        timestamp: recordedAt,
        operatorId,
        jobId: request.jobId,
        originalVendorId: request.originalVendorId,
        selectedVendorId: request.selectedVendorId,
        overrideReason: request.overrideReason,
        overrideCategory: request.overrideCategory,
        correlationId: context.correlationId,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      };

      // Log to audit trail
      logOverrideToAudit(auditEntry);

      // Build response
      const response: OverrideResponse = {
        overrideId,
        jobId: request.jobId,
        originalVendorId: request.originalVendorId,
        selectedVendorId: request.selectedVendorId,
        operatorId,
        overrideReason: request.overrideReason,
        overrideCategory: request.overrideCategory,
        recordedAt: recordedAt.toISOString(),
        correlationId: context.correlationId,
      };

      // Set correlation ID in response header
      res.setHeader('X-Correlation-ID', context.correlationId);
      res.setHeader('X-Request-ID', context.requestId);

      res.status(201).json(response);
    } catch (error) {
      console.error('Override error:', error, {
        correlationId: context.correlationId,
      });

      res.status(500).json(
        createErrorResponse(
          'InternalError',
          'An unexpected error occurred while processing the override request',
          context.correlationId
        )
      );
    }
  }
);

/**
 * GET /api/v1/overrides/:jobId
 *
 * Retrieves override history for a job.
 */
overridesRouter.get(
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

    // Find overrides for this job
    const jobOverrides = auditLog.filter((entry) => entry.jobId === jobId);

    if (jobOverrides.length === 0) {
      res.status(404).json(
        createErrorResponse(
          'NotFound',
          `No overrides found for job ${jobId}`,
          context.correlationId
        )
      );
      return;
    }

    res.setHeader('X-Correlation-ID', context.correlationId);
    res.status(200).json({
      jobId,
      overrides: jobOverrides.map((entry) => ({
        overrideId: entry.auditId,
        operatorId: entry.operatorId,
        originalVendorId: entry.originalVendorId,
        selectedVendorId: entry.selectedVendorId,
        overrideReason: entry.overrideReason,
        overrideCategory: entry.overrideCategory,
        recordedAt: entry.timestamp.toISOString(),
      })),
      correlationId: context.correlationId,
    });
  }
);

export default overridesRouter;
