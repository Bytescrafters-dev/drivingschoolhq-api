import { PlatformRole } from '../../generated/prisma/enums.js';
import { PlatformPermission as P } from './platform-permission.js';
import { permissionsForRole, roleHasPermissions } from './role-permissions.js';

const ADMIN_AND_AUDIT = [
  P.PLATFORM_ADMINS_READ,
  P.PLATFORM_ADMINS_MANAGE,
  P.PLATFORM_AUDIT_READ,
];

describe('platform role permissions', () => {
  it('grants SUPER_ADMIN every permission', () => {
    expect(new Set(permissionsForRole(PlatformRole.SUPER_ADMIN))).toEqual(
      new Set(Object.values(P)),
    );
  });

  it.each([
    PlatformRole.OPERATIONS_ADMIN,
    PlatformRole.BILLING_ADMIN,
    PlatformRole.SUPPORT,
  ])('does not let %s manage admins or read the audit log', (role) => {
    for (const permission of ADMIN_AND_AUDIT) {
      expect(roleHasPermissions(role, [permission])).toBe(false);
    }
  });

  it('lets OPERATIONS_ADMIN run tenant lifecycle but not money movements', () => {
    const role = PlatformRole.OPERATIONS_ADMIN;
    expect(
      roleHasPermissions(role, [
        P.TENANTS_MANAGE,
        P.TENANT_ACCESS_MANAGE,
        P.SUBSCRIPTIONS_MANAGE,
      ]),
    ).toBe(true);
    expect(roleHasPermissions(role, [P.PAYMENTS_RECORD])).toBe(false);
    expect(roleHasPermissions(role, [P.INVOICES_MANAGE])).toBe(false);
    expect(roleHasPermissions(role, [P.PLANS_MANAGE])).toBe(false);
  });

  it('lets BILLING_ADMIN handle plans, invoices and payments but not tenant state', () => {
    const role = PlatformRole.BILLING_ADMIN;
    expect(
      roleHasPermissions(role, [
        P.PLANS_MANAGE,
        P.INVOICES_MANAGE,
        P.PAYMENTS_RECORD,
        P.PAYMENTS_REVERSE,
      ]),
    ).toBe(true);
    expect(roleHasPermissions(role, [P.TENANTS_MANAGE])).toBe(false);
    expect(roleHasPermissions(role, [P.TENANT_ACCESS_MANAGE])).toBe(false);
    expect(roleHasPermissions(role, [P.SUBSCRIPTIONS_MANAGE])).toBe(false);
  });

  it('keeps SUPPORT read-only', () => {
    const granted = permissionsForRole(PlatformRole.SUPPORT);
    expect(granted.every((p) => p.endsWith('_READ'))).toBe(true);
    expect(granted).not.toContain(P.INVOICES_READ);
  });

  it('requires every listed permission', () => {
    expect(
      roleHasPermissions(PlatformRole.SUPPORT, [
        P.TENANTS_READ,
        P.TENANTS_MANAGE,
      ]),
    ).toBe(false);
  });
});
