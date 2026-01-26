/**
 * Capacity Filter
 *
 * Determines if a vendor has sufficient capacity to take on a job
 * and calculates a capacity utilization score.
 *
 * @requirement 2.1 - Implement deterministic rules for capacity constraints
 */

import type { VendorProfile } from '@retailfixit/shared';
import type { JobEvent } from '@retailfixit/shared';
import type { FilterResult } from './availability-filter.js';

/**
 * Calculates the capacity utilization ratio
 */
function calculateUtilization(vendor: VendorProfile): number {
  if (vendor.maxCapacity === 0) {
    return 1; // Fully utilized if no capacity
  }
  return vendor.currentCapacity / vendor.maxCapacity;
}

/**
 * Calculates available capacity slots
 */
function getAvailableSlots(vendor: VendorProfile): number {
  return Math.max(0, vendor.maxCapacity - vendor.currentCapacity);
}

/**
 * Determines urgency multiplier for capacity scoring
 * Higher urgency jobs prefer vendors with more available capacity
 */
function getUrgencyMultiplier(urgencyLevel: string): number {
  switch (urgencyLevel) {
    case 'critical':
      return 1.5;
    case 'high':
      return 1.25;
    case 'medium':
      return 1.0;
    case 'low':
      return 0.75;
    default:
      return 1.0;
  }
}

/**
 * Capacity Filter
 *
 * Evaluates vendor capacity based on:
 * - Current capacity vs maximum capacity
 * - Available slots for new jobs
 * - Job urgency (critical jobs prefer vendors with more capacity)
 *
 * @param vendor - The vendor profile to evaluate
 * @param job - The job event requiring vendor assignment
 * @returns FilterResult with pass/fail status and score contribution
 *
 * @requirement 2.1 - Deterministic rule for capacity constraints
 */
export function capacityFilter(
  vendor: VendorProfile,
  job: JobEvent
): FilterResult {
  // Check if vendor has any capacity defined
  if (vendor.maxCapacity <= 0) {
    return {
      passed: false,
      score: 0,
      explanation: `Vendor ${vendor.name} has no capacity configured`,
    };
  }

  // Check if vendor has available capacity
  const availableSlots = getAvailableSlots(vendor);

  if (availableSlots <= 0) {
    return {
      passed: false,
      score: 0,
      explanation: `Vendor ${vendor.name} has no available capacity (${vendor.currentCapacity}/${vendor.maxCapacity} jobs)`,
    };
  }

  // Calculate base capacity score (more available = higher score)
  const utilization = calculateUtilization(vendor);
  const baseCapacityScore = 1 - utilization;

  // Get urgency multiplier for potential future use in scoring adjustments
  const urgencyMultiplier = getUrgencyMultiplier(job.urgencyLevel);

  // For critical/high urgency, prefer vendors with more available capacity
  // For low urgency, capacity matters less
  let adjustedScore = baseCapacityScore * urgencyMultiplier;

  if (job.urgencyLevel === 'critical' || job.urgencyLevel === 'high') {
    // Penalize vendors with low available capacity for urgent jobs
    if (availableSlots === 1) {
      adjustedScore *= 0.7; // 30% penalty for last slot
    } else if (availableSlots === 2) {
      adjustedScore *= 0.85; // 15% penalty for second-to-last slot
    }
  }

  // Ensure score is within bounds
  const finalScore = Math.max(0, Math.min(1, adjustedScore));

  return {
    passed: true,
    score: finalScore,
    explanation: `Vendor ${vendor.name} has ${availableSlots} available capacity slots (${Math.round((1 - utilization) * 100)}% available)`,
  };
}

export { calculateUtilization, getAvailableSlots, getUrgencyMultiplier };
