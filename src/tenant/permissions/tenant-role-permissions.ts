import { TenantRole } from '../../generated/prisma/enums.js';
import { TenantPermission as P } from './tenant-permission.js';

const ALL_PERMISSIONS = Object.values(P);

/** Single source of truth for what each tenant role may do. */
export const TENANT_ROLE_PERMISSIONS: Readonly<
  Record<TenantRole, readonly P[]>
> = {
  [TenantRole.OWNER]: ALL_PERMISSIONS,
  [TenantRole.ADMIN]: [
    P.BRANCHES_MANAGE,
    P.STAFF_MANAGE,
    P.INSTRUCTORS_VIEW,
    P.INSTRUCTORS_MANAGE,
  ],
  [TenantRole.BRANCH_MANAGER]: [
    P.STAFF_MANAGE,
    P.INSTRUCTORS_VIEW,
    P.INSTRUCTORS_MANAGE,
  ],
  [TenantRole.FRONT_DESK]: [P.INSTRUCTORS_VIEW],
  [TenantRole.INSTRUCTOR]: [P.INSTRUCTORS_VIEW],
  [TenantRole.ACCOUNTANT]: [P.INSTRUCTORS_VIEW],
};

export function tenantRoleHasPermissions(
  role: TenantRole,
  required: readonly P[],
): boolean {
  const granted = TENANT_ROLE_PERMISSIONS[role];
  return required.every((permission) => granted.includes(permission));
}
