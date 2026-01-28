/**
 * Load and Performance Tests for RetailFixIt Vendor Scoring Service
 *
 * Uses k6 for load testing the API endpoints.
 * Run with: k6 run tests/load/scoring-load-test.js
 *
 * @requirement 14.5 - Load tests validating performance under expected traffic
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';
import { randomUUID } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

// Custom metrics
const recommendationLatency = new Trend('recommendation_latency', true);
const overrideLatency = new Trend('override_latency', true);
const errorRate = new Rate('error_rate');
const successfulRequests = new Counter('successful_requests');
const failedRequests = new Counter('failed_requests');

// Test configuration
export const options = {
  scenarios: {
    // Sustained load test: 100 requests/second for 5 minutes
    sustained_load: {
      executor: 'constant-arrival-rate',
      rate: 100,
      timeUnit: '1s',
      duration: '5m',
      preAllocatedVUs: 50,
      maxVUs: 200,
    },
    // Spike test: sudden increase in traffic
    spike_test: {
      executor: 'ramping-arrival-rate',
      startRate: 10,
      timeUnit: '1s',
      preAllocatedVUs: 50,
      maxVUs: 300,
      stages: [
        { duration: '1m', target: 10 },   // Warm up
        { duration: '30s', target: 200 }, // Spike to 200 req/s
        { duration: '1m', target: 200 },  // Stay at 200 req/s
        { duration: '30s', target: 10 },  // Scale down
        { duration: '1m', target: 10 },   // Cool down
      ],
      startTime: '6m', // Start after sustained load test
    },
    // Stress test: find breaking point
    stress_test: {
      executor: 'ramping-arrival-rate',
      startRate: 50,
      timeUnit: '1s',
      preAllocatedVUs: 100,
      maxVUs: 500,
      stages: [
        { duration: '2m', target: 50 },   // Normal load
        { duration: '2m', target: 150 },  // Increase
        { duration: '2m', target: 300 },  // High load
        { duration: '2m', target: 500 },  // Stress
        { duration: '2m', target: 50 },   // Recovery
      ],
      startTime: '11m', // Start after spike test
    },
  },
  thresholds: {
    // p99 latency should be under 2 seconds
    'recommendation_latency': ['p(99)<2000'],
    'override_latency': ['p(99)<2000'],
    // Error rate should be under 1%
    'error_rate': ['rate<0.01'],
    // HTTP request duration p95 under 1.5 seconds
    'http_req_duration': ['p(95)<1500', 'p(99)<2000'],
    // HTTP request failures under 1%
    'http_req_failed': ['rate<0.01'],
  },
};

// Base URL - configure for your environment
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

// Generate random test data
function generateRecommendationRequest() {
  return {
    jobId: randomUUID(),
    jobType: ['repair', 'installation', 'maintenance', 'inspection'][Math.floor(Math.random() * 4)],
    location: {
      latitude: 40.7128 + (Math.random() - 0.5) * 0.1,
      longitude: -74.006 + (Math.random() - 0.5) * 0.1,
      address: `${Math.floor(Math.random() * 1000)} Main St`,
      city: 'New York',
      state: 'NY',
      zipCode: `${10000 + Math.floor(Math.random() * 90000)}`.slice(0, 5),
      serviceRegion: 'northeast',
    },
    urgencyLevel: ['low', 'medium', 'high', 'critical'][Math.floor(Math.random() * 4)],
    slaDeadline: new Date(Date.now() + Math.random() * 86400000 * 7).toISOString(),
    requiredCertifications: ['HVAC', 'Electrical', 'Plumbing'].slice(0, Math.floor(Math.random() * 3) + 1),
    customerTier: ['standard', 'premium', 'enterprise'][Math.floor(Math.random() * 3)],
  };
}

function generateOverrideRequest() {
  return {
    jobId: randomUUID(),
    originalVendorId: randomUUID(),
    selectedVendorId: randomUUID(),
    overrideReason: `Load test override reason - ${Date.now()} - Customer requested specific vendor due to prior relationship and satisfaction with previous work.`,
    overrideCategory: ['preference', 'availability', 'relationship', 'other'][Math.floor(Math.random() * 4)],
  };
}

// Main test function
export default function () {
  const correlationId = randomUUID();
  const headers = {
    'Content-Type': 'application/json',
    'X-Correlation-ID': correlationId,
  };

  group('Recommendation API', () => {
    const requestBody = JSON.stringify(generateRecommendationRequest());
    const startTime = Date.now();

    const response = http.post(
      `${BASE_URL}/api/v1/recommendations`,
      requestBody,
      { headers, tags: { name: 'recommendation' } }
    );

    const latency = Date.now() - startTime;
    recommendationLatency.add(latency);

    const success = check(response, {
      'recommendation status is 200': (r) => r.status === 200,
      'recommendation has recommendations array': (r) => {
        try {
          const body = JSON.parse(r.body);
          return Array.isArray(body.recommendations);
        } catch {
          return false;
        }
      },
      'recommendation latency under 2s': () => latency < 2000,
      'correlation ID in response': (r) => r.headers['X-Correlation-Id'] === correlationId,
    });

    if (success) {
      successfulRequests.add(1);
      errorRate.add(0);
    } else {
      failedRequests.add(1);
      errorRate.add(1);
    }
  });

  // Small delay between requests
  sleep(0.1);

  // Occasionally test override endpoint (10% of requests)
  if (Math.random() < 0.1) {
    group('Override API', () => {
      const requestBody = JSON.stringify(generateOverrideRequest());
      const startTime = Date.now();

      const response = http.post(
        `${BASE_URL}/api/v1/overrides`,
        requestBody,
        { headers, tags: { name: 'override' } }
      );

      const latency = Date.now() - startTime;
      overrideLatency.add(latency);

      const success = check(response, {
        'override status is 201': (r) => r.status === 201,
        'override has overrideId': (r) => {
          try {
            const body = JSON.parse(r.body);
            return body.overrideId !== undefined;
          } catch {
            return false;
          }
        },
        'override latency under 2s': () => latency < 2000,
      });

      if (success) {
        successfulRequests.add(1);
        errorRate.add(0);
      } else {
        failedRequests.add(1);
        errorRate.add(1);
      }
    });
  }

  // Test health endpoint periodically (5% of requests)
  if (Math.random() < 0.05) {
    group('Health Check', () => {
      const response = http.get(`${BASE_URL}/health`, {
        tags: { name: 'health' },
      });

      check(response, {
        'health status is 200': (r) => r.status === 200,
        'health status is healthy': (r) => {
          try {
            const body = JSON.parse(r.body);
            return body.status === 'healthy';
          } catch {
            return false;
          }
        },
      });
    });
  }
}

// Setup function - runs once before the test
export function setup() {
  console.log(`Starting load test against ${BASE_URL}`);
  
  // Verify the service is up
  const healthResponse = http.get(`${BASE_URL}/health`);
  if (healthResponse.status !== 200) {
    throw new Error(`Service not healthy: ${healthResponse.status}`);
  }
  
  console.log('Service is healthy, starting load test...');
  return { startTime: Date.now() };
}

// Teardown function - runs once after the test
export function teardown(data) {
  const duration = (Date.now() - data.startTime) / 1000;
  console.log(`Load test completed in ${duration.toFixed(2)} seconds`);
}

// Handle summary
export function handleSummary(data) {
  const summary = {
    timestamp: new Date().toISOString(),
    duration: data.state.testRunDurationMs,
    metrics: {
      recommendation_latency: {
        avg: data.metrics.recommendation_latency?.values?.avg,
        p95: data.metrics.recommendation_latency?.values['p(95)'],
        p99: data.metrics.recommendation_latency?.values['p(99)'],
      },
      override_latency: {
        avg: data.metrics.override_latency?.values?.avg,
        p95: data.metrics.override_latency?.values['p(95)'],
        p99: data.metrics.override_latency?.values['p(99)'],
      },
      http_req_duration: {
        avg: data.metrics.http_req_duration?.values?.avg,
        p95: data.metrics.http_req_duration?.values['p(95)'],
        p99: data.metrics.http_req_duration?.values['p(99)'],
      },
      error_rate: data.metrics.error_rate?.values?.rate,
      successful_requests: data.metrics.successful_requests?.values?.count,
      failed_requests: data.metrics.failed_requests?.values?.count,
    },
    thresholds: data.thresholds,
  };

  return {
    'tests/load/results/summary.json': JSON.stringify(summary, null, 2),
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
  };
}

// Text summary helper
function textSummary(data, options) {
  const lines = [];
  lines.push('\n========== LOAD TEST SUMMARY ==========\n');
  
  if (data.metrics.recommendation_latency) {
    lines.push('Recommendation API Latency:');
    lines.push(`  avg: ${data.metrics.recommendation_latency.values.avg?.toFixed(2)}ms`);
    lines.push(`  p95: ${data.metrics.recommendation_latency.values['p(95)']?.toFixed(2)}ms`);
    lines.push(`  p99: ${data.metrics.recommendation_latency.values['p(99)']?.toFixed(2)}ms`);
  }
  
  if (data.metrics.override_latency) {
    lines.push('\nOverride API Latency:');
    lines.push(`  avg: ${data.metrics.override_latency.values.avg?.toFixed(2)}ms`);
    lines.push(`  p95: ${data.metrics.override_latency.values['p(95)']?.toFixed(2)}ms`);
    lines.push(`  p99: ${data.metrics.override_latency.values['p(99)']?.toFixed(2)}ms`);
  }
  
  if (data.metrics.error_rate) {
    lines.push(`\nError Rate: ${(data.metrics.error_rate.values.rate * 100).toFixed(2)}%`);
  }
  
  if (data.metrics.successful_requests) {
    lines.push(`Successful Requests: ${data.metrics.successful_requests.values.count}`);
  }
  
  if (data.metrics.failed_requests) {
    lines.push(`Failed Requests: ${data.metrics.failed_requests.values.count}`);
  }
  
  lines.push('\n========================================\n');
  
  return lines.join('\n');
}
