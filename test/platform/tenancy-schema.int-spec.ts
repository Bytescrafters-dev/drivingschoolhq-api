import type { PrismaClient } from '../../src/generated/prisma/client.js';
import {
  BillingPeriod,
  PlanPriceStatus,
  TenantRole,
  TenantSubscriptionStatus,
} from '../../src/generated/prisma/enums.js';
import { createTestPrisma, resetDatabase } from '../support/database.js';
import { createPlatformAdmin } from '../support/platform-fixtures.js';
import {
  createPlanPrice,
  createPricePlan,
  createSubscription,
  createTenant,
  createTenantUser,
} from '../support/tenancy-fixtures.js';

/**
 * Database-level invariants for plans, tenants, subscriptions and tenant users.
 * These protect the domain even if application code regresses.
 */
describe('Plans, tenants and subscriptions schema invariants (real database)', () => {
  let prisma: PrismaClient;
  let adminId: string;

  beforeAll(() => {
    prisma = createTestPrisma();
  });

  afterAll(() => prisma.$disconnect());

  beforeEach(async () => {
    await resetDatabase(prisma);
    adminId = (await createPlatformAdmin(prisma)).id;
  });

  async function tenantWithPlan() {
    const plan = await createPricePlan(prisma, adminId);
    const price = await createPlanPrice(prisma, plan.id);
    const tenant = await createTenant(prisma, adminId);
    return { plan, price, tenant };
  }

  describe('plan prices', () => {
    it('allows only one ACTIVE price per plan and billing period', async () => {
      const plan = await createPricePlan(prisma, adminId);
      await createPlanPrice(prisma, plan.id, {
        billingPeriod: BillingPeriod.MONTHLY,
      });

      await expect(
        createPlanPrice(prisma, plan.id, {
          billingPeriod: BillingPeriod.MONTHLY,
        }),
      ).rejects.toThrow();
      await expect(
        createPlanPrice(prisma, plan.id, {
          billingPeriod: BillingPeriod.ANNUAL,
        }),
      ).resolves.toBeDefined();
    });

    it('allows a new ACTIVE price once the previous one is archived', async () => {
      const plan = await createPricePlan(prisma, adminId);
      const old = await createPlanPrice(prisma, plan.id);
      await prisma.planPrice.update({
        where: { id: old.id },
        data: { status: PlanPriceStatus.ARCHIVED, archivedAt: new Date() },
      });

      await expect(
        createPlanPrice(prisma, plan.id, { amount: '6000.00' }),
      ).resolves.toBeDefined();
    });

    it('rejects negative amounts and malformed plan codes', async () => {
      const plan = await createPricePlan(prisma, adminId);
      await expect(
        createPlanPrice(prisma, plan.id, { amount: '-1.00' }),
      ).rejects.toThrow(/plan_prices_amount_chk/);
      await expect(
        createPricePlan(prisma, adminId, { code: 'starter' }),
      ).rejects.toThrow(/price_plans_code_format_chk/);
    });
  });

  describe('tenants', () => {
    it('requires a unique, normalised DS code', async () => {
      await createTenant(prisma, adminId, { dsCode: 'DS-0001' });

      await expect(
        createTenant(prisma, adminId, { dsCode: 'DS-0001' }),
      ).rejects.toThrow();
      await expect(
        createTenant(prisma, adminId, { dsCode: ' ds-0002' }),
      ).rejects.toThrow(/tenants_ds_code_normalised_chk/);
    });

    it('cannot be deleted while it has users', async () => {
      const tenant = await createTenant(prisma, adminId);
      await createTenantUser(prisma, {
        tenantId: tenant.id,
        createdByPlatformAdminId: adminId,
      });

      await expect(
        prisma.tenant.delete({ where: { id: tenant.id } }),
      ).rejects.toThrow();
    });
  });

  describe('subscriptions', () => {
    it('allows one ACTIVE and one SCHEDULED subscription per tenant, plus any history', async () => {
      const { plan, price, tenant } = await tenantWithPlan();
      const base = {
        tenantId: tenant.id,
        planId: plan.id,
        planPriceId: price.id,
        createdById: adminId,
      };
      await createSubscription(prisma, {
        ...base,
        status: TenantSubscriptionStatus.ACTIVE,
      });
      await createSubscription(prisma, {
        ...base,
        status: TenantSubscriptionStatus.SCHEDULED,
      });

      await expect(
        createSubscription(prisma, {
          ...base,
          status: TenantSubscriptionStatus.ACTIVE,
        }),
      ).rejects.toThrow();
      await expect(
        createSubscription(prisma, {
          ...base,
          status: TenantSubscriptionStatus.SCHEDULED,
        }),
      ).rejects.toThrow();

      const other = await createTenant(prisma, adminId);
      await expect(
        createSubscription(prisma, {
          ...base,
          tenantId: other.id,
          status: TenantSubscriptionStatus.ACTIVE,
        }),
      ).resolves.toBeDefined();
    });

    it('requires a reason when the agreed amount differs from the list price', async () => {
      const { plan, price, tenant } = await tenantWithPlan();
      const base = {
        tenantId: tenant.id,
        planId: plan.id,
        planPriceId: price.id,
        createdById: adminId,
        listAmount: '5000.00',
        agreedAmount: '4000.00',
      };

      await expect(createSubscription(prisma, base)).rejects.toThrow(
        /tenant_subscriptions_discount_reason_chk/,
      );
      await expect(
        createSubscription(prisma, {
          ...base,
          discountReason: 'Launch partner discount',
        }),
      ).resolves.toMatchObject({ discountReason: 'Launch partner discount' });
    });

    it('rejects a plan price that belongs to a different plan', async () => {
      const { plan, tenant } = await tenantWithPlan();
      const otherPlan = await createPricePlan(prisma, adminId);
      const otherPrice = await createPlanPrice(prisma, otherPlan.id);

      await expect(
        createSubscription(prisma, {
          tenantId: tenant.id,
          planId: plan.id,
          planPriceId: otherPrice.id,
          createdById: adminId,
        }),
      ).rejects.toThrow();
    });
  });

  describe('tenant users', () => {
    it('allows exactly one OWNER per tenant', async () => {
      const a = await createTenant(prisma, adminId);
      const b = await createTenant(prisma, adminId);
      await createTenantUser(prisma, {
        tenantId: a.id,
        role: TenantRole.OWNER,
        createdByPlatformAdminId: adminId,
      });

      await expect(
        createTenantUser(prisma, {
          tenantId: a.id,
          role: TenantRole.OWNER,
          nic: '199112345678',
          createdByPlatformAdminId: adminId,
        }),
      ).rejects.toThrow();
      await expect(
        createTenantUser(prisma, {
          tenantId: b.id,
          role: TenantRole.OWNER,
          createdByPlatformAdminId: adminId,
        }),
      ).resolves.toBeDefined();
    });

    it('requires phone and NIC for the OWNER', async () => {
      const tenant = await createTenant(prisma, adminId);
      await expect(
        createTenantUser(prisma, {
          tenantId: tenant.id,
          role: TenantRole.OWNER,
          nic: null,
          createdByPlatformAdminId: adminId,
        }),
      ).rejects.toThrow(/tenant_users_owner_details_chk/);
    });

    it('scopes email and NIC uniqueness to the tenant', async () => {
      const a = await createTenant(prisma, adminId);
      const b = await createTenant(prisma, adminId);
      const same = {
        email: 'staff@school.lk',
        nic: '901234567V',
        createdByPlatformAdminId: adminId,
      };
      await createTenantUser(prisma, { tenantId: a.id, ...same });

      await expect(
        createTenantUser(prisma, { tenantId: b.id, ...same }),
      ).resolves.toBeDefined();
      await expect(
        createTenantUser(prisma, {
          tenantId: a.id,
          ...same,
          nic: '911234567V',
        }),
      ).rejects.toThrow();
      await expect(
        createTenantUser(prisma, {
          tenantId: a.id,
          ...same,
          email: 'other@school.lk',
        }),
      ).rejects.toThrow();
    });

    it('rejects malformed NIC, phone and non-normalised email', async () => {
      const tenant = await createTenant(prisma, adminId);
      const base = { tenantId: tenant.id, createdByPlatformAdminId: adminId };

      await expect(
        createTenantUser(prisma, { ...base, nic: '12345' }),
      ).rejects.toThrow(/tenant_users_nic_format_chk/);
      await expect(
        createTenantUser(prisma, { ...base, nic: '901234567v' }),
      ).rejects.toThrow(/tenant_users_nic_format_chk/);
      await expect(
        createTenantUser(prisma, { ...base, phone: '0771234567' }),
      ).rejects.toThrow(/tenant_users_phone_format_chk/);
      await expect(
        createTenantUser(prisma, { ...base, email: 'Mixed@School.lk' }),
      ).rejects.toThrow(/tenant_users_email_normalised_chk/);
    });

    it('requires exactly one creator', async () => {
      const tenant = await createTenant(prisma, adminId);
      await expect(
        createTenantUser(prisma, { tenantId: tenant.id }),
      ).rejects.toThrow(/tenant_users_single_creator_chk/);
    });

    it('rejects a creating tenant user from another tenant', async () => {
      const a = await createTenant(prisma, adminId);
      const b = await createTenant(prisma, adminId);
      const ownerA = await createTenantUser(prisma, {
        tenantId: a.id,
        role: TenantRole.OWNER,
        createdByPlatformAdminId: adminId,
      });

      await expect(
        createTenantUser(prisma, {
          tenantId: a.id,
          createdByTenantUserId: ownerA.id,
        }),
      ).resolves.toBeDefined();
      await expect(
        createTenantUser(prisma, {
          tenantId: b.id,
          createdByTenantUserId: ownerA.id,
        }),
      ).rejects.toThrow();
    });
  });
});
