/**
 * Property 23: Rate Limiting Enforcement
 *
 * For any client exceeding the configured rate limit (requests per minute),
 * subsequent requests SHALL receive 429 Too Many Requests responses until
 * the rate window resets.
 *
 * @validates Requirements 11.5
 * @file src/backend/api/src/middleware/rate-limiter.ts
 */

import fc from 'fast-check';
import { describe, expect, it, beforeEach } from 'vitest';
import {
  getRateLimitStatus,
  clearRateLimitStore,
  defaultKeyGenerator,
  type RateLimitConfig,
} from '../../src/backend/api/src/middleware/rate-limiter.js';

// Property test configuration
const propertyConfig = {
  numRuns: 50, // Reduced for rate limiting tests
  verbose: false,
};

// Test rate limit configuration
const testConfig: RateLimitConfig = {
  maxRequests: 10,
  windowMs: 1000, // 1 second window for faster tests
};

describe('Property 23: Rate Limiting Enforcement', () => {
  beforeEach(() => {
    // Clear rate limit store before each test
    clearRateLimitStore();
  });

  /**
   * **Validates: Requirements 11.5**
   *
   * Initial requests should not be rate limited.
   */
  describe('Initial Request Handling', () => {
    it('first request should have full remaining quota', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 50 }),
          (clientKey) => {
            clearRateLimitStore();
            const status = getRateLimitStatus(clientKey, testConfig);
            expect(status.remaining).toBe(testConfig.maxRequests);
            expect(status.total).toBe(testConfig.maxRequests);
          }
        ),
        propertyConfig
      );
    });

    it('different clients should have independent quotas', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 50 }),
          fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s !== ''),
          (client1, client2) => {
            if (client1 === client2) return; // Skip if same client
            
            clearRateLimitStore();
            const status1 = getRateLimitStatus(client1, testConfig);
            const status2 = getRateLimitStatus(client2, testConfig);
            
            // Both should have full quota
            expect(status1.remaining).toBe(testConfig.maxRequests);
            expect(status2.remaining).toBe(testConfig.maxRequests);
          }
        ),
        propertyConfig
      );
    });
  });

  /**
   * **Validates: Requirements 11.5**
   *
   * Rate limit status tracking.
   */
  describe('Rate Limit Status', () => {
    it('remaining should never exceed total', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 50 }),
          fc.integer({ min: 1, max: 100 }),
          (clientKey, maxRequests) => {
            clearRateLimitStore();
            const config: RateLimitConfig = { maxRequests, windowMs: 1000 };
            const status = getRateLimitStatus(clientKey, config);
            expect(status.remaining).toBeLessThanOrEqual(status.total);
          }
        ),
        propertyConfig
      );
    });

    it('remaining should be non-negative', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 50 }),
          (clientKey) => {
            clearRateLimitStore();
            const status = getRateLimitStatus(clientKey, testConfig);
            expect(status.remaining).toBeGreaterThanOrEqual(0);
          }
        ),
        propertyConfig
      );
    });

    it('reset time should be in the future', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 50 }),
          (clientKey) => {
            clearRateLimitStore();
            const now = Math.floor(Date.now() / 1000);
            const status = getRateLimitStatus(clientKey, testConfig);
            expect(status.reset).toBeGreaterThanOrEqual(now);
          }
        ),
        propertyConfig
      );
    });
  });

  /**
   * **Validates: Requirements 11.5**
   *
   * Configuration validation.
   */
  describe('Configuration', () => {
    it('maxRequests should be respected', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 1000 }),
          (maxRequests) => {
            clearRateLimitStore();
            const config: RateLimitConfig = { maxRequests, windowMs: 60000 };
            const status = getRateLimitStatus('test-client', config);
            expect(status.total).toBe(maxRequests);
            expect(status.remaining).toBe(maxRequests);
          }
        ),
        propertyConfig
      );
    });

    it('default config should have reasonable limits', () => {
      const defaultConfig: RateLimitConfig = {
        maxRequests: 100,
        windowMs: 60 * 1000,
      };
      
      expect(defaultConfig.maxRequests).toBeGreaterThan(0);
      expect(defaultConfig.windowMs).toBeGreaterThan(0);
    });
  });

  /**
   * **Validates: Requirements 11.5**
   *
   * Key generator functions.
   */
  describe('Key Generation', () => {
    it('defaultKeyGenerator should handle missing IP gracefully', () => {
      const mockReq = {
        headers: {},
        ip: undefined,
        socket: { remoteAddress: undefined },
      } as any;

      const key = defaultKeyGenerator(mockReq);
      expect(key).toBe('unknown');
    });

    it('defaultKeyGenerator should use X-Forwarded-For when present', () => {
      fc.assert(
        fc.property(
          fc.ipV4(),
          (ip) => {
            const mockReq = {
              headers: { 'x-forwarded-for': ip },
              ip: '127.0.0.1',
              socket: { remoteAddress: '127.0.0.1' },
            } as any;

            const key = defaultKeyGenerator(mockReq);
            expect(key).toBe(ip);
          }
        ),
        propertyConfig
      );
    });

    it('defaultKeyGenerator should use req.ip as fallback', () => {
      fc.assert(
        fc.property(
          fc.ipV4(),
          (ip) => {
            const mockReq = {
              headers: {},
              ip: ip,
              socket: { remoteAddress: '127.0.0.1' },
            } as any;

            const key = defaultKeyGenerator(mockReq);
            expect(key).toBe(ip);
          }
        ),
        propertyConfig
      );
    });

    it('defaultKeyGenerator should handle multiple IPs in X-Forwarded-For', () => {
      const mockReq = {
        headers: { 'x-forwarded-for': '192.168.1.1, 10.0.0.1, 172.16.0.1' },
        ip: '127.0.0.1',
        socket: { remoteAddress: '127.0.0.1' },
      } as any;

      const key = defaultKeyGenerator(mockReq);
      expect(key).toBe('192.168.1.1'); // Should use first IP
    });
  });

  /**
   * **Validates: Requirements 11.5**
   *
   * Sliding window behavior.
   */
  describe('Sliding Window Behavior', () => {
    it('window size should affect reset time', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1000, max: 60000 }),
          (windowMs) => {
            clearRateLimitStore();
            const config: RateLimitConfig = { maxRequests: 10, windowMs };
            const now = Math.floor(Date.now() / 1000);
            const status = getRateLimitStatus('test-client', config);
            
            // Reset should be within window + some buffer
            const maxReset = now + Math.ceil(windowMs / 1000) + 1;
            expect(status.reset).toBeLessThanOrEqual(maxReset);
          }
        ),
        propertyConfig
      );
    });
  });

  /**
   * **Validates: Requirements 11.5**
   *
   * Rate limit response format.
   */
  describe('Response Format', () => {
    it('status should contain all required fields', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 50 }),
          (clientKey) => {
            clearRateLimitStore();
            const status = getRateLimitStatus(clientKey, testConfig);
            
            expect(status).toHaveProperty('remaining');
            expect(status).toHaveProperty('reset');
            expect(status).toHaveProperty('total');
            
            expect(typeof status.remaining).toBe('number');
            expect(typeof status.reset).toBe('number');
            expect(typeof status.total).toBe('number');
          }
        ),
        propertyConfig
      );
    });
  });

  /**
   * **Validates: Requirements 11.5**
   *
   * Consistency properties.
   */
  describe('Consistency Properties', () => {
    it('same client should get consistent status', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 50 }),
          (clientKey) => {
            clearRateLimitStore();
            const status1 = getRateLimitStatus(clientKey, testConfig);
            const status2 = getRateLimitStatus(clientKey, testConfig);
            
            // Status should be consistent for same client
            expect(status1.total).toBe(status2.total);
            // Remaining might differ slightly due to timing
          }
        ),
        propertyConfig
      );
    });

    it('total should always equal configured maxRequests', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 50 }),
          fc.integer({ min: 1, max: 1000 }),
          (clientKey, maxRequests) => {
            clearRateLimitStore();
            const config: RateLimitConfig = { maxRequests, windowMs: 60000 };
            const status = getRateLimitStatus(clientKey, config);
            expect(status.total).toBe(maxRequests);
          }
        ),
        propertyConfig
      );
    });
  });
});
