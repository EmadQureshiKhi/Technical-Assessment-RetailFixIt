/**
 * Geographic Filter
 *
 * Determines if a vendor can service a job based on geographic coverage
 * and calculates a proximity score.
 *
 * @requirement 2.1 - Implement deterministic rules for geographic coverage
 */

import type { VendorProfile, ServiceArea } from '@retailfixit/shared';
import type { JobEvent, GeoLocation } from '@retailfixit/shared';
import type { FilterResult } from './availability-filter.js';

/**
 * Calculates the distance between two geographic points using the Haversine formula
 *
 * @param lat1 - Latitude of point 1
 * @param lon1 - Longitude of point 1
 * @param lat2 - Latitude of point 2
 * @param lon2 - Longitude of point 2
 * @returns Distance in miles
 */
export function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 3959; // Earth's radius in miles
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

/**
 * Checks if a job location is within a vendor's service area
 */
function isInServiceArea(
  jobLocation: GeoLocation,
  serviceArea: ServiceArea
): boolean {
  // Check if job's ZIP code is in the service area's covered ZIP codes
  const jobZip = jobLocation.zipCode.substring(0, 5); // Handle ZIP+4 format
  return serviceArea.zipCodes.includes(jobZip);
}

/**
 * Finds the best matching service area for a job location
 */
function findBestServiceArea(
  jobLocation: GeoLocation,
  serviceAreas: ServiceArea[]
): ServiceArea | null {
  for (const area of serviceAreas) {
    if (isInServiceArea(jobLocation, area)) {
      return area;
    }
  }
  return null;
}

/**
 * Geographic Filter
 *
 * Evaluates vendor geographic coverage based on:
 * - Whether job location is within vendor's service areas
 * - Distance from vendor's service center to job location
 * - Maximum service distance constraints
 *
 * @param vendor - The vendor profile to evaluate
 * @param job - The job event requiring vendor assignment
 * @param vendorLocation - Optional vendor base location for distance calculation
 * @returns FilterResult with pass/fail status and score contribution
 *
 * @requirement 2.1 - Deterministic rule for geographic coverage
 */
export function geographicFilter(
  vendor: VendorProfile,
  job: JobEvent,
  vendorLocation?: GeoLocation
): FilterResult {
  const jobLocation = job.location;

  // Check if vendor has any geographic coverage defined
  if (vendor.geographicCoverage.length === 0) {
    return {
      passed: false,
      score: 0,
      explanation: `Vendor ${vendor.name} has no defined service areas`,
    };
  }

  // Find matching service area
  const matchingArea = findBestServiceArea(jobLocation, vendor.geographicCoverage);

  if (!matchingArea) {
    return {
      passed: false,
      score: 0,
      explanation: `Job location (ZIP: ${jobLocation.zipCode}) is not within vendor ${vendor.name}'s service areas`,
    };
  }

  // Calculate proximity score
  // If vendor location is provided, calculate actual distance
  // Otherwise, use a default score based on being in the service area
  let proximityScore = 0.8; // Default score for being in service area
  let distanceExplanation = 'within service area';

  if (vendorLocation) {
    const distance = calculateDistance(
      vendorLocation.latitude,
      vendorLocation.longitude,
      jobLocation.latitude,
      jobLocation.longitude
    );

    // Check if within max distance
    if (distance > matchingArea.maxDistanceMiles) {
      return {
        passed: false,
        score: 0,
        explanation: `Job is ${distance.toFixed(1)} miles away, exceeding vendor ${vendor.name}'s max distance of ${matchingArea.maxDistanceMiles} miles`,
      };
    }

    // Calculate proximity score: closer = higher score
    proximityScore = Math.max(0, 1 - distance / matchingArea.maxDistanceMiles);
    distanceExplanation = `${distance.toFixed(1)} miles away`;
  }

  return {
    passed: true,
    score: proximityScore,
    explanation: `Vendor ${vendor.name} can service job in ${matchingArea.regionName} (${distanceExplanation})`,
  };
}

export { isInServiceArea, findBestServiceArea };
