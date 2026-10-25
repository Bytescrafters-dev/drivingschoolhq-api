import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TenantRole } from '../../../generated/prisma/enums.js';
import { expectAppError } from '../../../../test/support/fakes.js';
import { REQUIRED_TENANT_PERMISSIONS } from '../common/metadata-keys.js';
import { TenantPermission } from '../../permissions/tenant-permission.js';
import { TenantPermissionGuard } from './tenant-permission.guard.js';

function run(role: TenantRole | null, required: TenantPermission[]) {
  const handler = () => undefined;
  Reflect.defineMetadata(REQUIRED_TENANT_PERMISSIONS, required, handler);
  const context = {
    switchToHttp: () => ({
      getRequest: () => ({ tenantUser: role ? { role } : undefined }),
    }),
    getHandler: () => handler,
    getClass: () => class {},
  } as unknown as ExecutionContext;
  return Promise.resolve().then(() =>
    new TenantPermissionGuard(new Reflector()).canActivate(context),
  );
}

describe('TenantPermissionGuard', () => {
  const MANAGE = [TenantPermission.BRANCHES_MANAGE];

  it('allows roles holding every required permission', async () => {
    expect(await run(TenantRole.OWNER, MANAGE)).toBe(true);
    expect(await run(TenantRole.ADMIN, MANAGE)).toBe(true);
    expect(await run(TenantRole.FRONT_DESK, [])).toBe(true);
  });

  it('denies other roles', async () => {
    for (const role of [
      TenantRole.BRANCH_MANAGER,
      TenantRole.FRONT_DESK,
      TenantRole.INSTRUCTOR,
      TenantRole.ACCOUNTANT,
    ]) {
      await expectAppError(run(role, MANAGE), 'TENANT_PERMISSION_DENIED');
    }
  });

  it('requires authentication when permissions are declared', async () => {
    await expectAppError(run(null, MANAGE), 'AUTHENTICATION_REQUIRED');
  });
});
