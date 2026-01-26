/**
 * Property 20: Authentication Enforcement
 *
 * For any API request without a valid Azure AD token, the system SHALL return
 * a 401 Unauthorized response without processing the request.
 *
 * @validates Requirements 11.1
 * @file src/backend/api/src/middleware/auth.ts
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  extractBearerToken,
  validateTokenStructure,
  validateToken,
  createMockToken,
  type AuthConfig,
} from '../../src/backend/api/src/middleware/auth.js';

// Property test configuration
const propertyConfig = {
  numRuns: 100,
  verbose: false,
};

// Test auth config
const testAuthConfig: AuthConfig = {
  tenantId: 'test-tenant',
  clientId: 'test-client',
  audience: 'api://retailfixit',
  skipAuth: false,
};

describe('Property 20: Authentication Enforcement', () => {
  /**
   * **Validates: Requirements 11.1**
   *
   * Missing Authorization header should return null token.
   */
  describe('Bearer Token Extraction', () => {
    it('missing Authorization header should return null', () => {
      expect(extractBearerToken(undefined)).toBeNull();
    });

    it('empty Authorization header should return null', () => {
      expect(extractBearerToken('')).toBeNull();
    });

    it('non-Bearer scheme should return null', () => {
      fc.assert(
        fc.property(
          fc.constantFrom('Basic', 'Digest', 'NTLM', 'Negotiate'),
          fc.string({ minLength: 10, maxLength: 100 }),
          (scheme, token) => {
            const header = `${scheme} ${token}`;
            expect(extractBearerToken(header)).toBeNull();
          }
        ),
        propertyConfig
      );
    });

    it('valid Bearer header should extract token', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 10, maxLength: 500 }).filter((s) => !s.includes(' ')),
          (token) => {
            const header = `Bearer ${token}`;
            expect(extractBearerToken(header)).toBe(token);
          }
        ),
        propertyConfig
      );
    });

    it('Bearer header is case-insensitive', () => {
      fc.assert(
        fc.property(
          fc.constantFrom('bearer', 'Bearer', 'BEARER', 'BeArEr'),
          fc.string({ minLength: 10, maxLength: 100 }).filter((s) => !s.includes(' ')),
          (scheme, token) => {
            const header = `${scheme} ${token}`;
            expect(extractBearerToken(header)).toBe(token);
          }
        ),
        propertyConfig
      );
    });

    it('malformed Bearer header (no space) should return null', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 10, maxLength: 100 }).filter((s) => !s.includes(' ')),
          (token) => {
            const header = `Bearer${token}`; // No space
            expect(extractBearerToken(header)).toBeNull();
          }
        ),
        propertyConfig
      );
    });
  });

  /**
   * **Validates: Requirements 11.1**
   *
   * Token structure validation.
   */
  describe('Token Structure Validation', () => {
    it('valid JWT structure (3 parts) should pass', () => {
      fc.assert(
        fc.property(
          fc.stringOf(fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'.split('')), { minLength: 5, maxLength: 50 }),
          fc.stringOf(fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'.split('')), { minLength: 5, maxLength: 100 }),
          fc.stringOf(fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'.split('')), { minLength: 5, maxLength: 50 }),
          (header, payload, signature) => {
            const token = `${header}.${payload}.${signature}`;
            expect(validateTokenStructure(token)).toBe(true);
          }
        ),
        propertyConfig
      );
    });

    it('invalid JWT structure (not 3 parts) should fail', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.split('.').length !== 3),
            fc.constant('header.payload'), // 2 parts
            fc.constant('header.payload.signature.extra'), // 4 parts
            fc.constant('single-part'),
          ),
          (invalidToken) => {
            expect(validateTokenStructure(invalidToken)).toBe(false);
          }
        ),
        propertyConfig
      );
    });

    it('JWT with invalid base64url characters should fail', () => {
      fc.assert(
        fc.property(
          fc.constantFrom('header!.payload.signature', 'header.pay@load.signature', 'header.payload.sig#nature'),
          (invalidToken) => {
            expect(validateTokenStructure(invalidToken)).toBe(false);
          }
        ),
        propertyConfig
      );
    });
  });

  /**
   * **Validates: Requirements 11.1**
   *
   * Token validation with mock tokens.
   */
  describe('Token Validation', () => {
    it('valid mock token should pass validation', () => {
      const token = createMockToken({
        userId: 'test-user-id',
        email: 'test@example.com',
        name: 'Test User',
        roles: ['Operator'],
      });

      const result = validateToken(token, testAuthConfig);
      expect(result.valid).toBe(true);
      expect(result.user).toBeDefined();
      expect(result.user?.userId).toBe('test-user-id');
    });

    it('expired token should fail validation', () => {
      // Create a token that's already expired
      const header = { alg: 'RS256', typ: 'JWT' };
      const payload = {
        sub: 'test-user',
        aud: 'api://retailfixit',
        iat: Math.floor(Date.now() / 1000) - 7200, // 2 hours ago
        exp: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago (expired)
      };

      const encodeBase64Url = (obj: object) =>
        Buffer.from(JSON.stringify(obj)).toString('base64url');

      const token = `${encodeBase64Url(header)}.${encodeBase64Url(payload)}.mock-signature`;

      const result = validateToken(token, testAuthConfig);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('expired');
    });

    it('token with wrong audience should fail validation', () => {
      const header = { alg: 'RS256', typ: 'JWT' };
      const payload = {
        sub: 'test-user',
        aud: 'wrong-audience', // Wrong audience
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      };

      const encodeBase64Url = (obj: object) =>
        Buffer.from(JSON.stringify(obj)).toString('base64url');

      const token = `${encodeBase64Url(header)}.${encodeBase64Url(payload)}.mock-signature`;

      const result = validateToken(token, testAuthConfig);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('audience');
    });

    it('token missing required claims should fail validation', () => {
      fc.assert(
        fc.property(
          fc.constantFrom('sub', 'aud', 'exp', 'iat'),
          (missingClaim) => {
            const header = { alg: 'RS256', typ: 'JWT' };
            const payload: Record<string, unknown> = {
              sub: 'test-user',
              aud: 'api://retailfixit',
              iat: Math.floor(Date.now() / 1000),
              exp: Math.floor(Date.now() / 1000) + 3600,
            };

            delete payload[missingClaim];

            const encodeBase64Url = (obj: object) =>
              Buffer.from(JSON.stringify(obj)).toString('base64url');

            const token = `${encodeBase64Url(header)}.${encodeBase64Url(payload)}.mock-signature`;

            const result = validateToken(token, testAuthConfig);
            expect(result.valid).toBe(false);
            expect(result.error).toContain(missingClaim);
          }
        ),
        propertyConfig
      );
    });

    it('completely invalid token should fail validation', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 100 }).filter((s) => {
            // Filter out strings that could be valid JWT structure
            const parts = s.split('.');
            return parts.length !== 3;
          }),
          (invalidToken) => {
            const result = validateToken(invalidToken, testAuthConfig);
            expect(result.valid).toBe(false);
          }
        ),
        propertyConfig
      );
    });
  });

  /**
   * **Validates: Requirements 11.1**
   *
   * Role extraction from token claims.
   */
  describe('Role Extraction', () => {
    it('token with roles claim should extract roles', () => {
      fc.assert(
        fc.property(
          fc.subarray(['Operator', 'Admin', 'MLEngineer', 'Auditor'], { minLength: 1 }),
          (roles) => {
            const token = createMockToken({
              userId: 'test-user',
              roles: roles as ('Operator' | 'Admin' | 'MLEngineer' | 'Auditor')[],
            });

            const result = validateToken(token, testAuthConfig);
            expect(result.valid).toBe(true);
            expect(result.user?.roles).toEqual(expect.arrayContaining(roles));
          }
        ),
        propertyConfig
      );
    });

    it('token without roles should default to Operator', () => {
      const header = { alg: 'RS256', typ: 'JWT' };
      const payload = {
        sub: 'test-user',
        aud: 'api://retailfixit',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
        // No roles claim
      };

      const encodeBase64Url = (obj: object) =>
        Buffer.from(JSON.stringify(obj)).toString('base64url');

      const token = `${encodeBase64Url(header)}.${encodeBase64Url(payload)}.mock-signature`;

      const result = validateToken(token, testAuthConfig);
      expect(result.valid).toBe(true);
      expect(result.user?.roles).toContain('Operator');
    });
  });
});
