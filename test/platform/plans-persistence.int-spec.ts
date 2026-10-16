import { Test, type TestingModule } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import {
  BillingPeriod,
  PlanLimitCode,
  PlanPriceStatus,
  PricePlanStatus,
} from '../../src/generated/prisma/enums.js';
import { PLATFORM_AUDIT_REPOSITORY } from '../../src/platform/audit/interfaces/platform-audit.repository.js';
import { PlansService } from '../../src/platform/plans/plans.service.js';
import { createTestPrisma, resetDatabase } from '../support/database.js';
import { META, actorFrom } from '../support/fakes.js';
import { createPlatformAdmin } from '../support/platform-fixtures.js';

const FULL_LIMITS = Object.values(PlanLimitCode).map((code) => ({
  code,
  value: 10,
}));

describe('Plans persistence (real database)', () => {
  let prisma: PrismaClient;
  let moduleRef: TestingModule;
  let service: PlansService;

  beforeAll(async () => {
    prisma = createTestPrisma();
    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    await moduleRef.init();
    service = moduleRef.get(PlansService);
  });

  afterAll(async () => {
    await moduleRef.close();
    await prisma.$disconnect();
  });

  beforeEach(() => resetDatabase(prisma));

  async function actor() {
    return actorFrom(await createPlatformAdmin(prisma));
  }

  it('serializes concurrent price changes so exactly one price stays active', async () => {
    const a = await actor();
    const plan = await service.createPlan(
      a,
      {
        code: 'RACE',
        name: 'Race',
        prices: [{ billingPeriod: BillingPeriod.MONTHLY, amount: '1000' }],
      },
      META,
    );

    const results = await Promise.allSettled(
      ['2000', '3000', '4000'].map((amount) =>
        service.setPrice(a, plan.id, BillingPeriod.MONTHLY, amount, META),
      ),
    );

    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    const prices = await prisma.planPrice.findMany({
      where: { planId: plan.id },
    });
    expect(prices).toHaveLength(4);
    expect(
      prices.filter((p) => p.status === PlanPriceStatus.ACTIVE),
    ).toHaveLength(1);
  });

  it('never leaves an ACTIVE plan without a price when activation races with archiving the last price', async () => {
    const a = await actor();
    const plan = await service.createPlan(
      a,
      {
        code: 'EDGE',
        name: 'Edge',
        prices: [{ billingPeriod: BillingPeriod.MONTHLY, amount: '1000' }],
        limits: FULL_LIMITS,
      },
      META,
    );

    await Promise.allSettled([
      service.activate(a, plan.id, META),
      service.archivePrice(a, plan.id, plan.prices[0]!.id, META),
    ]);

    const stored = await prisma.pricePlan.findUniqueOrThrow({
      where: { id: plan.id },
      include: { prices: { where: { status: PlanPriceStatus.ACTIVE } } },
    });
    if (stored.status === PricePlanStatus.ACTIVE) {
      expect(stored.prices).toHaveLength(1);
    }
  });

  it('round-trips amounts exactly', async () => {
    const a = await actor();
    const plan = await service.createPlan(
      a,
      {
        code: 'PRECISE',
        name: 'Precise',
        prices: [
          { billingPeriod: BillingPeriod.MONTHLY, amount: '9999999999.99' },
          { billingPeriod: BillingPeriod.ANNUAL, amount: '0.1' },
        ],
      },
      META,
    );
    const reloaded = await service.get(plan.id);
    expect(reloaded.prices.map((p) => p.amount)).toEqual([
      '9999999999.99',
      '0.10',
    ]);
  });

  it('rolls back a price change when the audit write fails', async () => {
    const a = await actor();
    const plan = await service.createPlan(
      a,
      {
        code: 'ROLLBACK',
        name: 'Rollback',
        prices: [{ billingPeriod: BillingPeriod.MONTHLY, amount: '1000' }],
      },
      META,
    );

    const failingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PLATFORM_AUDIT_REPOSITORY)
      .useValue({
        append: async () => {
          throw new Error('audit store unavailable');
        },
        listNewestFirst: async () => [],
      })
      .compile();
    await failingModule.init();
    try {
      await expect(
        failingModule
          .get(PlansService)
          .setPrice(a, plan.id, BillingPeriod.MONTHLY, '2000', META),
      ).rejects.toThrow('audit store unavailable');
    } finally {
      await failingModule.close();
    }

    const prices = await prisma.planPrice.findMany({
      where: { planId: plan.id },
    });
    expect(prices).toHaveLength(1);
    expect(prices[0]).toMatchObject({ status: PlanPriceStatus.ACTIVE });
    expect(prices[0]!.amount.toFixed(2)).toBe('1000.00');
  });

  it('refuses to delete a plan that a subscription references, even if forced to DRAFT', async () => {
    const a = await actor();
    const plan = await service.createPlan(
      a,
      {
        code: 'USED',
        name: 'Used',
        prices: [{ billingPeriod: BillingPeriod.MONTHLY, amount: '1000' }],
      },
      META,
    );
    const tenant = await prisma.tenant.create({
      data: {
        dsCode: 'DS1',
        name: 'School',
        displayName: 'School',
        address: 'Colombo',
        district: 'COLOMBO',
        phone: '+94771234567',
        createdById: a.id,
      },
    });
    await prisma.tenantSubscription.create({
      data: {
        tenantId: tenant.id,
        planId: plan.id,
        planPriceId: plan.prices[0]!.id,
        planCode: plan.code,
        planName: plan.name,
        billingPeriod: BillingPeriod.MONTHLY,
        listAmount: '1000',
        agreedAmount: '1000',
        gracePeriodDays: 7,
        status: 'ACTIVE',
        startDate: new Date('2026-10-01'),
        createdById: a.id,
      },
    });

    await expect(service.deletePlan(a, plan.id, META)).rejects.toThrow();
    expect(await prisma.pricePlan.count({ where: { id: plan.id } })).toBe(1);
  });
});
