import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import {
  businessToday,
  toIsoDate,
} from '../../src/common/time/calendar-date.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import {
  PlatformRole,
  PricePlanStatus,
} from '../../src/generated/prisma/enums.js';
import { createTestPrisma, resetDatabase } from '../support/database.js';
import { createPlatformAdmin } from '../support/platform-fixtures.js';
import {
  createPlanPrice,
  createPricePlan,
} from '../support/tenancy-fixtures.js';

const PASSWORD = 'Fixture-Password-1';

function daysFromToday(days: number): string {
  const today = businessToday(new Date());
  return toIsoDate(new Date(today.getTime() + days * 86_400_000));
}

describe('Platform tenants (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    prisma = createTestPrisma();
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(() => resetDatabase(prisma));

  async function tokenFor(role: PlatformRole) {
    const admin = await createPlatformAdmin(prisma, {
      role,
      password: PASSWORD,
    });
    const res = await http()
      .post('/platform/auth/login')
      .send({ email: admin.email, password: PASSWORD })
      .expect(200);
    return { token: res.body.accessToken as string, admin };
  }

  async function activePrice(status: PricePlanStatus = PricePlanStatus.ACTIVE) {
    const creator = await createPlatformAdmin(prisma);
    const plan = await createPricePlan(prisma, creator.id, { status });
    return createPlanPrice(prisma, plan.id, { amount: '5000.00' });
  }

  function body(planPriceId: string, overrides: Record<string, unknown> = {}) {
    return {
      tenant: {
        dsCode: 'ds0001',
        name: 'Lanka Driving School (Pvt) Ltd',
        displayName: 'Lanka DS',
        address: '12 Galle Road, Colombo 03',
        district: 'COLOMBO',
        phone: '011 234 5678',
      },
      subscription: { planPriceId },
      owner: {
        fullName: 'Owner Person',
        email: 'Owner@Lanka.lk',
        phone: '0771234567',
        nic: '199012345678',
        temporaryPassword: 'Owner-Temp-Pass-1',
      },
      ...overrides,
    };
  }

  it('operations admin onboards a school, closes and reopens it with history and audit preserved', async () => {
    const { token } = await tokenFor(PlatformRole.OPERATIONS_ADMIN);
    const price = await activePrice();
    const trialEnd = daysFromToday(14);

    const created = await http()
      .post('/platform/tenants')
      .set(bearer(token))
      .send(
        body(price.id, {
          subscription: {
            planPriceId: price.id,
            trialEndDate: trialEnd,
            agreedAmount: '4500',
            discountReason: 'Early adopter',
          },
        }),
      )
      .expect(201);
    const tenantId = created.body.id as string;

    expect(created.body).toMatchObject({
      dsCode: 'DS0001',
      phone: '+94112345678',
      district: 'COLOMBO',
      status: 'ACTIVE',
      access: { status: 'ACTIVE' },
      subscription: {
        status: 'ACTIVE',
        billingPeriod: 'MONTHLY',
        listAmount: '5000.00',
        agreedAmount: '4500.00',
        discountReason: 'Early adopter',
        gracePeriodDays: 7,
        startDate: daysFromToday(0),
        trialEndDate: trialEnd,
        endDate: null,
      },
      scheduledSubscription: null,
      owner: {
        email: 'owner@lanka.lk',
        phone: '+94771234567',
        nic: '199012345678',
        role: 'OWNER',
        status: 'ACTIVE',
        mustChangePassword: true,
      },
    });
    expect(JSON.stringify(created.body)).not.toMatch(/passwordHash|Owner-Temp/);
    const owner = await prisma.tenantUser.findFirstOrThrow({
      where: { tenantId },
    });
    expect(owner.passwordHash).toMatch(/^\$argon2id\$/);

    await http()
      .post(`/platform/tenants/${tenantId}/close`)
      .set(bearer(token))
      .send({ reason: 'Owner requested' })
      .expect(200)
      .expect(({ body: res }) => {
        expect(res.status).toBe('CLOSED');
        expect(res.subscription).toBeNull();
        expect(res.owner.id).toBe(owner.id);
      });

    await http()
      .patch(`/platform/tenants/${tenantId}`)
      .set(bearer(token))
      .send({ displayName: 'Nope' })
      .expect(409)
      .expect(({ body: res }) => expect(res.code).toBe('TENANT_CLOSED'));

    const reopened = await http()
      .post(`/platform/tenants/${tenantId}/reopen`)
      .set(bearer(token))
      .send({ planPriceId: price.id })
      .expect(200);
    expect(reopened.body).toMatchObject({
      status: 'ACTIVE',
      closedAt: null,
      access: { status: 'ACTIVE' },
      subscription: { status: 'ACTIVE', agreedAmount: '5000.00' },
      owner: { id: owner.id },
    });

    const history = await prisma.tenantSubscription.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
    });
    expect(history.map((s) => s.status)).toEqual(['ENDED', 'ACTIVE']);

    const actions = (
      await prisma.platformAuditLog.findMany({ orderBy: { createdAt: 'asc' } })
    )
      .map((e) => e.action)
      .filter((a) => a.startsWith('TENANT') || a.startsWith('SUBSCRIPTION'));
    expect(actions).toEqual([
      'TENANT_CREATED',
      'SUBSCRIPTION_CREATED',
      'TENANT_OWNER_CREATED',
      'SUBSCRIPTION_ENDED',
      'TENANT_CLOSED',
      'TENANT_REOPENED',
      'SUBSCRIPTION_CREATED',
    ]);
  });

  it('lists and filters tenants with their current plan', async () => {
    const { token } = await tokenFor(PlatformRole.SUPER_ADMIN);
    const price = await activePrice();
    await http()
      .post('/platform/tenants')
      .set(bearer(token))
      .send(body(price.id))
      .expect(201);
    const second = body(price.id);
    second.tenant = {
      ...second.tenant,
      dsCode: 'DS0002',
      name: 'Kandy Drivers',
      displayName: 'Kandy',
      district: 'KANDY',
    };
    await http()
      .post('/platform/tenants')
      .set(bearer(token))
      .send(second)
      .expect(201);

    const res = await http()
      .get('/platform/tenants?district=KANDY&accessStatus=ACTIVE')
      .set(bearer(token))
      .expect(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0]).toMatchObject({
      dsCode: 'DS0002',
      accessStatus: 'ACTIVE',
      currentPlan: { planName: 'Fixture Plan', billingPeriod: 'MONTHLY' },
    });

    const search = await http()
      .get('/platform/tenants?search=ds0001')
      .set(bearer(token))
      .expect(200);
    expect(search.body.items.map((t: { dsCode: string }) => t.dsCode)).toEqual([
      'DS0001',
    ]);
  });

  it('rejects a duplicate DS code on create and on update', async () => {
    const { token } = await tokenFor(PlatformRole.SUPER_ADMIN);
    const price = await activePrice();
    const first = await http()
      .post('/platform/tenants')
      .set(bearer(token))
      .send(body(price.id))
      .expect(201);
    await http()
      .post('/platform/tenants')
      .set(bearer(token))
      .send(body(price.id))
      .expect(409)
      .expect(({ body: res }) => expect(res.code).toBe('TENANT_DS_CODE_TAKEN'));

    const other = body(price.id);
    other.tenant = { ...other.tenant, dsCode: 'DS0002' };
    await http()
      .post('/platform/tenants')
      .set(bearer(token))
      .send(other)
      .expect(201);

    await http()
      .patch(`/platform/tenants/${first.body.id}`)
      .set(bearer(token))
      .send({ dsCode: 'ds0002' })
      .expect(409)
      .expect(({ body: res }) => expect(res.code).toBe('TENANT_DS_CODE_TAKEN'));
    expect(await prisma.tenant.count()).toBe(2);
  });

  it('refuses to subscribe to a draft plan and leaves nothing behind', async () => {
    const { token } = await tokenFor(PlatformRole.SUPER_ADMIN);
    const price = await activePrice(PricePlanStatus.DRAFT);
    await http()
      .post('/platform/tenants')
      .set(bearer(token))
      .send(body(price.id))
      .expect(409)
      .expect(({ body: res }) =>
        expect(res.code).toBe('PLAN_NOT_SUBSCRIBABLE'),
      );
    expect(await prisma.tenant.count()).toBe(0);
    expect(await prisma.tenantUser.count()).toBe(0);
  });

  it.each([
    [
      'past trial end',
      { subscription: { trialEndDate: daysFromToday(-1) } },
      'INVALID_TRIAL_END_DATE',
    ],
    [
      'discount without reason',
      { subscription: { agreedAmount: '100' } },
      'DISCOUNT_REASON_REQUIRED',
    ],
    ['invalid owner phone', { owner: { phone: '12345' } }, 'VALIDATION_FAILED'],
    ['invalid NIC', { owner: { nic: '1234' } }, 'VALIDATION_FAILED'],
    [
      'invalid tenant phone',
      { tenant: { phone: '+1 202 555 0100' } },
      'VALIDATION_FAILED',
    ],
    [
      'malformed DS code',
      { tenant: { dsCode: 'DS-119' } },
      'VALIDATION_FAILED',
    ],
    [
      'unknown district',
      { tenant: { district: 'ATLANTIS' } },
      'VALIDATION_FAILED',
    ],
    [
      'short password',
      { owner: { temporaryPassword: 'short' } },
      'VALIDATION_FAILED',
    ],
    [
      'start date given',
      { subscription: { startDate: '2026-01-01' } },
      'VALIDATION_FAILED',
    ],
  ])('rejects %s', async (_label, patch, code) => {
    const { token } = await tokenFor(PlatformRole.SUPER_ADMIN);
    const price = await activePrice();
    const base = body(price.id) as Record<string, Record<string, unknown>>;
    const payload = Object.fromEntries(
      Object.entries(base).map(([key, value]) => [
        key,
        { ...value, ...(patch as Record<string, object>)[key] },
      ]),
    );
    await http()
      .post('/platform/tenants')
      .set(bearer(token))
      .send(payload)
      .expect(400)
      .expect(({ body: res }) => expect(res.code).toBe(code));
  });

  it('rejects a body without an owner', async () => {
    const { token } = await tokenFor(PlatformRole.SUPER_ADMIN);
    const price = await activePrice();
    const { owner: _owner, ...withoutOwner } = body(price.id);
    await http()
      .post('/platform/tenants')
      .set(bearer(token))
      .send(withoutOwner)
      .expect(400);
  });

  it.each([PlatformRole.BILLING_ADMIN, PlatformRole.SUPPORT])(
    '%s can read tenants but cannot create or close them',
    async (role) => {
      const { token } = await tokenFor(role);
      const price = await activePrice();
      await http().get('/platform/tenants').set(bearer(token)).expect(200);
      await http()
        .post('/platform/tenants')
        .set(bearer(token))
        .send(body(price.id))
        .expect(403);
      await http()
        .post(`/platform/tenants/${crypto.randomUUID()}/close`)
        .set(bearer(token))
        .send({ reason: 'x' })
        .expect(403);
      expect(await prisma.tenant.count()).toBe(0);
    },
  );

  it('returns 404 for an unknown tenant', async () => {
    const { token } = await tokenFor(PlatformRole.SUPER_ADMIN);
    await http()
      .get(`/platform/tenants/${crypto.randomUUID()}`)
      .set(bearer(token))
      .expect(404)
      .expect(({ body: res }) => expect(res.code).toBe('TENANT_NOT_FOUND'));
  });
});
