/**
 * Clerk organisation-level permissions and staff roles.
 *
 * This module is imported by both our own `useAppAuth` hook and the Team-management
 * page maintained by the other agent — keep the exported API stable.
 */

// ── Permissions ──────────────────────────────────────────────────────────────

export const PERMISSIONS = {
  PROPERTY_CREATE:  'org:properties:create',
  PROPERTY_EDIT:    'org:properties:edit',
  PROPERTY_DELETE:  'org:properties:delete',
  PROPERTY_PUBLISH: 'org:properties:publish',
  PROPERTY_OCCUPANCY: 'org:properties:occupancy',
  INQUIRY_VIEW:     'org:inquiries:view',
  INQUIRY_RESPOND:  'org:inquiries:respond',
  STAFF_INVITE:     'org:staff:invite',
  STAFF_MANAGE:     'org:staff:manage',
  ANALYTICS_VIEW:   'org:analytics:view',
  BILLING_MANAGE:   'org:billing:manage',

  // Property-management additions. Note the deliberate split between recording
  // a bill (data entry, trusted to agents) and marking rent received
  // (a financial control, withheld from agents).
  RENT_VIEW:        'org:rent:view',
  RENT_MARK_PAID:   'org:rent:mark_paid',
  UTILITIES_VIEW:   'org:utilities:view',
  UTILITIES_RECORD: 'org:utilities:record',
  TENANTS_MANAGE:   'org:tenants:manage',
  NOTES_MANAGE:     'org:notes:manage',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

// ── Staff roles ──────────────────────────────────────────────────────────────

export const STAFF_ROLES = {
  ADMIN:   'org:admin',
  MANAGER: 'org:manager',
  AGENT:   'org:agent',
  VIEWER:  'org:viewer',
} as const;

export type StaffRole = (typeof STAFF_ROLES)[keyof typeof STAFF_ROLES];

// ── Role → permission mapping ────────────────────────────────────────────────

const ALL_PERMISSIONS: Permission[] = Object.values(PERMISSIONS);

export const ROLE_PERMISSIONS: Record<StaffRole, Permission[]> = {
  [STAFF_ROLES.ADMIN]: ALL_PERMISSIONS,
  [STAFF_ROLES.MANAGER]: [
    PERMISSIONS.PROPERTY_CREATE,
    PERMISSIONS.PROPERTY_EDIT,
    PERMISSIONS.PROPERTY_PUBLISH,
    PERMISSIONS.PROPERTY_OCCUPANCY,
    PERMISSIONS.INQUIRY_VIEW,
    PERMISSIONS.INQUIRY_RESPOND,
    PERMISSIONS.ANALYTICS_VIEW,
    PERMISSIONS.STAFF_INVITE,
    PERMISSIONS.RENT_VIEW,
    PERMISSIONS.RENT_MARK_PAID,
    PERMISSIONS.UTILITIES_VIEW,
    PERMISSIONS.UTILITIES_RECORD,
    PERMISSIONS.TENANTS_MANAGE,
    PERMISSIONS.NOTES_MANAGE,
  ],
  [STAFF_ROLES.AGENT]: [
    PERMISSIONS.PROPERTY_CREATE,
    PERMISSIONS.PROPERTY_EDIT,
    PERMISSIONS.PROPERTY_OCCUPANCY,
    PERMISSIONS.INQUIRY_VIEW,
    PERMISSIONS.INQUIRY_RESPOND,
    PERMISSIONS.RENT_VIEW,
    // No RENT_MARK_PAID — agents record work, they do not confirm money in.
    PERMISSIONS.UTILITIES_VIEW,
    PERMISSIONS.UTILITIES_RECORD,
    PERMISSIONS.NOTES_MANAGE,
  ],
  [STAFF_ROLES.VIEWER]: [
    PERMISSIONS.RENT_VIEW,
    PERMISSIONS.UTILITIES_VIEW,
  ] as Permission[],
};

// ── Human-readable labels ────────────────────────────────────────────────────

export const STAFF_ROLE_LABELS: Record<StaffRole, { label: string; description: string }> = {
  [STAFF_ROLES.ADMIN]: {
    label: 'Admin',
    description: 'Full access — manage properties, inquiries, staff, billing and analytics.',
  },
  [STAFF_ROLES.MANAGER]: {
    label: 'Manager',
    description: 'Create/edit/publish properties, respond to inquiries, view analytics and invite staff.',
  },
  [STAFF_ROLES.AGENT]: {
    label: 'Agent',
    description: 'Create and edit properties, view and respond to inquiries.',
  },
  [STAFF_ROLES.VIEWER]: {
    label: 'Viewer',
    description: 'Read-only access to organisation data.',
  },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

export function hasPermission(
  role: StaffRole | null | undefined,
  permission: Permission,
): boolean {
  if (!role) return false;
  const perms = ROLE_PERMISSIONS[role];
  return perms ? perms.includes(permission) : false;
}
