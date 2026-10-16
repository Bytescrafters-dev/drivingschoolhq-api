import { Test, type TestingModule } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.js';
import { AppError } from '../../src/common/errors/app-error.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { District } from '../../src/generated/prisma/enums.js';
import { PLATFORM_AUDIT_REPOSITORY } from '../../src/platform/audit/interfaces/platform-audit.repository.js';
import {
  type CreateTenantInput,
  TenantsService,
} from '../../src/platform/tenants/tenants.service.js';
import { createTestPrisma, resetDatabase } from '../support/database.js';
import { META, actorFrom } from '../support/fakes.js';
import { createPlatformAdmin } from '../support/platform-fixtures.js';
import {
  createPlanPrice,
  createPricePlan,
} from '../support/tenancy-fixtures.js';

function input(planPriceId: string, dsCode = 'DS1'): CreateTenantInput {
  return {
    tenant: {
      dsCode,
      name: 'School',
      displayName: 'School',
      address: 'Colombo',
      district: District.COLOMBO,
      phone: '0771234567',
    },
    subscription: { planPriceId },
    owner: {
      fullName: 'Owner',
      email: 'owner@school.lk',
      phone: '0771234567',
      nic: '199012345678',
      temporaryPassword: 'Owner-Temp-Pass-1',
    },
  };
}

describe('Tenants persistence (real database)', () => {
  let prisma: PrismaClient;
  let moduleRef: TestingModule;
  let service: TenantsService;

  beforeAll(async () => {
    prisma = createTestPrisma();
    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    await moduleRef.init();
    service = moduleRef.get(TenantsService);
  });

  afterAll(async () => {
    await moduleRef.close();
    await prisma.$disconnect();
  });

  beforeEach(() => resetDatabase(prisma));

  async function setup() {
    const admin = await createPlatformAdmin(prisma);
    const plan = await createPricePlan(prisma, admin.id);
    const price = await createPlanPrice(prisma, plan.id);
    return { actor: actorFrom(admin), price };
  }

  async function counts() {
    return {
      tenants: await prisma.tenant.count(),
      access: await prisma.tenantAccess.count(),
      subscriptions: await prisma.tenantSubscription.count(),
      users: await prisma.tenantUser.count(),
    };
  }

  it('creates nothing when the audit write fails', async () => {
    const { actor, price } = await setup();
    const failing = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PLATFORM_AUDIT_REPOSITORY)
      .useValue({
        append: async () => {
          throw new Error('audit store unavailable');
        },
        listNewestFirst: async () => [],
      })
      .compile();
    await failing.init();
    try {
      await expect(
        failing.get(TenantsService).createTenant(actor, input(price.id), META),
      ).rejects.toThrow('audit store unavailable');
    } finally {
      await failing.close();
    }
    expect(await counts()).toEqual({
      tenants: 0,
      access: 0,
      subscriptions: 0,
      users: 0,
    });
  });

  it('lets only one of two concurrent creates with the same DS code win', async () => {
    const { actor, price } = await setup();
    const results = await Promise.allSettled([
      service.createTenant(actor, input(price.id, 'DS777'), META),
      service.createTenant(actor, input(price.id, 'ds777'), META),
    ]);
    const rejected = results.filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBeInstanceOf(AppError);
    expect((rejected[0]!.reason as AppError).code).toBe('TENANT_DS_CODE_TAKEN');
    expect(await counts()).toEqual({
      tenants: 1,
      access: 1,
      subscriptions: 1,
      users: 1,
    });
  });

  it('keeps users and history across close and reopen, with exactly one active subscription', async () => {
    const { actor, price } = await setup();
    const created = await service.createTenant(actor, input(price.id), META);
    const tenantId = created.tenant.id;

    await service.close(actor, tenantId, 'Paused', META);
    await service.reopen(actor, tenantId, { planPriceId: price.id }, META);

    const subs = await prisma.tenantSubscription.findMany({
      where: { tenantId },
    });
    expect(subs.filter((s) => s.status === 'ACTIVE')).toHaveLength(1);
    expect(subs.filter((s) => s.status === 'ENDED')).toHaveLength(1);
    const users = await prisma.tenantUser.findMany({ where: { tenantId } });
    expect(users.map((u) => u.id)).toEqual([created.owner!.id]);
    expect(users[0]!.status).toBe('ACTIVE');
  });

  it('stores calendar dates without a time shift', async () => {
    const { actor, price } = await setup();
    const created = await service.createTenant(actor, input(price.id), META);
    const raw = await prisma.$queryRaw<{ start: string }[]>`
      SELECT "startDate"::text AS start FROM tenant_subscriptions
      WHERE "tenantId" = ${created.tenant.id}::uuid`;
    expect(raw[0]!.start).toBe(
      created.subscription!.startDate.toISOString().slice(0, 10),
    );
  });
});
