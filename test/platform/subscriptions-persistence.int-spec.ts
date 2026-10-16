import { Test, type TestingModule } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.js';
import {
  businessToday,
  toIsoDate,
} from '../../src/common/time/calendar-date.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { District } from '../../src/generated/prisma/enums.js';
import { SubscriptionRenewalJob } from '../../src/platform/tenants/subscription-renewal.job.js';
import { TenantSubscriptionsService } from '../../src/platform/tenants/tenant-subscriptions.service.js';
import { TenantsService } from '../../src/platform/tenants/tenants.service.js';
import { createTestPrisma, resetDatabase } from '../support/database.js';
import { META, actorFrom } from '../support/fakes.js';
import { createPlatformAdmin } from '../support/platform-fixtures.js';
import {
  createPlanPrice,
  createPricePlan,
} from '../support/tenancy-fixtures.js';

describe('Subscription changes and renewal (real database)', () => {
  let prisma: PrismaClient;
  let moduleRef: TestingModule;
  let tenants: TenantsService;
  let tenantSubscriptions: TenantSubscriptionsService;
  let job: SubscriptionRenewalJob;

  beforeAll(async () => {
    prisma = createTestPrisma();
    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    await moduleRef.init();
    tenants = moduleRef.get(TenantsService);
    tenantSubscriptions = moduleRef.get(TenantSubscriptionsService);
    job = moduleRef.get(SubscriptionRenewalJob);
  });

  afterAll(async () => {
    await moduleRef.close();
    await prisma.$disconnect();
  });

  beforeEach(() => resetDatabase(prisma));

  async function tenantWithScheduledChange(dsCode = 'DS1') {
    const admin = await createPlatformAdmin(prisma);
    const actor = actorFrom(admin);
    const plan = await createPricePlan(prisma, admin.id);
    const monthly = await createPlanPrice(prisma, plan.id);
    const otherPlan = await createPricePlan(prisma, admin.id);
    const annual = await createPlanPrice(prisma, otherPlan.id, {
      billingPeriod: 'ANNUAL',
      amount: '50000.00',
    });
    const created = await tenants.createTenant(
      actor,
      {
        tenant: {
          dsCode,
          name: 'School',
          displayName: 'School',
          address: 'Colombo',
          district: District.COLOMBO,
          phone: '0771234567',
        },
        subscription: { planPriceId: monthly.id },
        owner: {
          fullName: 'Owner',
          email: 'owner@school.lk',
          phone: '0771234567',
          nic: '199012345678',
          temporaryPassword: 'Owner-Temp-Pass-1',
        },
      },
      META,
    );
    const view = await tenantSubscriptions.scheduleChange(
      actor,
      created.tenant.id,
      { planPriceId: annual.id },
      META,
    );
    return {
      actor,
      tenantId: created.tenant.id,
      activeId: view.subscription!.id,
      scheduledId: view.scheduledSubscription!.id,
      annual,
    };
  }

  /** Simulates the renewal date arriving by moving the active start back. */
  async function makeDue(activeId: string, scheduledId: string) {
    const today = businessToday(new Date());
    await prisma.tenantSubscription.update({
      where: { id: activeId },
      data: { startDate: new Date(today.getTime() - 31 * 86_400_000) },
    });
    await prisma.tenantSubscription.update({
      where: { id: scheduledId },
      data: { startDate: today },
    });
    return today;
  }

  it('schedules the change for the next renewal date', async () => {
    const { scheduledId, activeId } = await tenantWithScheduledChange();
    const [active, scheduled] = await Promise.all([
      prisma.tenantSubscription.findUniqueOrThrow({ where: { id: activeId } }),
      prisma.tenantSubscription.findUniqueOrThrow({
        where: { id: scheduledId },
      }),
    ]);
    const expected = new Date(active.startDate);
    expected.setUTCMonth(expected.getUTCMonth() + 1);
    expect(toIsoDate(scheduled.startDate)).toBe(toIsoDate(expected));
  });

  it('the renewal job activates due changes exactly once', async () => {
    const { tenantId, activeId, scheduledId } =
      await tenantWithScheduledChange();
    const today = await makeDue(activeId, scheduledId);

    expect(await job.run()).toBe(1);
    expect(await job.run()).toBe(0);

    const rows = await prisma.tenantSubscription.findMany({
      where: { tenantId },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(activeId)).toMatchObject({ status: 'ENDED' });
    expect(toIsoDate(byId.get(activeId)!.endDate!)).toBe(
      toIsoDate(new Date(today.getTime() - 86_400_000)),
    );
    expect(byId.get(scheduledId)).toMatchObject({ status: 'ACTIVE' });
    const audit = await prisma.platformAuditLog.findMany({
      where: { action: 'SUBSCRIPTION_ACTIVATED' },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.actorAdminId).toBeNull();
  });

  it('activates once when two workers race', async () => {
    const { tenantId, activeId, scheduledId } =
      await tenantWithScheduledChange();
    await makeDue(activeId, scheduledId);

    const results = await Promise.all([
      tenantSubscriptions.activateDueChange(tenantId),
      tenantSubscriptions.activateDueChange(tenantId),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(
      await prisma.tenantSubscription.count({
        where: { tenantId, status: 'ACTIVE' },
      }),
    ).toBe(1);
  });

  it('closing a tenant while its change activates leaves no current subscription and no deadlock', async () => {
    const { actor, tenantId, activeId, scheduledId } =
      await tenantWithScheduledChange();
    await makeDue(activeId, scheduledId);

    const results = await Promise.allSettled([
      tenants.close(actor, tenantId, 'Closing', META),
      tenantSubscriptions.activateDueChange(tenantId),
    ]);

    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(
      await prisma.tenantSubscription.count({
        where: { tenantId, status: { in: ['ACTIVE', 'SCHEDULED'] } },
      }),
    ).toBe(0);
  });

  it('keeps a single scheduled change under concurrent scheduling', async () => {
    const { actor, tenantId, annual } = await tenantWithScheduledChange();

    const results = await Promise.allSettled(
      ['45000', '44000', '43000'].map((agreedAmount) =>
        tenantSubscriptions.scheduleChange(
          actor,
          tenantId,
          { planPriceId: annual.id, agreedAmount, discountReason: 'Deal' },
          META,
        ),
      ),
    );

    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(
      await prisma.tenantSubscription.count({
        where: { tenantId, status: 'SCHEDULED' },
      }),
    ).toBe(1);
    expect(
      await prisma.tenantSubscription.count({
        where: { tenantId, status: 'CANCELLED' },
      }),
    ).toBe(3);
  });
});
