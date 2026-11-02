import {
  TenantRole,
  TenantUserBranchAccess,
} from '../../generated/prisma/enums.js';
import {
  META,
  expectAppError,
  passthroughTx,
} from '../../../test/support/fakes.js';
import { FakeTenantAuditRepository } from '../../../test/support/tenant-auth-fakes.js';
import { InMemoryTenantUserRepository } from '../../../test/support/tenancy-fakes.js';
import { TenantAuditService } from '../audit/tenant-audit.service.js';
import type { AuthenticatedTenantUser } from '../auth/interfaces/authenticated-tenant-user.js';
import { MyProfileService } from './my-profile.service.js';

function setup(role: TenantRole = TenantRole.FRONT_DESK) {
  const users = new InMemoryTenantUserRepository();
  const auditRepo = new FakeTenantAuditRepository();
  const service = new MyProfileService(
    users,
    new TenantAuditService(auditRepo),
    passthroughTx,
  );
  const row = users.seedUser({
    tenantId: crypto.randomUUID(),
    role,
    fullName: 'Nimal Perera',
    phone: '+94771234567',
    email: 'nimal@school.lk',
    nic: '199012345678',
  });
  const actor: AuthenticatedTenantUser = {
    id: row.id,
    tenantId: row.tenantId,
    email: row.email,
    fullName: row.fullName,
    role,
    sessionId: crypto.randomUUID(),
    mustChangePassword: false,
    branchAccess: TenantUserBranchAccess.ALL,
    defaultBranchId: row.defaultBranchId,
  };
  return { service, users, auditRepo, row, actor };
}

describe('MyProfileService', () => {
  it('updates the own name and phone and audits the change', async () => {
    const { service, auditRepo, actor } = setup();

    const updated = await service.update(
      actor,
      { fullName: ' Nimal P. ', phone: '+94711111111' },
      META,
    );

    expect(updated).toMatchObject({
      fullName: 'Nimal P.',
      phone: '+94711111111',
      // Email and NIC are not self-service.
      email: 'nimal@school.lk',
      nic: '199012345678',
    });
    expect(auditRepo.entries).toEqual([
      expect.objectContaining({
        action: 'PROFILE_UPDATED',
        actorTenantUserId: actor.id,
        targetId: actor.id,
        metadata: {
          fullName: { from: 'Nimal Perera', to: 'Nimal P.' },
          phone: { from: '+94771234567', to: '+94711111111' },
        },
      }),
    ]);
  });

  it('lets staff clear their phone but not the owner', async () => {
    const staff = setup();
    const cleared = await staff.service.update(
      staff.actor,
      { phone: null },
      META,
    );
    expect(cleared.phone).toBeNull();

    const owner = setup(TenantRole.OWNER);
    await expectAppError(
      owner.service.update(owner.actor, { phone: null }, META),
      'PHONE_REQUIRED',
    );
  });

  it('writes nothing when nothing changes', async () => {
    const { service, auditRepo, actor } = setup();
    await service.update(actor, { fullName: 'Nimal Perera' }, META);
    expect(auditRepo.entries).toHaveLength(0);
  });
});
