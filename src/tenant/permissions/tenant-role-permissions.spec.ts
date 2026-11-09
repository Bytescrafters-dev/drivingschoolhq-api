import { TenantRole } from '../../generated/prisma/enums.js';
import { TenantPermission } from './tenant-permission.js';
import {
  TENANT_ROLE_PERMISSIONS,
  tenantRoleHasPermissions,
} from './tenant-role-permissions.js';

describe('tenant role permissions', () => {
  it('maps every role', () => {
    expect(Object.keys(TENANT_ROLE_PERMISSIONS).sort()).toEqual(
      Object.values(TenantRole).sort(),
    );
  });

  it('lets only owners and admins manage branches', () => {
    const allowed = Object.values(TenantRole).filter((role) =>
      tenantRoleHasPermissions(role, [TenantPermission.BRANCHES_MANAGE]),
    );
    expect(allowed.sort()).toEqual([TenantRole.ADMIN, TenantRole.OWNER]);
  });

  it('lets every role view instructors', () => {
    for (const role of Object.values(TenantRole)) {
      expect(
        tenantRoleHasPermissions(role, [TenantPermission.INSTRUCTORS_VIEW]),
      ).toBe(true);
    }
  });

  it('lets owners, admins and branch managers manage instructors', () => {
    const allowed = Object.values(TenantRole).filter((role) =>
      tenantRoleHasPermissions(role, [TenantPermission.INSTRUCTORS_MANAGE]),
    );
    expect(allowed.sort()).toEqual(
      [TenantRole.ADMIN, TenantRole.BRANCH_MANAGER, TenantRole.OWNER].sort(),
    );
  });

  it('requires every listed permission', () => {
    expect(tenantRoleHasPermissions(TenantRole.FRONT_DESK, [])).toBe(true);
    expect(
      tenantRoleHasPermissions(TenantRole.FRONT_DESK, [
        TenantPermission.BRANCHES_MANAGE,
      ]),
    ).toBe(false);
  });
});
