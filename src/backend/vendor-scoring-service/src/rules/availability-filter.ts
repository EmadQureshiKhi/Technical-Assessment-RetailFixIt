/**
 * Availability Filter
 *
 * Determines if a vendor is currently available to take on a job
 * based on their availability schedule and current capacity.
 *
 * @requirement 2.1 - Implement deterministic rules for vendor availability
 */

import type { VendorProfile, AvailabilityWindow } from '@retailfixit/shared';
import type { JobEvent } from '@retailfixit/shared';

export interface FilterResult {
  passed: boolean;
  score: number;
  explanation: string;
}

/**
 * Checks if a given time falls within an availability window
 */
function isTimeInWindow(
  date: Date,
  window: AvailabilityWindow
): boolean {
  const dayOfWeek = date.getDay();
  if (dayOfWeek !== window.dayOfWeek) {
    return false;
  }

  const timeStr = date.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    timeZone: window.timezone,
  });

  return timeStr >= window.startTime && timeStr <= window.endTime;
}

/**
 * Checks if vendor is available at the current time
 */
function isVendorAvailableNow(
  vendor: VendorProfile,
  checkTime: Date = new Date()
): boolean {
  if (vendor.status !== 'active') {
    return false;
  }

  if (vendor.availabilitySchedule.length === 0) {
    // No schedule defined means always available during business hours
    return true;
  }

  return vendor.availabilitySchedule.some((window: AvailabilityWindow) =>
    isTimeInWindow(checkTime, window)
  );
}

/**
 * Availability Filter
 *
 * Evaluates vendor availability based on:
 * - Vendor status (must be active)
 * - Current time vs availability schedule
 * - Capacity constraints
 *
 * @param vendor - The vendor profile to evaluate
 * @param _job - The job event requiring vendor assignment (unused but kept for interface consistency)
 * @param checkTime - Optional time to check availability (defaults to now)
 * @returns FilterResult with pass/fail status and score contribution
 *
 * @requirement 2.1 - Deterministic rule for vendor availability
 */
export function availabilityFilter(
  vendor: VendorProfile,
  _job: JobEvent,
  checkTime: Date = new Date()
): FilterResult {
  // Check if vendor is active
  if (vendor.status !== 'active') {
    return {
      passed: false,
      score: 0,
      explanation: `Vendor ${vendor.name} is not active (status: ${vendor.status})`,
    };
  }

  // Check if vendor has capacity
  if (vendor.currentCapacity >= vendor.maxCapacity) {
    return {
      passed: false,
      score: 0,
      explanation: `Vendor ${vendor.name} is at full capacity (${vendor.currentCapacity}/${vendor.maxCapacity} jobs)`,
    };
  }

  // Check availability schedule
  const isAvailable = isVendorAvailableNow(vendor, checkTime);

  if (!isAvailable) {
    return {
      passed: false,
      score: 0,
      explanation: `Vendor ${vendor.name} is not available at the requested time`,
    };
  }

  // Calculate availability score based on remaining capacity
  const capacityUtilization = vendor.currentCapacity / vendor.maxCapacity;
  const availabilityScore = 1 - capacityUtilization;

  return {
    passed: true,
    score: availabilityScore,
    explanation: `Vendor ${vendor.name} is available with ${vendor.maxCapacity - vendor.currentCapacity} capacity slots remaining`,
  };
}

export { isVendorAvailableNow, isTimeInWindow };
