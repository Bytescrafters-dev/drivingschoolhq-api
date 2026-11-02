/**
 * Permissions inside a driving school. Authorization checks must use
 * permissions, never role names.
 */
export const TenantPermission = {
  BRANCHES_MANAGE: 'BRANCHES_MANAGE',
  STAFF_MANAGE: 'STAFF_MANAGE',
} as const;

export type TenantPermission =
  (typeof TenantPermission)[keyof typeof TenantPermission];
