/**
 * Property 21: RBAC Enforcement
 *
 * For any user attempting an action (view, override, configure), the system SHALL
 * verify the user's role permits the action and return 403 Forbidden if unauthorized.
 *
 * @validates Requirements 11.2, 6.6
 * @file src/backend/api/src/middleware/rbac.ts
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  hasPermission,
  userHasPermission,
  getPermissionsForRoles,
  getRequiredRolesForAction,
  rolePermissions,
  type Action,
} from '../../src/backend/api/src/middleware/rbac.js';
import type { UserRole } from '../../src/backend/api/src/middleware/auth.js';

// Property test configuration
const propertyConfig = {
  numRuns: 100,
  verbose: false,
};

// All valid roles
const allRoles: UserRole[] = ['Operator', 'Admin', 'MLEngineer', 'Auditor'];

// All valid actions
const allActions: Action[] = [
  'view:recommendations',
  'create:recommendations',
  'view:overrides',
  'create:overrides',
  'view:audit',
  'manage:config',
  'manage:models',
  'view:metrics',
  'manage:users',
];

// Arbitraries
const validRole = fc.constantFrom(...allRoles);
const validAction = fc.constantFrom(...allActions);
const validRoleArray = fc.subarray(allRoles, { minLength: 1 });

describe('Property 21: RBAC Enforcement', () => {
  /**
   * **Validates: Requirements 11.2**
   *
   * Role permissions are correctly defined.
   */
  describe('Role Permission Definitions', () => {
    it('all roles should have defined permissions', () => {
      for (const role of allRoles) {
        expect(rolePermissions[role]).toBeDefined();
        expect(Array.isArray(rolePermissions[role])).toBe(true);
      }
    });

    it('Operator role should have basic permissions', () => {
      const operatorPerms = rolePermissions['Operator'];
      expect(operatorPerms).toContain('view:recommendations');
      expect(operatorPerms).toContain('create:recommendations');
      expect(operatorPerms).toContain('view:overrides');
      expect(operatorPerms).toContain('create:overrides');
    });

    it('Admin role should have management permissions', () => {
      const adminPerms = rolePermissions['Admin'];
      expect(adminPerms).toContain('manage:config');
      expect(adminPerms).toContain('manage:users');
      expect(adminPerms).toContain('view:audit');
    });

    it('MLEngineer role should have model management permissions', () => {
      const mlPerms = rolePermissions['MLEngineer'];
      expect(mlPerms).toContain('manage:models');
      expect(mlPerms).toContain('view:audit');
    });

    it('Auditor role should have read-only permissions', () => {
      const auditorPerms = rolePermissions['Auditor'];
      expect(auditorPerms).toContain('view:recommendations');
      expect(auditorPerms).toContain('view:overrides');
      expect(auditorPerms).toContain('view:audit');
      // Auditor should NOT have write permissions
      expect(auditorPerms).not.toContain('create:overrides');
      expect(auditorPerms).not.toContain('manage:config');
    });
  });

  /**
   * **Validates: Requirements 11.2**
   *
   * hasPermission correctly checks role permissions.
   */
  describe('hasPermission Function', () => {
    it('should return true for permitted actions', () => {
      fc.assert(
        fc.property(validRole, (role) => {
          const permissions = rolePermissions[role];
          for (const action of permissions) {
            expect(hasPermission(role, action)).toBe(true);
          }
        }),
        propertyConfig
      );
    });

    it('should return false for non-permitted actions', () => {
      // Operator should not have admin permissions
      expect(hasPermission('Operator', 'manage:config')).toBe(false);
      expect(hasPermission('Operator', 'manage:users')).toBe(false);
      expect(hasPermission('Operator', 'view:audit')).toBe(false);

      // Auditor should not have write permissions
      expect(hasPermission('Auditor', 'create:overrides')).toBe(false);
      expect(hasPermission('Auditor', 'manage:config')).toBe(false);

      // MLEngineer should not have user management
      expect(hasPermission('MLEngineer', 'manage:users')).toBe(false);
    });

    it('permission check should be consistent', () => {
      fc.assert(
        fc.property(validRole, validAction, (role, action) => {
          const result1 = hasPermission(role, action);
          const result2 = hasPermission(role, action);
          expect(result1).toBe(result2);
        }),
        propertyConfig
      );
    });
  });

  /**
   * **Validates: Requirements 11.2**
   *
   * userHasPermission correctly checks multiple roles.
   */
  describe('userHasPermission Function', () => {
    it('user with any permitted role should have permission', () => {
      fc.assert(
        fc.property(validRoleArray, validAction, (roles, action) => {
          const hasAnyPermission = roles.some((role) => hasPermission(role, action));
          expect(userHasPermission(roles, action)).toBe(hasAnyPermission);
        }),
        propertyConfig
      );
    });

    it('user with Admin role should have most permissions', () => {
      const adminActions: Action[] = [
        'view:recommendations',
        'create:recommendations',
        'view:overrides',
        'create:overrides',
        'view:audit',
        'manage:config',
        'view:metrics',
        'manage:users',
      ];

      for (const action of adminActions) {
        expect(userHasPermission(['Admin'], action)).toBe(true);
      }
    });

    it('user with multiple roles should have combined permissions', () => {
      // Operator + Auditor should have both sets of permissions
      const combinedRoles: UserRole[] = ['Operator', 'Auditor'];
      
      // Should have Operator permissions
      expect(userHasPermission(combinedRoles, 'create:overrides')).toBe(true);
      
      // Should have Auditor permissions
      expect(userHasPermission(combinedRoles, 'view:audit')).toBe(true);
    });

    it('empty role array should have no permissions', () => {
      fc.assert(
        fc.property(validAction, (action) => {
          expect(userHasPermission([], action)).toBe(false);
        }),
        propertyConfig
      );
    });
  });

  /**
   * **Validates: Requirements 11.2**
   *
   * getPermissionsForRoles correctly aggregates permissions.
   */
  describe('getPermissionsForRoles Function', () => {
    it('should return all permissions for given roles', () => {
      fc.assert(
        fc.property(validRoleArray, (roles) => {
          const permissions = getPermissionsForRoles(roles);
          
          // All returned permissions should be valid
          for (const perm of permissions) {
            expect(allActions).toContain(perm);
          }

          // Should include permissions from all roles
          for (const role of roles) {
            for (const perm of rolePermissions[role]) {
              expect(permissions).toContain(perm);
            }
          }
        }),
        propertyConfig
      );
    });

    it('should not have duplicates', () => {
      fc.assert(
        fc.property(validRoleArray, (roles) => {
          const permissions = getPermissionsForRoles(roles);
          const uniquePermissions = new Set(permissions);
          expect(permissions.length).toBe(uniquePermissions.size);
        }),
        propertyConfig
      );
    });

    it('empty roles should return empty permissions', () => {
      const permissions = getPermissionsForRoles([]);
      expect(permissions).toEqual([]);
    });
  });

  /**
   * **Validates: Requirements 11.2, 6.6**
   *
   * getRequiredRolesForAction correctly identifies required roles.
   */
  describe('getRequiredRolesForAction Function', () => {
    it('should return roles that have the permission', () => {
      fc.assert(
        fc.property(validAction, (action) => {
          const requiredRoles = getRequiredRolesForAction(action);
          
          // All returned roles should have the permission
          for (const role of requiredRoles) {
            expect(hasPermission(role, action)).toBe(true);
          }

          // All roles with the permission should be returned
          for (const role of allRoles) {
            if (hasPermission(role, action)) {
              expect(requiredRoles).toContain(role);
            }
          }
        }),
        propertyConfig
      );
    });

    it('create:overrides should require Operator or Admin', () => {
      const roles = getRequiredRolesForAction('create:overrides');
      expect(roles).toContain('Operator');
      expect(roles).toContain('Admin');
      expect(roles).not.toContain('Auditor');
    });

    it('manage:models should require MLEngineer', () => {
      const roles = getRequiredRolesForAction('manage:models');
      expect(roles).toContain('MLEngineer');
      expect(roles).not.toContain('Operator');
    });

    it('view:audit should require Admin, MLEngineer, or Auditor', () => {
      const roles = getRequiredRolesForAction('view:audit');
      expect(roles).toContain('Admin');
      expect(roles).toContain('MLEngineer');
      expect(roles).toContain('Auditor');
      expect(roles).not.toContain('Operator');
    });
  });

  /**
   * **Validates: Requirements 6.6**
   *
   * Override capability is role-restricted.
   */
  describe('Override Capability RBAC', () => {
    it('only Operator and Admin can create overrides', () => {
      expect(hasPermission('Operator', 'create:overrides')).toBe(true);
      expect(hasPermission('Admin', 'create:overrides')).toBe(true);
      expect(hasPermission('MLEngineer', 'create:overrides')).toBe(false);
      expect(hasPermission('Auditor', 'create:overrides')).toBe(false);
    });

    it('all roles can view overrides', () => {
      for (const role of allRoles) {
        expect(hasPermission(role, 'view:overrides')).toBe(true);
      }
    });
  });

  /**
   * **Validates: Requirements 11.2**
   *
   * Principle of least privilege is maintained.
   */
  describe('Principle of Least Privilege', () => {
    it('Operator should have minimal necessary permissions', () => {
      const operatorPerms = rolePermissions['Operator'];
      
      // Should NOT have admin/management permissions
      expect(operatorPerms).not.toContain('manage:config');
      expect(operatorPerms).not.toContain('manage:users');
      expect(operatorPerms).not.toContain('manage:models');
      expect(operatorPerms).not.toContain('view:audit');
    });

    it('Auditor should have read-only permissions', () => {
      const auditorPerms = rolePermissions['Auditor'];
      
      // All auditor permissions should be view-only
      for (const perm of auditorPerms) {
        expect(perm.startsWith('view:')).toBe(true);
      }
    });

    it('each role should have at least one permission', () => {
      for (const role of allRoles) {
        expect(rolePermissions[role].length).toBeGreaterThan(0);
      }
    });
  });
});
