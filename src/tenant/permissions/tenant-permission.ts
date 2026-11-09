/**
 * Permissions inside a driving school. Authorization checks must use
 * permissions, never role names.
 */
export const TenantPermission = {
  BRANCHES_MANAGE: 'BRANCHES_MANAGE',
  STAFF_MANAGE: 'STAFF_MANAGE',
  /** See instructors and their profiles (every role). */
  INSTRUCTORS_VIEW: 'INSTRUCTORS_VIEW',
  /** Manage other people's instructor profiles (within staff-policy rules). */
  INSTRUCTORS_MANAGE: 'INSTRUCTORS_MANAGE',
} as const;

export type TenantPermission =
  (typeof TenantPermission)[keyof typeof TenantPermission];
