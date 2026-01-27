/**
 * API Service for Admin UI
 *
 * Handles all API communication with the backend services.
 *
 * @requirement 5.1 - Admin UI API integration
 * @requirement 7.4 - RESTful API consumption
 */

import type {
  Job,
  RecommendationResponse,
  OverrideRequest,
  OverrideResponse,
  ApiError,
  JobFilters,
  JobSortOptions,
} from '../types';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api/v1';

/**
 * Flag to enable mock data for local development/testing
 * Set VITE_USE_MOCK_DATA=false in production
 */
const USE_MOCK_DATA = import.meta.env.VITE_USE_MOCK_DATA !== 'false';

/**
 * Custom error class for API errors
 */
export class ApiServiceError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public details?: ApiError
  ) {
    super(message);
    this.name = 'ApiServiceError';
  }
}

/**
 * Makes an authenticated API request
 */
async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;
  
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    let errorDetails: ApiError | undefined;
    try {
      errorDetails = await response.json();
    } catch {
      // Response body is not JSON
    }
    throw new ApiServiceError(
      errorDetails?.message || `API request failed with status ${response.status}`,
      response.status,
      errorDetails
    );
  }

  return response.json();
}

/**
 * Mock jobs data for development
 * In production, this would come from the API
 */
const mockJobs: Job[] = [
  {
    jobId: '550e8400-e29b-41d4-a716-446655440010',
    jobType: 'repair',
    location: {
      latitude: 40.7128,
      longitude: -74.006,
      address: '123 Main St',
      city: 'New York',
      state: 'NY',
      zipCode: '10001',
      serviceRegion: 'northeast',
    },
    urgencyLevel: 'high',
    slaDeadline: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
    requiredCertifications: ['HVAC-Certified', 'EPA-608'],
    customerDetails: {
      customerId: '550e8400-e29b-41d4-a716-446655440020',
      tier: 'premium',
    },
    specialRequirements: ['After-hours access required'],
    createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    status: 'pending',
    recommendationStatus: 'generated',
  },
  {
    jobId: '550e8400-e29b-41d4-a716-446655440011',
    jobType: 'installation',
    location: {
      latitude: 34.0522,
      longitude: -118.2437,
      address: '456 Oak Ave',
      city: 'Los Angeles',
      state: 'CA',
      zipCode: '90001',
      serviceRegion: 'west',
    },
    urgencyLevel: 'medium',
    slaDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    requiredCertifications: ['Electrical-Licensed'],
    customerDetails: {
      customerId: '550e8400-e29b-41d4-a716-446655440021',
      tier: 'standard',
    },
    specialRequirements: [],
    createdAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
    status: 'pending',
    recommendationStatus: 'pending',
  },
  {
    jobId: '550e8400-e29b-41d4-a716-446655440012',
    jobType: 'maintenance',
    location: {
      latitude: 41.8781,
      longitude: -87.6298,
      address: '789 Elm St',
      city: 'Chicago',
      state: 'IL',
      zipCode: '60601',
      serviceRegion: 'midwest',
    },
    urgencyLevel: 'low',
    slaDeadline: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
    requiredCertifications: [],
    customerDetails: {
      customerId: '550e8400-e29b-41d4-a716-446655440022',
      tier: 'enterprise',
    },
    specialRequirements: ['Security clearance required'],
    createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    status: 'assigned',
    recommendationStatus: 'accepted',
  },
  {
    jobId: '550e8400-e29b-41d4-a716-446655440013',
    jobType: 'inspection',
    location: {
      latitude: 29.7604,
      longitude: -95.3698,
      address: '321 Pine Rd',
      city: 'Houston',
      state: 'TX',
      zipCode: '77001',
      serviceRegion: 'south',
    },
    urgencyLevel: 'critical',
    slaDeadline: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    requiredCertifications: ['Safety-Inspector'],
    customerDetails: {
      customerId: '550e8400-e29b-41d4-a716-446655440023',
      tier: 'premium',
    },
    specialRequirements: ['Emergency response'],
    createdAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    status: 'pending',
    recommendationStatus: 'generated',
  },
];

/**
 * Fetches list of jobs with optional filtering and sorting
 * @requirement 5.1 - Display list of pending jobs
 * @requirement 5.6 - Filtering and sorting capabilities
 */
export async function fetchJobs(
  filters?: JobFilters,
  sort?: JobSortOptions
): Promise<Job[]> {
  // In production, call the real API
  if (!USE_MOCK_DATA) {
    const params = new URLSearchParams();
    if (filters?.status) params.set('status', filters.status);
    if (filters?.urgencyLevel) params.set('urgencyLevel', filters.urgencyLevel);
    if (filters?.jobType) params.set('jobType', filters.jobType);
    if (filters?.searchQuery) params.set('search', filters.searchQuery);
    if (sort?.field) params.set('sortBy', sort.field);
    if (sort?.direction) params.set('sortDir', sort.direction);
    
    const queryString = params.toString();
    return apiRequest<Job[]>(`/jobs${queryString ? `?${queryString}` : ''}`);
  }

  // Mock data for development/testing
  let jobs = [...mockJobs];

  // Apply filters
  if (filters) {
    if (filters.status) {
      jobs = jobs.filter(j => j.status === filters.status);
    }
    if (filters.urgencyLevel) {
      jobs = jobs.filter(j => j.urgencyLevel === filters.urgencyLevel);
    }
    if (filters.jobType) {
      jobs = jobs.filter(j => j.jobType === filters.jobType);
    }
    if (filters.recommendationStatus) {
      jobs = jobs.filter(j => j.recommendationStatus === filters.recommendationStatus);
    }
    if (filters.searchQuery) {
      const query = filters.searchQuery.toLowerCase();
      jobs = jobs.filter(j => 
        j.jobId.toLowerCase().includes(query) ||
        j.location.city.toLowerCase().includes(query) ||
        j.location.address.toLowerCase().includes(query)
      );
    }
  }

  // Apply sorting
  if (sort) {
    const urgencyOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    jobs.sort((a, b) => {
      let comparison = 0;
      switch (sort.field) {
        case 'createdAt':
          comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          break;
        case 'slaDeadline':
          comparison = new Date(a.slaDeadline).getTime() - new Date(b.slaDeadline).getTime();
          break;
        case 'urgencyLevel':
          comparison = urgencyOrder[a.urgencyLevel] - urgencyOrder[b.urgencyLevel];
          break;
        case 'status':
          comparison = a.status.localeCompare(b.status);
          break;
      }
      return sort.direction === 'desc' ? -comparison : comparison;
    });
  }

  return jobs;
}

/**
 * Fetches a single job by ID
 * @requirement 5.2 - Display job details
 */
export async function fetchJob(jobId: string): Promise<Job | null> {
  // In production, call the real API
  if (!USE_MOCK_DATA) {
    return apiRequest<Job>(`/jobs/${jobId}`);
  }
  
  // Mock data for development/testing
  return mockJobs.find(j => j.jobId === jobId) || null;
}

/**
 * Mock recommendations data for development
 * In production, this would come from the API
 */
const mockRecommendations: Record<string, RecommendationResponse> = {
  '550e8400-e29b-41d4-a716-446655440010': {
    requestId: 'req-001',
    jobId: '550e8400-e29b-41d4-a716-446655440010',
    recommendations: [
      {
        rank: 1,
        vendorId: 'vendor-001',
        vendorName: 'HVAC Experts Inc.',
        overallScore: 0.92,
        confidence: 0.88,
        scoreBreakdown: {
          ruleBasedScore: 0.90,
          mlScore: 0.94,
          factors: [
            { name: 'availability', value: 0.95, weight: 0.25, contribution: 0.2375, explanation: 'Vendor is available immediately' },
            { name: 'proximity', value: 0.88, weight: 0.20, contribution: 0.176, explanation: '5 miles from job location' },
            { name: 'certification', value: 1.0, weight: 0.20, contribution: 0.20, explanation: 'All required certifications met' },
            { name: 'capacity', value: 0.80, weight: 0.15, contribution: 0.12, explanation: '2 of 10 slots available' },
            { name: 'completionRate', value: 0.95, weight: 0.20, contribution: 0.19, explanation: '95% historical completion rate' },
          ],
        },
        rationale: 'HVAC Experts Inc. is the top recommendation due to excellent availability, proximity, and a 95% historical completion rate. All required certifications are met.',
        riskFactors: [],
        estimatedResponseTime: '30 minutes',
      },
      {
        rank: 2,
        vendorId: 'vendor-002',
        vendorName: 'CoolAir Services',
        overallScore: 0.85,
        confidence: 0.82,
        scoreBreakdown: {
          ruleBasedScore: 0.83,
          mlScore: 0.87,
          factors: [
            { name: 'availability', value: 0.90, weight: 0.25, contribution: 0.225, explanation: 'Available within 1 hour' },
            { name: 'proximity', value: 0.75, weight: 0.20, contribution: 0.15, explanation: '12 miles from job location' },
            { name: 'certification', value: 1.0, weight: 0.20, contribution: 0.20, explanation: 'All required certifications met' },
            { name: 'capacity', value: 0.70, weight: 0.15, contribution: 0.105, explanation: '3 of 10 slots available' },
            { name: 'completionRate', value: 0.88, weight: 0.20, contribution: 0.176, explanation: '88% historical completion rate' },
          ],
        },
        rationale: 'CoolAir Services is a strong alternative with good availability and all required certifications.',
        riskFactors: ['Slightly lower completion rate than top choice'],
        estimatedResponseTime: '1 hour',
      },
      {
        rank: 3,
        vendorId: 'vendor-003',
        vendorName: 'QuickFix HVAC',
        overallScore: 0.78,
        confidence: 0.75,
        scoreBreakdown: {
          ruleBasedScore: 0.76,
          mlScore: 0.80,
          factors: [
            { name: 'availability', value: 0.85, weight: 0.25, contribution: 0.2125, explanation: 'Available within 2 hours' },
            { name: 'proximity', value: 0.60, weight: 0.20, contribution: 0.12, explanation: '20 miles from job location' },
            { name: 'certification', value: 1.0, weight: 0.20, contribution: 0.20, explanation: 'All required certifications met' },
            { name: 'capacity', value: 0.65, weight: 0.15, contribution: 0.0975, explanation: '4 of 10 slots available' },
            { name: 'completionRate', value: 0.82, weight: 0.20, contribution: 0.164, explanation: '82% historical completion rate' },
          ],
        },
        rationale: 'QuickFix HVAC meets all requirements but has longer response time and is further from the job location.',
        riskFactors: ['Further distance may impact response time', 'Lower completion rate'],
        estimatedResponseTime: '2 hours',
      },
    ],
    generatedAt: new Date().toISOString(),
    modelVersion: 'v2.1.0',
    overallConfidence: 0.85,
    automationLevel: 'advisory',
    degradedMode: false,
    processingTimeMs: 245,
  },
  '550e8400-e29b-41d4-a716-446655440013': {
    requestId: 'req-002',
    jobId: '550e8400-e29b-41d4-a716-446655440013',
    recommendations: [
      {
        rank: 1,
        vendorId: 'vendor-004',
        vendorName: 'SafetyFirst Inspections',
        overallScore: 0.95,
        confidence: 0.92,
        scoreBreakdown: {
          ruleBasedScore: 0.94,
          mlScore: 0.96,
          factors: [
            { name: 'availability', value: 1.0, weight: 0.25, contribution: 0.25, explanation: 'Available immediately for emergency' },
            { name: 'proximity', value: 0.92, weight: 0.20, contribution: 0.184, explanation: '3 miles from job location' },
            { name: 'certification', value: 1.0, weight: 0.20, contribution: 0.20, explanation: 'Safety Inspector certified' },
            { name: 'capacity', value: 0.90, weight: 0.15, contribution: 0.135, explanation: '1 of 5 slots available' },
            { name: 'completionRate', value: 0.98, weight: 0.20, contribution: 0.196, explanation: '98% historical completion rate' },
          ],
        },
        rationale: 'SafetyFirst Inspections is highly recommended for this critical inspection due to immediate availability and excellent track record.',
        riskFactors: [],
        estimatedResponseTime: '15 minutes',
      },
    ],
    generatedAt: new Date().toISOString(),
    modelVersion: 'v2.1.0',
    overallConfidence: 0.92,
    automationLevel: 'auto',
    degradedMode: false,
    processingTimeMs: 180,
  },
};

/**
 * Fetches recommendations for a job
 * @requirement 5.2 - Display recommended vendors, scores, and rationale
 */
export async function fetchRecommendations(
  jobId: string
): Promise<RecommendationResponse> {
  // In production, call the real API
  if (!USE_MOCK_DATA) {
    return apiRequest<RecommendationResponse>(`/recommendations/${jobId}`);
  }
  
  // Mock data for development/testing
  if (mockRecommendations[jobId]) {
    return mockRecommendations[jobId];
  }
  throw new ApiServiceError('Recommendations not found', 404);
}

/**
 * Generates new recommendations for a job
 * @requirement 5.2 - Generate vendor recommendations
 */
export async function generateRecommendations(
  job: Job
): Promise<RecommendationResponse> {
  // In production, call the real API
  if (!USE_MOCK_DATA) {
    return apiRequest<RecommendationResponse>('/recommendations', {
      method: 'POST',
      body: JSON.stringify({
        jobId: job.jobId,
        jobType: job.jobType,
        location: job.location,
        urgencyLevel: job.urgencyLevel,
        slaDeadline: job.slaDeadline,
        requiredCertifications: job.requiredCertifications,
        customerTier: job.customerDetails.tier,
        specialRequirements: job.specialRequirements,
      }),
    });
  }
  
  // Mock data for development/testing
  if (mockRecommendations[job.jobId]) {
    return mockRecommendations[job.jobId];
  }
  throw new ApiServiceError('Unable to generate recommendations', 500);
}

/**
 * Submits a vendor override
 * @requirement 5.3 - Allow vendor override
 * @requirement 5.4 - Require override reason
 */
export async function submitOverride(
  override: OverrideRequest
): Promise<OverrideResponse> {
  // In production, call the real API
  if (!USE_MOCK_DATA) {
    return apiRequest<OverrideResponse>('/overrides', {
      method: 'POST',
      body: JSON.stringify(override),
    });
  }

  // Mock validation and response for development/testing
  if (!override.overrideReason || override.overrideReason.trim().length === 0) {
    throw new ApiServiceError('Override reason is required', 400, {
      error: 'ValidationError',
      message: 'Override reason is required',
      details: [{ field: 'overrideReason', message: 'Override reason is required', code: 'required' }],
    });
  }
  if (override.overrideReason.trim().length < 10) {
    throw new ApiServiceError('Override reason must be at least 10 characters', 400, {
      error: 'ValidationError',
      message: 'Override reason must be at least 10 characters',
      details: [{ field: 'overrideReason', message: 'Please provide a more detailed reason (at least 10 characters)', code: 'min_length' }],
    });
  }

  return {
    overrideId: `override-${Date.now()}`,
    jobId: override.jobId,
    originalVendorId: override.originalVendorId,
    selectedVendorId: override.selectedVendorId,
    operatorId: 'operator-001',
    overrideReason: override.overrideReason,
    overrideCategory: override.overrideCategory,
    recordedAt: new Date().toISOString(),
    correlationId: `corr-${Date.now()}`,
  };
}

/**
 * Accepts a vendor recommendation
 * @requirement 5.2 - Accept recommendation
 */
export async function acceptRecommendation(
  jobId: string,
  vendorId: string
): Promise<void> {
  // In production, call the real API
  if (!USE_MOCK_DATA) {
    await apiRequest<void>(`/jobs/${jobId}/accept`, {
      method: 'POST',
      body: JSON.stringify({ vendorId }),
    });
    return;
  }
  
  // Mock for development/testing
  console.log(`[MOCK] Accepting vendor ${vendorId} for job ${jobId}`);
}
