import {
  TenantRole,
  TenantStatus,
  TenantUserStatus,
} from '../../generated/prisma/enums.js';
import { META, expectAppError } from '../../../test/support/fakes.js';
import { tenancySetup } from '../../../test/support/tenancy-unit.js';
import { PlatformAuditAction } from '../audit/common/platform-audit-action.js';

function withOwner(status: TenantStatus = TenantStatus.ACTIVE) {
  const ctx = tenancySetup();
  const tenant = ctx.tenants.seed({
    status,
    closedAt: status === TenantStatus.CLOSED ? new Date() : null,
  });
  const owner = ctx.users.seedUser({
    tenantId: tenant.id,
    role: TenantRole.OWNER,
    email: 'owner@school.lk',
    fullName: 'Old Owner',
    phone: '+94771234567',
    nic: '199012345678',
  });
  return { ...ctx, tenant, owner };
}

describe('TenantOwnerAdminService', () => {
  describe('updateProfile', () => {
    it('normalises and updates all four fields, auditing from/to without the NIC value', async () => {
      const { ownerAdmin, actor, tenant, owner, audit } = withOwner();

      const updated = await ownerAdmin.updateProfile(
        actor,
        tenant.id,
        {
          fullName: ' New Owner ',
          email: ' New@School.LK ',
          phone: '0719876543',
          nic: '901234567v',
        },
        META,
      );

      expect(updated).toMatchObject({
        fullName: 'New Owner',
        email: 'new@school.lk',
        phone: '+94719876543',
        nic: '901234567V',
      });
      expect(audit.entries[0]).toMatchObject({
        action: PlatformAuditAction.TENANT_OWNER_UPDATED,
        target: { type: 'TENANT_USER', id: owner.id },
        tenantId: tenant.id,
        metadata: {
          fullName: { from: 'Old Owner', to: 'New Owner' },
          email: { from: 'owner@school.lk', to: 'new@school.lk' },
          phone: { from: '+94771234567', to: '+94719876543' },
          nic: 'changed',
        },
      });
      const serialized = JSON.stringify(audit.entries);
      expect(serialized).not.toContain('199012345678');
      expect(serialized).not.toContain('901234567V');
    });

    it('does not audit a no-op update', async () => {
      const { ownerAdmin, actor, tenant, audit } = withOwner();
      await ownerAdmin.updateProfile(
        actor,
        tenant.id,
        { email: 'OWNER@school.lk', phone: '0771234567' },
        META,
      );
      expect(audit.entries).toHaveLength(0);
    });

    it.each([
      ['email', { email: 'staff@school.lk' }, 'TENANT_USER_EMAIL_TAKEN'],
      ['nic', { nic: '901234567V' }, 'TENANT_USER_NIC_TAKEN'],
    ])(
      'rejects a %s used by another user of the tenant',
      async (_f, change, code) => {
        const { ownerAdmin, actor, tenant, users } = withOwner();
        users.seedUser({
          tenantId: tenant.id,
          email: 'staff@school.lk',
          nic: '901234567V',
        });
        await expectAppError(
          ownerAdmin.updateProfile(actor, tenant.id, change, META),
          code,
        );
      },
    );

    it.each([
      [{ phone: '123' }, 'INVALID_PHONE'],
      [{ nic: 'ABC' }, 'INVALID_NIC'],
    ])('rejects invalid input %j', async (change, code) => {
      const { ownerAdmin, actor, tenant } = withOwner();
      await expectAppError(
        ownerAdmin.updateProfile(actor, tenant.id, change, META),
        code,
      );
    });
  });

  it('resets the password to a hashed temporary one that must be changed, ending sessions', async () => {
    const { ownerAdmin, actor, tenant, owner, users, audit, tenantSessions } =
      withOwner();

    const updated = await ownerAdmin.resetPassword(
      actor,
      tenant.id,
      'New-Temp-Pass-1',
      META,
    );

    expect(updated.mustChangePassword).toBe(true);
    expect(users.ownerRow(tenant.id)!.passwordHash).toBe(
      'hashed:New-Temp-Pass-1',
    );
    expect(audit.actions()).toEqual([
      PlatformAuditAction.TENANT_OWNER_PASSWORD_RESET,
    ]);
    expect(JSON.stringify(audit.entries)).not.toContain('New-Temp-Pass-1');
    expect(tenantSessions.revocations).toEqual([
      { tenantId: tenant.id, userId: owner.id, reason: 'PASSWORD_RESET' },
    ]);
  });

  it('ends sessions when the email changes, but not for other profile changes', async () => {
    const { ownerAdmin, actor, tenant, owner, tenantSessions } = withOwner();
    await ownerAdmin.updateProfile(actor, tenant.id, { fullName: 'X' }, META);
    expect(tenantSessions.revocations).toEqual([]);
    await ownerAdmin.updateProfile(
      actor,
      tenant.id,
      { email: 'moved@school.lk' },
      META,
    );
    expect(tenantSessions.revocations).toEqual([
      { tenantId: tenant.id, userId: owner.id, reason: 'EMAIL_CHANGED' },
    ]);
  });

  it('disables (ending sessions) and re-enables the owner', async () => {
    const { ownerAdmin, actor, tenant, owner, clock, audit, tenantSessions } =
      withOwner();

    const disabled = await ownerAdmin.disable(actor, tenant.id, META);
    expect(disabled).toMatchObject({
      status: TenantUserStatus.DISABLED,
      disabledAt: clock.now(),
    });
    expect(tenantSessions.revocations).toEqual([
      { tenantId: tenant.id, userId: owner.id, reason: 'USER_DISABLED' },
    ]);
    await expectAppError(
      ownerAdmin.disable(actor, tenant.id, META),
      'OWNER_ALREADY_DISABLED',
    );

    const enabled = await ownerAdmin.enable(actor, tenant.id, META);
    expect(enabled).toMatchObject({
      status: TenantUserStatus.ACTIVE,
      disabledAt: null,
    });
    await expectAppError(
      ownerAdmin.enable(actor, tenant.id, META),
      'OWNER_ALREADY_ACTIVE',
    );
    expect(audit.actions()).toEqual([
      PlatformAuditAction.TENANT_OWNER_DISABLED,
      PlatformAuditAction.TENANT_OWNER_ENABLED,
    ]);
  });

  it('blocks every owner change while the tenant is closed, but still allows reading', async () => {
    const { ownerAdmin, actor, tenant, owner } = withOwner(TenantStatus.CLOSED);

    await expectAppError(
      ownerAdmin.updateProfile(actor, tenant.id, { fullName: 'x' }, META),
      'TENANT_CLOSED',
    );
    await expectAppError(
      ownerAdmin.resetPassword(actor, tenant.id, 'New-Temp-Pass-1', META),
      'TENANT_CLOSED',
    );
    await expectAppError(
      ownerAdmin.disable(actor, tenant.id, META),
      'TENANT_CLOSED',
    );
    expect((await ownerAdmin.get(tenant.id)).id).toBe(owner.id);
  });

  it('returns TENANT_NOT_FOUND for an unknown tenant', async () => {
    const { ownerAdmin, actor } = tenancySetup();
    await expectAppError(
      ownerAdmin.disable(actor, crypto.randomUUID(), META),
      'TENANT_NOT_FOUND',
    );
  });
});
