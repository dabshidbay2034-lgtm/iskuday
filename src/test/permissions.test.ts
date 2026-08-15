import { describe, it, expect } from 'vitest';
import {
  PERMISSIONS,
  STAFF_ROLES,
  ROLE_PERMISSIONS,
  STAFF_ROLE_LABELS,
  hasPermission,
  type Permission,
  type StaffRole,
} from '@/lib/permissions';

const ALL_ROLES = Object.values(STAFF_ROLES) as StaffRole[];
const ALL_PERMISSIONS = Object.values(PERMISSIONS) as Permission[];

describe('staff permission model', () => {
  it('gives admins every permission', () => {
    for (const permission of ALL_PERMISSIONS) {
      expect(hasPermission(STAFF_ROLES.ADMIN, permission)).toBe(true);
    }
  });

  it('gives viewers read-only visibility and nothing that mutates', () => {
    // Every `*_VIEW` permission, and nothing else. Keep this list in step with
    // PERMISSIONS — a new view permission belongs here, a new mutating one does
    // not, and the loop below fails either way if the two drift apart.







    const READ_ONLY: Permission[] = [
          PERMISSIONS.RENT_VIEW,
          PERMISSIONS.UTILITIES_VIEW,
          PERMISSIONS.MAINTENANCE_VIEW,
          PERMISSIONS.EXPENSES_VIEW,
          PERMISSIONS.LEASE_VIEW,
          PERMISSIONS.BOOKING_VIEW,
        ];

    for (const permission of ALL_PERMISSIONS) {
      expect(hasPermission(STAFF_ROLES.VIEWER, permission)).toBe(
        READ_ONLY.includes(permission),
      );
    }
  });

  it('never lets an agent mark rent paid, though they may record utilities', () => {
    // The core financial control: data entry is delegated, confirming money
    // received is not.
    expect(hasPermission(STAFF_ROLES.AGENT, PERMISSIONS.UTILITIES_RECORD)).toBe(true);
    expect(hasPermission(STAFF_ROLES.AGENT, PERMISSIONS.RENT_VIEW)).toBe(true);
    expect(hasPermission(STAFF_ROLES.AGENT, PERMISSIONS.RENT_MARK_PAID)).toBe(false);
  });

  it('only lets admins and managers mark rent paid', () => {
    const canMark = ALL_ROLES.filter((r) => hasPermission(r, PERMISSIONS.RENT_MARK_PAID));
    expect(canMark).toEqual([STAFF_ROLES.ADMIN, STAFF_ROLES.MANAGER]);
  });

  it('only lets admins and managers manage tenants', () => {
    const canManage = ALL_ROLES.filter((r) => hasPermission(r, PERMISSIONS.TENANTS_MANAGE));
    expect(canManage).toEqual([STAFF_ROLES.ADMIN, STAFF_ROLES.MANAGER]);
  });

  it('only lets admins manage staff', () => {
    const canManage = ALL_ROLES.filter((r) => hasPermission(r, PERMISSIONS.STAFF_MANAGE));
    expect(canManage).toEqual([STAFF_ROLES.ADMIN]);
  });

  it('lets admins and managers invite staff, but not agents or viewers', () => {
    expect(hasPermission(STAFF_ROLES.ADMIN, PERMISSIONS.STAFF_INVITE)).toBe(true);
    expect(hasPermission(STAFF_ROLES.MANAGER, PERMISSIONS.STAFF_INVITE)).toBe(true);
    expect(hasPermission(STAFF_ROLES.AGENT, PERMISSIONS.STAFF_INVITE)).toBe(false);
    expect(hasPermission(STAFF_ROLES.VIEWER, PERMISSIONS.STAFF_INVITE)).toBe(false);
  });

  it('does not let agents delete or publish properties', () => {
    expect(hasPermission(STAFF_ROLES.AGENT, PERMISSIONS.PROPERTY_CREATE)).toBe(true);
    expect(hasPermission(STAFF_ROLES.AGENT, PERMISSIONS.PROPERTY_EDIT)).toBe(true);
    expect(hasPermission(STAFF_ROLES.AGENT, PERMISSIONS.PROPERTY_DELETE)).toBe(false);
    expect(hasPermission(STAFF_ROLES.AGENT, PERMISSIONS.PROPERTY_PUBLISH)).toBe(false);
  });

  it('reserves billing for admins only', () => {
    const canBill = ALL_ROLES.filter((r) => hasPermission(r, PERMISSIONS.BILLING_MANAGE));
    expect(canBill).toEqual([STAFF_ROLES.ADMIN]);
  });

  it('treats a missing role as having no access', () => {
    expect(hasPermission(null, PERMISSIONS.PROPERTY_CREATE)).toBe(false);
    expect(hasPermission(undefined, PERMISSIONS.STAFF_MANAGE)).toBe(false);
  });

  it('grants strictly decreasing access from admin to viewer', () => {
    const count = (r: StaffRole) => ROLE_PERMISSIONS[r].length;
    expect(count(STAFF_ROLES.ADMIN)).toBeGreaterThan(count(STAFF_ROLES.MANAGER));
    expect(count(STAFF_ROLES.MANAGER)).toBeGreaterThan(count(STAFF_ROLES.AGENT));
    expect(count(STAFF_ROLES.AGENT)).toBeGreaterThan(count(STAFF_ROLES.VIEWER));
  });

  it('keeps every role mapped and labelled, with no unknown permissions', () => {
    for (const role of ALL_ROLES) {
      expect(ROLE_PERMISSIONS[role]).toBeDefined();
      expect(STAFF_ROLE_LABELS[role]?.label).toBeTruthy();
      expect(STAFF_ROLE_LABELS[role]?.description).toBeTruthy();

      for (const permission of ROLE_PERMISSIONS[role]) {
        expect(ALL_PERMISSIONS).toContain(permission);
      }
    }
  });

  it('namespaces every permission and role under "org:" for Clerk', () => {
    for (const permission of ALL_PERMISSIONS) {
      expect(permission.startsWith('org:')).toBe(true);
    }
    for (const role of ALL_ROLES) {
      expect(role.startsWith('org:')).toBe(true);
    }
  });
});
