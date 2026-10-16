import {
  District,
  TenantAccessStatus,
  TenantStatus,
  TenantSubscriptionStatus,
} from '../../generated/prisma/enums.js';
import { META, expectAppError } from '../../../test/support/fakes.js';
import { tenancySetup } from '../../../test/support/tenancy-unit.js';
import { PlatformAuditAction } from '../audit/common/platform-audit-action.js';
import type { CreateTenantInput } from './tenants.service.js';

function createInput(planPriceId: string): CreateTenantInput {
  return {
    tenant: {
      dsCode: ' ds0001 ',
      name: ' Lanka Driving School (Pvt) Ltd ',
      displayName: 'Lanka DS',
      address: '12 Galle Road, Colombo 03',
      district: District.COLOMBO,
      phone: '0112345678',
    },
    subscription: { planPriceId, trialEndDate: '2026-10-21' },
    owner: {
      fullName: 'Owner Person',
      email: ' Owner@Lanka.LK ',
      phone: '0771234567',
      nic: '901234567v',
      temporaryPassword: 'Owner-Temp-Pass-1',
    },
  };
}

describe('TenantsService', () => {
  describe('createTenant', () => {
    it('creates tenant, active access, subscription and owner, and audits each', async () => {
      const { service, actor, subscribablePrice, users, audit } =
        tenancySetup();
      const { price } = subscribablePrice();

      const details = await service.createTenant(
        actor,
        createInput(price.id),
        META,
      );

      expect(details.tenant).toMatchObject({
        dsCode: 'DS0001',
        name: 'Lanka Driving School (Pvt) Ltd',
        phone: '+94112345678',
        status: TenantStatus.ACTIVE,
        createdById: actor.id,
      });
      expect(details.access?.status).toBe(TenantAccessStatus.ACTIVE);
      expect(details.subscription).toMatchObject({
        status: TenantSubscriptionStatus.ACTIVE,
        agreedAmount: '5000.00',
      });
      expect(details.owner).toMatchObject({
        email: 'owner@lanka.lk',
        phone: '+94771234567',
        nic: '901234567V',
        role: 'OWNER',
        mustChangePassword: true,
        createdByPlatformAdminId: actor.id,
      });
      expect(users.rows[0]!.passwordHash).toBe('hashed:Owner-Temp-Pass-1');
      expect(audit.actions()).toEqual([
        PlatformAuditAction.TENANT_CREATED,
        PlatformAuditAction.SUBSCRIPTION_CREATED,
        PlatformAuditAction.TENANT_OWNER_CREATED,
      ]);
    });

    it('never writes the password or NIC to the audit log', async () => {
      const { service, actor, subscribablePrice, audit } = tenancySetup();
      const { price } = subscribablePrice();
      await service.createTenant(actor, createInput(price.id), META);

      const serialized = JSON.stringify(audit.entries);
      expect(serialized).not.toContain('Owner-Temp-Pass-1');
      expect(serialized).not.toContain('901234567');
    });

    it('rejects a duplicate DS code', async () => {
      const { service, actor, subscribablePrice, tenants } = tenancySetup();
      const { price } = subscribablePrice();
      tenants.seed({ dsCode: 'DS0001' });
      await expectAppError(
        service.createTenant(actor, createInput(price.id), META),
        'TENANT_DS_CODE_TAKEN',
      );
    });

    it.each<
      [
        string,
        {
          tenant?: { phone: string };
          owner?: { phone?: string; nic?: string };
        },
        string,
      ]
    >([
      ['tenant phone', { tenant: { phone: '12345' } }, 'INVALID_PHONE'],
      ['owner phone', { owner: { phone: '+1 202 555 0100' } }, 'INVALID_PHONE'],
      ['owner NIC', { owner: { nic: 'ABC' } }, 'INVALID_NIC'],
    ])('rejects an invalid %s', async (_label, patch, code) => {
      const { service, actor, subscribablePrice } = tenancySetup();
      const { price } = subscribablePrice();
      const input = createInput(price.id);
      await expectAppError(
        service.createTenant(
          actor,
          {
            ...input,
            tenant: { ...input.tenant, ...patch.tenant },
            owner: { ...input.owner, ...patch.owner },
          },
          META,
        ),
        code,
      );
    });
  });

  describe('updateProfile', () => {
    it('updates and audits only changed fields', async () => {
      const { service, actor, tenants, audit } = tenancySetup();
      const tenant = tenants.seed({
        displayName: 'Old',
        phone: '+94771234567',
      });

      const details = await service.updateProfile(
        actor,
        tenant.id,
        { displayName: 'New', phone: '0771234567', dsCode: 'ds9' },
        META,
      );

      expect(details.tenant).toMatchObject({
        displayName: 'New',
        dsCode: 'DS9',
      });
      expect(audit.entries[0]!.metadata).toEqual({
        displayName: { from: 'Old', to: 'New' },
        dsCode: { from: tenant.dsCode, to: 'DS9' },
      });
    });

    it('refuses to edit a closed tenant', async () => {
      const { service, actor, tenants } = tenancySetup();
      const tenant = tenants.seed({
        status: TenantStatus.CLOSED,
        closedAt: new Date(),
      });
      await expectAppError(
        service.updateProfile(actor, tenant.id, { name: 'x' }, META),
        'TENANT_CLOSED',
      );
    });

    it('returns TENANT_NOT_FOUND for an unknown tenant', async () => {
      const { service, actor } = tenancySetup();
      await expectAppError(
        service.updateProfile(actor, crypto.randomUUID(), { name: 'x' }, META),
        'TENANT_NOT_FOUND',
      );
    });
  });

  describe('close and reopen', () => {
    it('closes a tenant, ending subscriptions and sessions but keeping the owner', async () => {
      const {
        service,
        actor,
        subscribablePrice,
        audit,
        clock,
        tenantSessions,
      } = tenancySetup();
      const { price } = subscribablePrice();
      const created = await service.createTenant(
        actor,
        createInput(price.id),
        META,
      );
      audit.entries.length = 0;

      const closed = await service.close(
        actor,
        created.tenant.id,
        ' Contract ended ',
        META,
      );

      expect(closed.tenant).toMatchObject({
        status: TenantStatus.CLOSED,
        closedAt: clock.now(),
      });
      expect(closed.subscription).toBeNull();
      expect(closed.owner?.id).toBe(created.owner?.id);
      expect(audit.actions()).toEqual([
        PlatformAuditAction.SUBSCRIPTION_ENDED,
        PlatformAuditAction.TENANT_CLOSED,
      ]);
      expect(audit.entries[1]!.metadata).toEqual({ reason: 'Contract ended' });
      expect(tenantSessions.revocations).toEqual([
        { tenantId: created.tenant.id, userId: null, reason: 'TENANT_CLOSED' },
      ]);
    });

    it('refuses to close twice', async () => {
      const { service, actor, tenants } = tenancySetup();
      const tenant = tenants.seed({
        status: TenantStatus.CLOSED,
        closedAt: new Date(),
      });
      await expectAppError(
        service.close(actor, tenant.id, 'again', META),
        'TENANT_ALREADY_CLOSED',
      );
    });

    it('reopens with a new subscription, restores access and keeps history', async () => {
      const { service, actor, subscribablePrice, tenants, subscriptionRows } =
        tenancySetup();
      const { price } = subscribablePrice();
      const created = await service.createTenant(
        actor,
        createInput(price.id),
        META,
      );
      await service.close(actor, created.tenant.id, 'Unpaid', META);
      await tenants.setAccessStatus(
        created.tenant.id,
        TenantAccessStatus.SUSPENDED,
        new Date(),
      );

      const reopened = await service.reopen(
        actor,
        created.tenant.id,
        { planPriceId: price.id },
        META,
      );

      expect(reopened.tenant).toMatchObject({
        status: TenantStatus.ACTIVE,
        closedAt: null,
      });
      expect(reopened.access?.status).toBe(TenantAccessStatus.ACTIVE);
      expect(reopened.subscription?.id).not.toBe(created.subscription?.id);
      expect(reopened.owner?.id).toBe(created.owner?.id);
      expect(
        subscriptionRows.forTenant(created.tenant.id).map((s) => s.status),
      ).toEqual([
        TenantSubscriptionStatus.ENDED,
        TenantSubscriptionStatus.ACTIVE,
      ]);
    });

    it('refuses to reopen an active tenant', async () => {
      const { service, actor, tenants, subscribablePrice } = tenancySetup();
      const { price } = subscribablePrice();
      const tenant = tenants.seed();
      await expectAppError(
        service.reopen(actor, tenant.id, { planPriceId: price.id }, META),
        'TENANT_NOT_CLOSED',
      );
    });
  });
});

describe('DS code format', () => {
  it.each(['DS119', 'ds1234', ' DS0001 '])('accepts %s', async (dsCode) => {
    const { service, actor, tenants } = tenancySetup();
    const tenant = tenants.seed();
    const details = await service.updateProfile(
      actor,
      tenant.id,
      { dsCode },
      META,
    );
    expect(details.tenant.dsCode).toBe(dsCode.trim().toUpperCase());
  });

  it.each(['DS-119', 'XY119', 'DS', 'DS12A', '119'])(
    'rejects %s',
    async (dsCode) => {
      const { service, actor, tenants } = tenancySetup();
      const tenant = tenants.seed();
      await expectAppError(
        service.updateProfile(actor, tenant.id, { dsCode }, META),
        'INVALID_DS_CODE',
      );
    },
  );
});
