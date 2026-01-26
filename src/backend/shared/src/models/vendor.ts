/**
 * Vendor Profile Data Models and Zod Schemas
 *
 * Defines the canonical schema for vendor profiles in the RetailFixIt system.
 * Vendors are service providers who can be assigned to jobs.
 *
 * @requirement 7.2 - Define canonical Vendor_Profile schema
 * @property Property 14: Schema Validation Enforcement
 * @tested tests/property/schema-validation.property.test.ts
 */

import { z } from 'zod';

// Vendor status enumeration
export const VendorStatus = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  SUSPENDED: 'suspended',
} as const;

export type VendorStatus = (typeof VendorStatus)[keyof typeof VendorStatus];

/**
 * Certification schema
 * @requirement 7.2 - Vendor certifications
 */
export const CertificationSchema = z.object({
  certificationId: z.string().uuid(),
  name: z.string().min(1).max(100),
  issuedBy: z.string().min(1).max(100),
  validUntil: z.coerce.date(),
  verified: z.boolean(),
});

export type Certification = z.infer<typeof CertificationSchema>;

/**
 * Service area schema
 * @requirement 7.2 - Geographic coverage
 */
export const ServiceAreaSchema = z.object({
  regionId: z.string().min(1).max(50),
  regionName: z.string().min(1).max(100),
  zipCodes: z.array(z.string().regex(/^\d{5}$/)),
  maxDistanceMiles: z.number().min(0).max(500),
});

export type ServiceArea = z.infer<typeof ServiceAreaSchema>;

/**
 * Availability window schema
 * @requirement 7.2 - Vendor availability schedule
 */
export const AvailabilityWindowSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6), // 0 = Sunday, 6 = Saturday
  startTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Invalid time format (HH:MM)'),
  endTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Invalid time format (HH:MM)'),
  timezone: z.string().min(1).max(50),
});

export type AvailabilityWindow = z.infer<typeof AvailabilityWindowSchema>;

/**
 * Contact information schema
 * @requirement 7.2 - Vendor contact details
 */
export const ContactInfoSchema = z.object({
  email: z.string().email(),
  phone: z.string().min(10).max(20),
  primaryContact: z.string().min(1).max(100),
});

export type ContactInfo = z.infer<typeof ContactInfoSchema>;

/**
 * Vendor Profile Schema - Canonical schema for vendor profiles
 *
 * @requirement 7.2 - Define canonical Vendor_Profile schema including: vendor ID, name,
 *                   certifications, geographic coverage, capacity, availability schedule,
 *                   and historical metrics
 * @property Property 14: Schema Validation Enforcement
 * @edgecase New vendors may have empty certifications
 * @edgecase currentCapacity must not exceed maxCapacity
 */
export const VendorProfileSchema = z
  .object({
    vendorId: z.string().uuid(),
    name: z.string().min(1).max(200),
    status: z.enum(['active', 'inactive', 'suspended']),
    certifications: z.array(CertificationSchema),
    geographicCoverage: z.array(ServiceAreaSchema),
    maxCapacity: z.number().int().min(1).max(100),
    currentCapacity: z.number().int().min(0).max(100),
    availabilitySchedule: z.array(AvailabilityWindowSchema),
    specializations: z.array(z.string().min(1).max(100)),
    contactInfo: ContactInfoSchema,
    createdAt: z.coerce.date(),
    updatedAt: z.coerce.date(),
  })
  .refine((data) => data.currentCapacity <= data.maxCapacity, {
    message: 'currentCapacity cannot exceed maxCapacity',
    path: ['currentCapacity'],
  });

export type VendorProfile = z.infer<typeof VendorProfileSchema>;

/**
 * Vendor metrics summary schema
 * @requirement 7.2 - Historical performance metrics
 */
export const VendorMetricsSummarySchema = z.object({
  totalJobs: z.number().int().min(0),
  completedJobs: z.number().int().min(0),
  completionRate: z.number().min(0).max(1),
  avgResponseTimeHours: z.number().min(0),
  avgCustomerSatisfaction: z.number().min(0).max(5),
  reworkCount: z.number().int().min(0),
  reworkRate: z.number().min(0).max(1),
});

export type VendorMetricsSummary = z.infer<typeof VendorMetricsSummarySchema>;

/**
 * Vendor profile document schema (for Cosmos DB)
 * @requirement 7.2 - Vendor data with metrics
 */
export const VendorProfileDocumentSchema = z.object({
  id: z.string().uuid(),
  partitionKey: z.string().min(1),
  documentType: z.literal('VendorProfile'),
  profile: VendorProfileSchema,
  metrics: z.object({
    last30Days: VendorMetricsSummarySchema,
    last90Days: VendorMetricsSummarySchema,
    allTime: VendorMetricsSummarySchema,
  }),
});

export type VendorProfileDocument = z.infer<typeof VendorProfileDocumentSchema>;

/**
 * Validates a vendor profile against the schema
 *
 * @requirement 7.5 - Validate all input data against defined schemas
 * @requirement 7.6 - Return descriptive error messages with field-level details
 * @param data - Raw vendor profile data to validate
 * @returns Validated VendorProfile or throws ZodError with field-level details
 */
export function validateVendorProfile(data: unknown): VendorProfile {
  return VendorProfileSchema.parse(data);
}

/**
 * Safely validates a vendor profile, returning result object instead of throwing
 *
 * @requirement 7.6 - Return descriptive error messages with field-level details
 * @param data - Raw vendor profile data to validate
 * @returns SafeParseResult with success flag and data or error
 */
export function safeValidateVendorProfile(data: unknown): z.SafeParseReturnType<unknown, VendorProfile> {
  return VendorProfileSchema.safeParse(data);
}
