/**
 * Job Event Data Models and Zod Schemas
 *
 * Defines the canonical schema for job events in the RetailFixIt system.
 * Jobs represent service requests that need vendor assignment.
 *
 * @requirement 7.1 - Define canonical Job_Event schema
 * @property Property 14: Schema Validation Enforcement
 * @tested tests/property/schema-validation.property.test.ts
 */

import { z } from 'zod';

// Job type enumeration
export const JobType = {
  REPAIR: 'repair',
  INSTALLATION: 'installation',
  MAINTENANCE: 'maintenance',
  INSPECTION: 'inspection',
} as const;

export type JobType = (typeof JobType)[keyof typeof JobType];

// Urgency level enumeration
export const UrgencyLevel = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical',
} as const;

export type UrgencyLevel = (typeof UrgencyLevel)[keyof typeof UrgencyLevel];

// Job status enumeration
export const JobStatus = {
  PENDING: 'pending',
  ASSIGNED: 'assigned',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
} as const;

export type JobStatus = (typeof JobStatus)[keyof typeof JobStatus];

// Customer tier enumeration
export const CustomerTier = {
  STANDARD: 'standard',
  PREMIUM: 'premium',
  ENTERPRISE: 'enterprise',
} as const;

export type CustomerTier = (typeof CustomerTier)[keyof typeof CustomerTier];

/**
 * Geographic location schema
 * @requirement 7.1 - Job location details
 */
export const GeoLocationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  address: z.string().min(1).max(200),
  city: z.string().min(1).max(100),
  state: z.string().min(2).max(2),
  zipCode: z.string().regex(/^\d{5}(-\d{4})?$/, 'Invalid ZIP code format'),
  serviceRegion: z.string().min(1).max(50),
});

export type GeoLocation = z.infer<typeof GeoLocationSchema>;

/**
 * Customer details schema
 * @requirement 7.1 - Customer information for job context
 */
export const CustomerDetailsSchema = z.object({
  customerId: z.string().uuid(),
  tier: z.enum(['standard', 'premium', 'enterprise']),
  preferredVendors: z.array(z.string().uuid()).optional(),
  blockedVendors: z.array(z.string().uuid()).optional(),
});

export type CustomerDetails = z.infer<typeof CustomerDetailsSchema>;

/**
 * Job Event Schema - Canonical schema for job events
 *
 * @requirement 7.1 - Define canonical Job_Event schema including: job ID, job type,
 *                   location, urgency level, SLA requirements, required certifications,
 *                   and customer details
 * @property Property 14: Schema Validation Enforcement
 * @edgecase Empty certifications array is valid (no special certs required)
 * @edgecase Special requirements can be empty
 */
export const JobEventSchema = z.object({
  jobId: z.string().uuid(),
  jobType: z.enum(['repair', 'installation', 'maintenance', 'inspection']),
  location: GeoLocationSchema,
  urgencyLevel: z.enum(['low', 'medium', 'high', 'critical']),
  slaDeadline: z.coerce.date(),
  requiredCertifications: z.array(z.string().min(1).max(100)),
  customerDetails: CustomerDetailsSchema,
  specialRequirements: z.array(z.string().min(1).max(200)).default([]),
  createdAt: z.coerce.date().default(() => new Date()),
  status: z.enum(['pending', 'assigned', 'in_progress', 'completed', 'cancelled']).default('pending'),
});

export type JobEvent = z.infer<typeof JobEventSchema>;

/**
 * Validates a job event against the schema
 *
 * @requirement 7.5 - Validate all input data against defined schemas
 * @requirement 7.6 - Return descriptive error messages with field-level details
 * @param data - Raw job event data to validate
 * @returns Validated JobEvent or throws ZodError with field-level details
 */
export function validateJobEvent(data: unknown): JobEvent {
  return JobEventSchema.parse(data);
}

/**
 * Safely validates a job event, returning result object instead of throwing
 *
 * @requirement 7.6 - Return descriptive error messages with field-level details
 * @param data - Raw job event data to validate
 * @returns SafeParseResult with success flag and data or error
 */
export function safeValidateJobEvent(data: unknown): z.SafeParseReturnType<unknown, JobEvent> {
  return JobEventSchema.safeParse(data);
}
