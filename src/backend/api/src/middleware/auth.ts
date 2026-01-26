/**
 * Authentication Middleware
 *
 * Validates Azure AD tokens and extracts user roles from token claims.
 *
 * @requirement 11.1 - Azure AD authentication for all API endpoints
 * @property Property 20: Authentication Enforcement
 * @tested tests/property/authentication.property.test.ts
 */

import { Request, Response, NextFunction } from 'express';
import { createErrorResponse } from '../routes/recommendations.js';

/**
 * User roles in the system
 *
 * @requirement 11.2 - Role-based access control
 */
export type UserRole = 'Operator' | 'Admin' | 'MLEngineer' | 'Auditor';

/**
 * Authenticated user information extracted from token
 */
export interface AuthenticatedUser {
  userId: string;
  email: string;
  name: string;
  roles: UserRole[];
  tenantId: string;
  tokenExpiry: Date;
}

/**
 * Extended request with authenticated user
 */
export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

/**
 * Token validation result
 */
export interface TokenValidationResult {
  valid: boolean;
  user?: AuthenticatedUser;
  error?: string;
}

/**
 * Configuration for authentication
 */
export interface AuthConfig {
  /** Azure AD tenant ID */
  tenantId: string;
  /** Azure AD client ID */
  clientId: string;
  /** Audience for token validation */
  audience: string;
  /** Whether to skip authentication (for development) */
  skipAuth?: boolean;
}

/**
 * Default auth configuration (from environment)
 */
export const defaultAuthConfig: AuthConfig = {
  tenantId: process.env.AZURE_AD_TENANT_ID || 'default-tenant',
  clientId: process.env.AZURE_AD_CLIENT_ID || 'default-client',
  audience: process.env.AZURE_AD_AUDIENCE || 'api://retailfixit',
  skipAuth: process.env.SKIP_AUTH === 'true',
};

/**
 * Extracts bearer token from Authorization header
 */
export function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) {
    return null;
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    return null;
  }

  return parts[1];
}

/**
 * Validates a JWT token structure (basic validation)
 * In production, this would verify signature against Azure AD public keys
 */
export function validateTokenStructure(token: string): boolean {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return false;
  }

  // Check each part is valid base64url
  try {
    for (const part of parts) {
      // Basic base64url character check
      if (!/^[A-Za-z0-9_-]+$/.test(part)) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Decodes JWT payload (without verification - for demo purposes)
 * In production, use a proper JWT library with signature verification
 */
export function decodeTokenPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }

    // Decode base64url payload
    const payload = parts[1];
    const decoded = Buffer.from(payload, 'base64url').toString('utf-8');
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

/**
 * Extracts user roles from token claims
 */
export function extractRoles(claims: Record<string, unknown>): UserRole[] {
  const roles: UserRole[] = [];
  
  // Check for roles claim (Azure AD app roles)
  const roleClaim = claims.roles as string[] | undefined;
  if (Array.isArray(roleClaim)) {
    for (const role of roleClaim) {
      if (isValidRole(role)) {
        roles.push(role as UserRole);
      }
    }
  }

  // Check for groups claim as fallback
  const groupsClaim = claims.groups as string[] | undefined;
  if (Array.isArray(groupsClaim) && roles.length === 0) {
    // Map group IDs to roles (would be configured in production)
    // This is a placeholder for group-to-role mapping
  }

  // Default to Operator if no roles found
  if (roles.length === 0) {
    roles.push('Operator');
  }

  return roles;
}

/**
 * Checks if a string is a valid user role
 */
export function isValidRole(role: string): role is UserRole {
  return ['Operator', 'Admin', 'MLEngineer', 'Auditor'].includes(role);
}

/**
 * Validates an Azure AD token
 *
 * @requirement 11.1 - Validate Azure AD tokens
 * @property Property 20: Authentication Enforcement
 */
export function validateToken(token: string, config: AuthConfig = defaultAuthConfig): TokenValidationResult {
  // Check token structure
  if (!validateTokenStructure(token)) {
    return { valid: false, error: 'Invalid token structure' };
  }

  // Decode payload
  const payload = decodeTokenPayload(token);
  if (!payload) {
    return { valid: false, error: 'Failed to decode token payload' };
  }

  // Check required claims
  const requiredClaims = ['sub', 'aud', 'exp', 'iat'];
  for (const claim of requiredClaims) {
    if (!(claim in payload)) {
      return { valid: false, error: `Missing required claim: ${claim}` };
    }
  }

  // Check audience
  if (payload.aud !== config.audience && payload.aud !== config.clientId) {
    return { valid: false, error: 'Invalid audience' };
  }

  // Check expiration
  const exp = payload.exp as number;
  if (exp * 1000 < Date.now()) {
    return { valid: false, error: 'Token has expired' };
  }

  // Extract user information
  const user: AuthenticatedUser = {
    userId: payload.sub as string,
    email: (payload.email as string) || (payload.preferred_username as string) || '',
    name: (payload.name as string) || '',
    roles: extractRoles(payload),
    tenantId: (payload.tid as string) || config.tenantId,
    tokenExpiry: new Date(exp * 1000),
  };

  return { valid: true, user };
}

/**
 * Creates a mock token for development/testing
 */
export function createMockToken(user: Partial<AuthenticatedUser>): string {
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    sub: user.userId || 'mock-user-id',
    email: user.email || 'mock@example.com',
    name: user.name || 'Mock User',
    roles: user.roles || ['Operator'],
    tid: user.tenantId || 'mock-tenant',
    aud: 'api://retailfixit',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour
  };

  const encodeBase64Url = (obj: object) =>
    Buffer.from(JSON.stringify(obj)).toString('base64url');

  return `${encodeBase64Url(header)}.${encodeBase64Url(payload)}.mock-signature`;
}

/**
 * Authentication middleware
 *
 * Validates Azure AD tokens and rejects requests with invalid tokens.
 *
 * @requirement 11.1 - Azure AD authentication for all API endpoints
 * @property Property 20: Authentication Enforcement - invalid tokens rejected with 401
 */
export function authMiddleware(config: AuthConfig = defaultAuthConfig) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    // Skip auth if configured (development only)
    if (config.skipAuth) {
      req.user = {
        userId: 'dev-user',
        email: 'dev@example.com',
        name: 'Development User',
        roles: ['Admin'],
        tenantId: 'dev-tenant',
        tokenExpiry: new Date(Date.now() + 3600000),
      };
      next();
      return;
    }

    // Extract token from Authorization header
    const token = extractBearerToken(req.headers.authorization);

    if (!token) {
      // @property Property 20: Authentication Enforcement - reject with 401
      res.status(401).json(
        createErrorResponse(
          'Unauthorized',
          'Missing or invalid Authorization header. Bearer token required.',
          req.headers['x-correlation-id'] as string
        )
      );
      return;
    }

    // Validate token
    const validationResult = validateToken(token, config);

    if (!validationResult.valid) {
      // @property Property 20: Authentication Enforcement - reject with 401
      res.status(401).json(
        createErrorResponse(
          'Unauthorized',
          validationResult.error || 'Invalid token',
          req.headers['x-correlation-id'] as string
        )
      );
      return;
    }

    // Attach user to request
    req.user = validationResult.user;
    next();
  };
}

/**
 * Optional authentication middleware (allows unauthenticated requests)
 */
export function optionalAuthMiddleware(config: AuthConfig = defaultAuthConfig) {
  return (req: AuthenticatedRequest, _res: Response, next: NextFunction): void => {
    const token = extractBearerToken(req.headers.authorization);

    if (token) {
      const validationResult = validateToken(token, config);
      if (validationResult.valid) {
        req.user = validationResult.user;
      }
    }

    next();
  };
}

export default authMiddleware;
