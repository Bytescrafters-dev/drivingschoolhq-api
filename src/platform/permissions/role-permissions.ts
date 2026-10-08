import { PlatformRole } from '../../generated/prisma/enums.js';
import { PlatformPermission as P } from './platform-permission.js';

const ALL_PERMISSIONS = Object.values(P);

/**
 * Single source of truth for what each platform role may do.
 * Authorization checks must use permissions, never role names.
 */
export const PLATFORM_ROLE_PERMISSIONS: Readonly<
  Record<PlatformRole, readonly P[]>
> = {
  [PlatformRole.SUPER_ADMIN]: ALL_PERMISSIONS,
  [PlatformRole.OPERATIONS_ADMIN]: [
    P.TENANTS_READ,
    P.TENANTS_MANAGE,
    P.TENANT_ACCESS_MANAGE,
    P.TENANT_USAGE_READ,
    P.PLANS_READ,
    P.SUBSCRIPTIONS_READ,
    P.SUBSCRIPTIONS_MANAGE,
    P.INVOICES_READ,
  ],
  [PlatformRole.BILLING_ADMIN]: [
    P.TENANTS_READ,
    P.TENANT_USAGE_READ,
    P.PLANS_READ,
    P.SUBSCRIPTIONS_READ,
    P.INVOICES_READ,
    P.INVOICES_MANAGE,
    P.PAYMENTS_RECORD,
    P.PAYMENTS_REVERSE,
  ],
  [PlatformRole.SUPPORT]: [
    P.TENANTS_READ,
    P.TENANT_USAGE_READ,
    P.PLANS_READ,
    P.SUBSCRIPTIONS_READ,
  ],
};

export function permissionsForRole(role: PlatformRole): readonly P[] {
  return PLATFORM_ROLE_PERMISSIONS[role];
}

export function roleHasPermissions(
  role: PlatformRole,
  required: readonly P[],
): boolean {
  const granted = PLATFORM_ROLE_PERMISSIONS[role];
  return required.every((permission) => granted.includes(permission));
}
