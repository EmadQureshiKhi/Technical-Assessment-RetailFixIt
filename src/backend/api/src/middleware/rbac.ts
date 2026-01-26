/**
 * Role-Based Access Control (RBAC) Middleware
 *
 * Defines role permissions and enforces role-based access control.
 *
 * @requirement 11.2 - Role-based access control with defined roles
 * @requirement 6.6 - Role-based access control for override capabilities
 * @property Property 21: RBAC Enforcement
 * @tested tests/property/rbac.property.test.ts
 */

import { Response, NextFunction } from 'express';
import { type AuthenticatedRequest, type UserRole } from './auth.js';
import { createErrorResponse } from '../routes/recommendations.js';

/**
 * Actions that can be performed in the system
 */
export type Action =
  | 'view:recommendations'
  | 'create:recommendations'
  | 'view:overrides'
  | 'create:overrides'
  | 'view:audit'
  | 'manage:config'
  | 'manage:models'
  | 'view:metrics'
  | 'manage:users';

/**
 * Role permission definitions
 *
 * @requirement 11.2 - Define role permissions (Operator, Admin, ML Engineer, Auditor)
 */
export const rolePermissions: Record<UserRole, Action[]> = {
  Operator: [
    'view:recommendations',
    'create:recommendations',
    'view:overrides',
    'create:overrides',
    'view:metrics',
  ],
  Admin: [
    'view:recommendations',
    'create:recommendations',
    'view:overrides',
    'create:overrides',
    'view:audit',
    'manage:config',
    'view:metrics',
    'manage:users',
  ],
  MLEngineer: [
    'view:recommendations',
    'view:overrides',
    'view:audit',
    'manage:models',
    'view:metrics',
  ],
  Auditor: [
    'view:recommendations',
    'view:overrides',
    'view:audit',
    'view:metrics',
  ],
};

/**
 * Checks if a role has permission for an action
 */
export function hasPermission(role: UserRole, action: Action): boolean {
  const permissions = rolePermissions[role];
  return permissions?.includes(action) ?? false;
}

/**
 * Checks if any of the user's roles has permission for an action
 */
export function userHasPermission(roles: UserRole[], action: Action): boolean {
  return roles.some((role) => hasPermission(role, action));
}

/**
 * Gets all permissions for a set of roles
 */
export function getPermissionsForRoles(roles: UserRole[]): Action[] {
  const permissions = new Set<Action>();
  for (const role of roles) {
    const rolePerms = rolePermissions[role];
    if (rolePerms) {
      for (const perm of rolePerms) {
        permissions.add(perm);
      }
    }
  }
  return Array.from(permissions);
}

/**
 * Gets the minimum required role for an action
 */
export function getRequiredRolesForAction(action: Action): UserRole[] {
  const roles: UserRole[] = [];
  for (const [role, permissions] of Object.entries(rolePermissions)) {
    if (permissions.includes(action)) {
      roles.push(role as UserRole);
    }
  }
  return roles;
}

/**
 * RBAC middleware factory
 *
 * Creates middleware that checks if the authenticated user has permission
 * for the specified action.
 *
 * @requirement 11.2 - Enforce role-based access control
 * @requirement 6.6 - Role-based access control for override capabilities
 * @property Property 21: RBAC Enforcement - unauthorized actions return 403
 */
export function requirePermission(action: Action) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    // Check if user is authenticated
    if (!req.user) {
      res.status(401).json(
        createErrorResponse(
          'Unauthorized',
          'Authentication required',
          req.headers['x-correlation-id'] as string
        )
      );
      return;
    }

    // Check if user has required permission
    // @property Property 21: RBAC Enforcement
    if (!userHasPermission(req.user.roles, action)) {
      const requiredRoles = getRequiredRolesForAction(action);
      res.status(403).json({
        error: 'Forbidden',
        message: `You do not have permission to perform this action: ${action}`,
        requiredRole: requiredRoles.join(' or '),
        userRoles: req.user.roles,
        correlationId: req.headers['x-correlation-id'],
      });
      return;
    }

    next();
  };
}

/**
 * RBAC middleware that requires any of the specified roles
 *
 * @requirement 11.2 - Enforce role-based access control
 */
export function requireRole(...roles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    // Check if user is authenticated
    if (!req.user) {
      res.status(401).json(
        createErrorResponse(
          'Unauthorized',
          'Authentication required',
          req.headers['x-correlation-id'] as string
        )
      );
      return;
    }

    // Check if user has any of the required roles
    const hasRequiredRole = req.user.roles.some((userRole) => roles.includes(userRole));

    if (!hasRequiredRole) {
      res.status(403).json({
        error: 'Forbidden',
        message: `This action requires one of the following roles: ${roles.join(', ')}`,
        requiredRole: roles.join(' or '),
        userRoles: req.user.roles,
        correlationId: req.headers['x-correlation-id'],
      });
      return;
    }

    next();
  };
}

/**
 * RBAC middleware that requires all of the specified roles
 */
export function requireAllRoles(...roles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    // Check if user is authenticated
    if (!req.user) {
      res.status(401).json(
        createErrorResponse(
          'Unauthorized',
          'Authentication required',
          req.headers['x-correlation-id'] as string
        )
      );
      return;
    }

    // Check if user has all required roles
    const hasAllRoles = roles.every((role) => req.user!.roles.includes(role));

    if (!hasAllRoles) {
      res.status(403).json({
        error: 'Forbidden',
        message: `This action requires all of the following roles: ${roles.join(', ')}`,
        requiredRole: roles.join(' and '),
        userRoles: req.user.roles,
        correlationId: req.headers['x-correlation-id'],
      });
      return;
    }

    next();
  };
}

/**
 * Middleware to check if user can perform override
 *
 * @requirement 6.6 - Role-based access control for override capabilities
 */
export const canOverride = requirePermission('create:overrides');

/**
 * Middleware to check if user can view audit logs
 */
export const canViewAudit = requirePermission('view:audit');

/**
 * Middleware to check if user can manage configuration
 */
export const canManageConfig = requirePermission('manage:config');

/**
 * Middleware to check if user can manage ML models
 */
export const canManageModels = requirePermission('manage:models');

export default requirePermission;
