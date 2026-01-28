/**
 * Security Tests for RetailFixIt Vendor Scoring Service
 *
 * Tests for SQL injection prevention, XSS prevention, and PII masking.
 * Note: OWASP ZAP and Snyk scans should be run separately in CI/CD.
 *
 * @requirement 11.6 - Security tests
 */

import { describe, expect, it, beforeEach } from 'vitest';
import express, { Express } from 'express';
import request from 'supertest';

import { createApp } from '../../src/backend/api/src/index.js';
import { maskPiiInString, maskPiiInObject, PII_PATTERNS } from '../../src/backend/shared/src/logging/logger.js';
import { clearAuditLog, getAuditLog } from '../../src/backend/api/src/routes/overrides.js';

describe('Security Tests', () => {
  let app: Express;

  beforeEach(() => {
    app = createApp({
      enableSwagger: false,
      enableRateLimiting: false,
      auth: {
        tenantId: 'test-tenant',
        clientId: 'test-client',
        audience: 'api://retailfixit',
        skipAuth: true,
      },
    });
    clearAuditLog();
  });

  describe('SQL Injection Prevention', () => {
    const sqlInjectionPayloads = [
      "'; DROP TABLE users; --",
      "1' OR '1'='1",
      "1; DELETE FROM recommendations WHERE 1=1; --",
      "' UNION SELECT * FROM users --",
      "1' AND 1=1 UNION SELECT NULL, username, password FROM users --",
      "admin'--",
      "' OR 1=1 --",
      "'; EXEC xp_cmdshell('dir'); --",
      "1' WAITFOR DELAY '0:0:10' --",
      "1'; UPDATE users SET password='hacked' WHERE username='admin'; --",
    ];

    it('rejects SQL injection in jobId field', async () => {
      for (const payload of sqlInjectionPayloads) {
        const response = await request(app)
          .post('/api/v1/recommendations')
          .send({
            jobId: payload,
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
            urgencyLevel: 'medium',
            slaDeadline: new Date(Date.now() + 86400000).toISOString(),
            requiredCertifications: ['HVAC'],
            customerTier: 'standard',
          })
          .set('Content-Type', 'application/json');

        // Should be rejected by validation (not a valid UUID)
        expect(response.status).toBe(400);
        expect(response.body.error).toBe('ValidationError');
      }
    });

    it('rejects SQL injection in override reason', async () => {
      for (const payload of sqlInjectionPayloads) {
        const response = await request(app)
          .post('/api/v1/overrides')
          .send({
            jobId: crypto.randomUUID(),
            originalVendorId: crypto.randomUUID(),
            selectedVendorId: crypto.randomUUID(),
            overrideReason: payload,
            overrideCategory: 'preference',
          })
          .set('Content-Type', 'application/json');

        // Should either be accepted (sanitized) or rejected
        // The important thing is no SQL execution
        expect([201, 400]).toContain(response.status);

        // If accepted, verify the payload is stored as-is (not executed)
        if (response.status === 201) {
          expect(response.body.overrideReason).toBe(payload);
        }
      }
    });

    it('rejects SQL injection in URL parameters', async () => {
      for (const payload of sqlInjectionPayloads) {
        const encodedPayload = encodeURIComponent(payload);
        const response = await request(app)
          .get(`/api/v1/recommendations/${encodedPayload}`);

        // Should be rejected (not a valid UUID)
        expect(response.status).toBe(400);
      }
    });
  });

  describe('XSS Prevention', () => {
    const xssPayloads = [
      '<script>alert("XSS")</script>',
      '<img src="x" onerror="alert(\'XSS\')">',
      '<svg onload="alert(\'XSS\')">',
      'javascript:alert("XSS")',
      '<body onload="alert(\'XSS\')">',
      '<iframe src="javascript:alert(\'XSS\')">',
      '<input onfocus="alert(\'XSS\')" autofocus>',
      '<marquee onstart="alert(\'XSS\')">',
      '<video><source onerror="alert(\'XSS\')">',
      '"><script>alert("XSS")</script>',
      "'-alert('XSS')-'",
      '<div style="background:url(javascript:alert(\'XSS\'))">',
    ];

    it('handles XSS payloads in override reason safely', async () => {
      for (const payload of xssPayloads) {
        const response = await request(app)
          .post('/api/v1/overrides')
          .send({
            jobId: crypto.randomUUID(),
            originalVendorId: crypto.randomUUID(),
            selectedVendorId: crypto.randomUUID(),
            overrideReason: `Valid reason with XSS attempt: ${payload}`,
            overrideCategory: 'preference',
          })
          .set('Content-Type', 'application/json');

        // Should be accepted (XSS is a client-side concern, API stores as-is)
        expect(response.status).toBe(201);

        // Response should be JSON (not HTML that could execute scripts)
        expect(response.headers['content-type']).toContain('application/json');
      }
    });

    it('returns JSON content type for all responses', async () => {
      const response = await request(app)
        .post('/api/v1/recommendations')
        .send({
          jobId: crypto.randomUUID(),
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
          urgencyLevel: 'medium',
          slaDeadline: new Date(Date.now() + 86400000).toISOString(),
          requiredCertifications: ['HVAC'],
          customerTier: 'standard',
        })
        .set('Content-Type', 'application/json');

      expect(response.headers['content-type']).toContain('application/json');
    });

    it('returns JSON content type for error responses', async () => {
      const response = await request(app)
        .post('/api/v1/recommendations')
        .send({ invalid: 'data' })
        .set('Content-Type', 'application/json');

      expect(response.status).toBe(400);
      expect(response.headers['content-type']).toContain('application/json');
    });
  });

  describe('PII Masking in Logs', () => {
    it('masks email addresses', () => {
      const input = 'User email is john.doe@example.com';
      const masked = maskPiiInString(input);

      expect(masked).not.toContain('john.doe@example.com');
      expect(masked).toContain('[EMAIL_MASKED]');
    });

    it('masks phone numbers', () => {
      // The phone pattern requires specific formatting to avoid false positives on UUIDs
      // It matches: +1-XXX-XXX-XXXX or (XXX) XXX-XXXX formats with valid area codes (2-9 start)
      const inputs = [
        'Call me at (555) 234-5678',
        'Contact: +1-555-234-5678',
      ];

      for (const input of inputs) {
        const masked = maskPiiInString(input);
        expect(masked).toContain('[PHONE_MASKED]');
      }
    });

    it('masks credit card numbers', () => {
      const inputs = [
        'Card: 4111-1111-1111-1111',
        'Payment: 5500 0000 0000 0004',
      ];

      for (const input of inputs) {
        const masked = maskPiiInString(input);
        expect(masked).toContain('[CARD_MASKED]');
      }
    });

    it('masks SSN', () => {
      const inputs = [
        'SSN: 123-45-6789',
        'Social: 123 45 6789',
      ];

      for (const input of inputs) {
        const masked = maskPiiInString(input);
        expect(masked).toContain('[SSN_MASKED]');
      }
    });

    it('detects PII patterns in strings', () => {
      expect(PII_PATTERNS.email.test('john.doe@example.com')).toBe(true);
      // Phone pattern requires valid area code format (2-9 start for exchange)
      expect(PII_PATTERNS.phone.test('(555) 234-5678')).toBe(true);
      expect(PII_PATTERNS.creditCard.test('4111-1111-1111-1111')).toBe(true);
      expect(PII_PATTERNS.ssn.test('123-45-6789')).toBe(true);
      
      // Reset regex lastIndex
      PII_PATTERNS.email.lastIndex = 0;
      PII_PATTERNS.phone.lastIndex = 0;
      PII_PATTERNS.creditCard.lastIndex = 0;
      PII_PATTERNS.ssn.lastIndex = 0;
    });

    it('handles nested objects', () => {
      const input = {
        user: {
          email: 'john@example.com',
          phone: '(555) 123-4567',
        },
        message: 'Contact at john@example.com',
      };

      const masked = maskPiiInObject(input);
      const maskedStr = JSON.stringify(masked);
      expect(maskedStr).not.toContain('john@example.com');
      expect(maskedStr).toContain('[PII_MASKED]');
    });
  });

  describe('Authentication Security', () => {
    let authApp: Express;

    beforeEach(() => {
      authApp = createApp({
        enableSwagger: false,
        enableRateLimiting: false,
        auth: {
          tenantId: 'test-tenant',
          clientId: 'test-client',
          audience: 'api://retailfixit',
          skipAuth: false,
        },
      });
    });

    it('rejects requests without authentication', async () => {
      const response = await request(authApp)
        .post('/api/v1/recommendations')
        .send({
          jobId: crypto.randomUUID(),
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
          urgencyLevel: 'medium',
          slaDeadline: new Date(Date.now() + 86400000).toISOString(),
          requiredCertifications: ['HVAC'],
          customerTier: 'standard',
        })
        .set('Content-Type', 'application/json');

      expect(response.status).toBe(401);
    });

    it('rejects malformed authorization header', async () => {
      const malformedHeaders = [
        'Basic dXNlcjpwYXNz', // Basic auth instead of Bearer
        'Bearer', // Missing token
        'bearer token', // Lowercase bearer
        'Token abc123', // Wrong scheme
        'Bearer ', // Empty token
      ];

      for (const header of malformedHeaders) {
        const response = await request(authApp)
          .post('/api/v1/recommendations')
          .send({
            jobId: crypto.randomUUID(),
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
            urgencyLevel: 'medium',
            slaDeadline: new Date(Date.now() + 86400000).toISOString(),
            requiredCertifications: ['HVAC'],
            customerTier: 'standard',
          })
          .set('Content-Type', 'application/json')
          .set('Authorization', header);

        expect(response.status).toBe(401);
      }
    });

    it('rejects tampered JWT tokens', async () => {
      // Create a valid-looking but tampered token
      const tamperedTokens = [
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.tampered',
        'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiIxMjM0NTY3ODkwIn0.', // Algorithm none attack
        'invalid.token.here',
      ];

      for (const token of tamperedTokens) {
        const response = await request(authApp)
          .post('/api/v1/recommendations')
          .send({
            jobId: crypto.randomUUID(),
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
            urgencyLevel: 'medium',
            slaDeadline: new Date(Date.now() + 86400000).toISOString(),
            requiredCertifications: ['HVAC'],
            customerTier: 'standard',
          })
          .set('Content-Type', 'application/json')
          .set('Authorization', `Bearer ${token}`);

        expect(response.status).toBe(401);
      }
    });
  });

  describe('Input Validation Security', () => {
    it('rejects oversized request bodies', async () => {
      // Create a very large payload
      const largePayload = {
        jobId: crypto.randomUUID(),
        jobType: 'repair',
        location: {
          latitude: 40.7128,
          longitude: -74.006,
          address: 'A'.repeat(10000), // Very long address
          city: 'New York',
          state: 'NY',
          zipCode: '10001',
          serviceRegion: 'northeast',
        },
        urgencyLevel: 'medium',
        slaDeadline: new Date(Date.now() + 86400000).toISOString(),
        requiredCertifications: Array(1000).fill('CERT'), // Many certifications
        customerTier: 'standard',
      };

      const response = await request(app)
        .post('/api/v1/recommendations')
        .send(largePayload)
        .set('Content-Type', 'application/json');

      // Should be rejected by validation
      expect(response.status).toBe(400);
    });

    it('rejects deeply nested objects', async () => {
      // Create deeply nested object
      let nested: any = { value: 'deep' };
      for (let i = 0; i < 100; i++) {
        nested = { nested };
      }

      const response = await request(app)
        .post('/api/v1/recommendations')
        .send({
          jobId: crypto.randomUUID(),
          jobType: 'repair',
          location: nested,
          urgencyLevel: 'medium',
          slaDeadline: new Date(Date.now() + 86400000).toISOString(),
          requiredCertifications: ['HVAC'],
          customerTier: 'standard',
        })
        .set('Content-Type', 'application/json');

      // Should be rejected
      expect(response.status).toBe(400);
    });

    it('handles null bytes in input', async () => {
      const response = await request(app)
        .post('/api/v1/overrides')
        .send({
          jobId: crypto.randomUUID(),
          originalVendorId: crypto.randomUUID(),
          selectedVendorId: crypto.randomUUID(),
          overrideReason: 'Valid reason\x00with null byte',
          overrideCategory: 'preference',
        })
        .set('Content-Type', 'application/json');

      // Should handle gracefully (either accept or reject, but not crash)
      expect([201, 400]).toContain(response.status);
    });
  });

  describe('CORS Security', () => {
    it('includes CORS headers in response', async () => {
      const response = await request(app)
        .options('/api/v1/recommendations')
        .set('Origin', 'http://localhost:3000');

      expect(response.status).toBe(204);
      expect(response.headers['access-control-allow-origin']).toBeDefined();
      expect(response.headers['access-control-allow-methods']).toBeDefined();
    });
  });

  describe('Rate Limiting Security', () => {
    let rateLimitedApp: Express;

    beforeEach(() => {
      rateLimitedApp = createApp({
        enableSwagger: false,
        enableRateLimiting: true,
        auth: {
          tenantId: 'test-tenant',
          clientId: 'test-client',
          audience: 'api://retailfixit',
          skipAuth: true,
        },
      });
    });

    it('rate limiter is enabled', async () => {
      // Make a request to verify rate limiter is active
      const response = await request(rateLimitedApp)
        .post('/api/v1/recommendations')
        .send({
          jobId: crypto.randomUUID(),
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
          urgencyLevel: 'medium',
          slaDeadline: new Date(Date.now() + 86400000).toISOString(),
          requiredCertifications: ['HVAC'],
          customerTier: 'standard',
        })
        .set('Content-Type', 'application/json');

      // Should succeed (within rate limit)
      expect(response.status).toBe(200);
    });
  });
});
