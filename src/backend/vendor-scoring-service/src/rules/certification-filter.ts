/**
 * Certification Filter
 *
 * Determines if a vendor has the required certifications for a job
 * and calculates a certification match score.
 *
 * @requirement 2.1 - Implement deterministic rules for certification requirements
 */

import type { VendorProfile, Certification } from '@retailfixit/shared';
import type { JobEvent } from '@retailfixit/shared';
import type { FilterResult } from './availability-filter.js';

/**
 * Checks if a certification is currently valid
 */
function isCertificationValid(cert: Certification, checkDate: Date = new Date()): boolean {
  return cert.verified && cert.validUntil > checkDate;
}

/**
 * Gets the list of valid certification names for a vendor
 */
function getValidCertifications(
  vendor: VendorProfile,
  checkDate: Date = new Date()
): string[] {
  return vendor.certifications
    .filter((cert: Certification) => isCertificationValid(cert, checkDate))
    .map((cert: Certification) => cert.name.toLowerCase());
}

/**
 * Checks if vendor has a specific certification
 */
function hasCertification(
  validCerts: string[],
  requiredCert: string
): boolean {
  const normalizedRequired = requiredCert.toLowerCase();
  return validCerts.some(
    (cert) => cert === normalizedRequired || cert.includes(normalizedRequired)
  );
}

/**
 * Certification Filter
 *
 * Evaluates vendor certifications based on:
 * - Whether vendor has all required certifications
 * - Whether certifications are verified and not expired
 * - Partial match scoring for jobs with multiple certifications
 *
 * @param vendor - The vendor profile to evaluate
 * @param job - The job event requiring vendor assignment
 * @param checkDate - Optional date to check certification validity (defaults to now)
 * @returns FilterResult with pass/fail status and score contribution
 *
 * @requirement 2.1 - Deterministic rule for certification requirements
 */
export function certificationFilter(
  vendor: VendorProfile,
  job: JobEvent,
  checkDate: Date = new Date()
): FilterResult {
  const requiredCerts = job.requiredCertifications;

  // If no certifications required, vendor passes with full score
  if (requiredCerts.length === 0) {
    return {
      passed: true,
      score: 1.0,
      explanation: `No certifications required for this job`,
    };
  }

  // Get vendor's valid certifications
  const validVendorCerts = getValidCertifications(vendor, checkDate);

  // Check each required certification
  const matchedCerts: string[] = [];
  const missingCerts: string[] = [];

  for (const required of requiredCerts) {
    if (hasCertification(validVendorCerts, required)) {
      matchedCerts.push(required);
    } else {
      missingCerts.push(required);
    }
  }

  // Calculate certification score
  const certificationScore = matchedCerts.length / requiredCerts.length;

  // Vendor must have ALL required certifications to pass
  if (missingCerts.length > 0) {
    return {
      passed: false,
      score: certificationScore,
      explanation: `Vendor ${vendor.name} is missing required certifications: ${missingCerts.join(', ')}`,
    };
  }

  // Calculate bonus for having extra relevant certifications
  const extraCerts = validVendorCerts.length - matchedCerts.length;
  const bonusScore = Math.min(0.1, extraCerts * 0.02); // Up to 10% bonus

  return {
    passed: true,
    score: Math.min(1.0, certificationScore + bonusScore),
    explanation: `Vendor ${vendor.name} has all required certifications: ${matchedCerts.join(', ')}`,
  };
}

export { isCertificationValid, getValidCertifications, hasCertification };
