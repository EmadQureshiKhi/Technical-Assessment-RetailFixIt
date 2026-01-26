/**
 * Event Schemas for RetailFixIt Event-Driven Architecture
 *
 * Defines the canonical schemas for all events in the system including
 * JobCreated, VendorRecommendationGenerated, and VendorOverrideRecorded.
 *
 * @requirement 4.1 - JobCreated event consumption
 * @requirement 4.2 - VendorRecommendationGenerated event publishing
 * @property Property 8: Event Processing Idempotency
 * @property Property 9: Correlation ID Propagation
 * @property Property 14: Schema Validation Enforcement
 * @tested tests/property/schema-validation.property.test.ts
 */

import { z } from 'zod';

import { CustomerDetailsSchema, GeoLocationSchema } from './job.js';
import { VendorRecommendationSchema } from './scoring.js';

/**
 * Base event schema with common fields
 *
 * @requirement 4.6 - Correlation ID for end-to-end tracing
 * @property Property 9: Correlation ID Propagation
 */
export const BaseEventSchema = z.object({
  eventId: z.string().uuid(),
  timestamp: z.coerce.date(),
  correlationId: z.string().uuid(),
});

export type BaseEvent = z.infer<typeof BaseEventSchema>;

/**
 * JobCreated event schema
 *
 * @requirement 4.1 - JobCreated event consumption
 * @property Property 8: Event Processing Idempotency (jobId used for deduplication)
 */
export const JobCreatedEventSchema = BaseEventSchema.extend({
  eventType: z.literal('JobCreated'),
  data: z.object({
    jobId: z.string().uuid(),
    jobType: z.enum(['repair', 'installation', 'maintenance', 'inspection']),
    location: GeoLocationSchema,
    urgencyLevel: z.enum(['low', 'medium', 'high', 'critical']),
    slaDeadline: z.coerce.date(),
    requiredCertifications: z.array(z.string()),
    customerDetails: CustomerDetailsSchema,
  }),
});

export type JobCreatedEvent = z.infer<typeof JobCreatedEventSchema>;

/**
 * VendorRecommendationGenerated event schema
 *
 * @requirement 4.2 - Publish VendorRecommendationGenerated events
 * @requirement 8.3 - Include model version
 */
export const VendorRecommendationGeneratedEventSchema = BaseEventSchema.extend({
  eventType: z.literal('VendorRecommendationGenerated'),
  data: z.object({
    jobId: z.string().uuid(),
    recommendations: z.array(VendorRecommendationSchema),
    modelVersion: z.string().min(1).max(50),
    processingTimeMs: z.number().int().min(0),
    automationLevel: z.enum(['auto', 'advisory', 'manual']),
    degradedMode: z.boolean().default(false),
  }),
});

export type VendorRecommendationGeneratedEvent = z.infer<typeof VendorRecommendationGeneratedEventSchema>;

/**
 * Override category enumeration
 */
export const OverrideCategory = {
  PREFERENCE: 'preference',
  AVAILABILITY: 'availability',
  RELATIONSHIP: 'relationship',
  OTHER: 'other',
} as const;

export type OverrideCategory = (typeof OverrideCategory)[keyof typeof OverrideCategory];

/**
 * VendorOverrideRecorded event schema
 *
 * @requirement 6.4 - Log override with timestamp, operator ID, original recommendation,
 *                   selected vendor, and override reason
 * @property Property 10: Override Requires Reason
 * @property Property 13: Override Audit Completeness
 */
export const VendorOverrideRecordedEventSchema = BaseEventSchema.extend({
  eventType: z.literal('VendorOverrideRecorded'),
  data: z.object({
    jobId: z.string().uuid(),
    originalRecommendation: z.string().uuid(), // vendorId
    selectedVendor: z.string().uuid(), // vendorId
    operatorId: z.string().uuid(),
    // Must not be empty or whitespace-only (Property 10: Override Requires Reason)
    overrideReason: z
      .string()
      .min(1)
      .max(1000)
      .refine((val) => val.trim().length > 0, {
        message: 'Override reason cannot be empty or whitespace only',
      }),
    overrideCategory: z.enum(['preference', 'availability', 'relationship', 'other']),
  }),
});

export type VendorOverrideRecordedEvent = z.infer<typeof VendorOverrideRecordedEventSchema>;

/**
 * VendorAssigned event schema
 *
 * Published when a vendor is assigned to a job (either automatically or after approval)
 */
export const VendorAssignedEventSchema = BaseEventSchema.extend({
  eventType: z.literal('VendorAssigned'),
  data: z.object({
    jobId: z.string().uuid(),
    vendorId: z.string().uuid(),
    assignmentType: z.enum(['automatic', 'approved', 'override']),
    assignedBy: z.string().uuid().optional(), // operatorId if manual
  }),
});

export type VendorAssignedEvent = z.infer<typeof VendorAssignedEventSchema>;

/**
 * VendorUpdated event schema
 *
 * Published when vendor profile is updated
 */
export const VendorUpdatedEventSchema = BaseEventSchema.extend({
  eventType: z.literal('VendorUpdated'),
  data: z.object({
    vendorId: z.string().uuid(),
    updatedFields: z.array(z.string()),
    updatedBy: z.string().uuid(),
  }),
});

export type VendorUpdatedEvent = z.infer<typeof VendorUpdatedEventSchema>;

/**
 * JobOutcomeRecorded event schema
 *
 * Published when a job is completed with outcome data
 * @requirement 9.1 - Monitor prediction accuracy against actual outcomes
 */
export const JobOutcomeRecordedEventSchema = BaseEventSchema.extend({
  eventType: z.literal('JobOutcomeRecorded'),
  data: z.object({
    jobId: z.string().uuid(),
    vendorId: z.string().uuid(),
    wasAIRecommended: z.boolean(),
    wasOverridden: z.boolean(),
    completionStatus: z.enum(['completed', 'failed', 'cancelled']),
    completedAt: z.coerce.date(),
    customerSatisfaction: z.number().min(0).max(5).optional(),
    requiredRework: z.boolean(),
    timeToCompletionHours: z.number().min(0).optional(),
    feedbackNotes: z.string().max(2000).optional(),
  }),
});

export type JobOutcomeRecordedEvent = z.infer<typeof JobOutcomeRecordedEventSchema>;

/**
 * Union type for all events
 */
export const EventSchema = z.discriminatedUnion('eventType', [
  JobCreatedEventSchema,
  VendorRecommendationGeneratedEventSchema,
  VendorOverrideRecordedEventSchema,
  VendorAssignedEventSchema,
  VendorUpdatedEventSchema,
  JobOutcomeRecordedEventSchema,
]);

export type Event =
  | JobCreatedEvent
  | VendorRecommendationGeneratedEvent
  | VendorOverrideRecordedEvent
  | VendorAssignedEvent
  | VendorUpdatedEvent
  | JobOutcomeRecordedEvent;

/**
 * Validates a JobCreated event
 *
 * @requirement 7.5 - Validate all input data against defined schemas
 * @requirement 7.6 - Return descriptive error messages with field-level details
 */
export function validateJobCreatedEvent(data: unknown): JobCreatedEvent {
  return JobCreatedEventSchema.parse(data);
}

/**
 * Safely validates a JobCreated event
 */
export function safeValidateJobCreatedEvent(data: unknown): z.SafeParseReturnType<unknown, JobCreatedEvent> {
  return JobCreatedEventSchema.safeParse(data);
}

/**
 * Validates a VendorOverrideRecorded event
 *
 * @requirement 5.4 - Override requires reason
 * @property Property 10: Override Requires Reason
 */
export function validateVendorOverrideEvent(data: unknown): VendorOverrideRecordedEvent {
  return VendorOverrideRecordedEventSchema.parse(data);
}

/**
 * Safely validates a VendorOverrideRecorded event
 */
export function safeValidateVendorOverrideEvent(
  data: unknown
): z.SafeParseReturnType<unknown, VendorOverrideRecordedEvent> {
  return VendorOverrideRecordedEventSchema.safeParse(data);
}

/**
 * Validates any event using discriminated union
 *
 * @requirement 7.5 - Validate all input data against defined schemas
 */
export function validateEvent(data: unknown): Event {
  return EventSchema.parse(data);
}

/**
 * Safely validates any event
 */
export function safeValidateEvent(data: unknown): z.SafeParseReturnType<unknown, Event> {
  return EventSchema.safeParse(data);
}

/**
 * Creates a new correlation ID
 *
 * @property Property 9: Correlation ID Propagation
 */
export function createCorrelationId(): string {
  return crypto.randomUUID();
}

/**
 * Creates a new event ID
 */
export function createEventId(): string {
  return crypto.randomUUID();
}
