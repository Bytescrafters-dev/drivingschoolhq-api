import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { PlatformRole } from '../../src/generated/prisma/enums.js';
import { createTestPrisma, resetDatabase } from '../support/database.js';
import { createPlatformAdmin } from '../support/platform-fixtures.js';

const PASSWORD = 'Fixture-Password-1';

const FULL_LIMITS = [
  { code: 'MAX_STAFF_USERS', value: 5 },
  { code: 'MAX_BRANCHES', value: 1 },
  { code: 'MAX_INSTRUCTORS', value: 3 },
  { code: 'MAX_VEHICLES', value: null },
];

describe('Platform plans (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  const http = () => request(app.getHttpServer());

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

  async function tokenFor(role: PlatformRole): Promise<string> {
    const admin = await createPlatformAdmin(prisma, {
      role,
      password: PASSWORD,
    });
    const res = await http()
      .post('/platform/auth/login')
      .send({ email: admin.email, password: PASSWORD })
      .expect(200);
    return res.body.accessToken as string;
  }

  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  it('billing admin builds, activates, reprices, archives and restores a plan with a full audit trail', async () => {
    const token = await tokenFor(PlatformRole.BILLING_ADMIN);

    const created = await http()
      .post('/platform/plans')
      .set(bearer(token))
      .send({
        code: 'starter',
        name: 'Starter',
        prices: [{ billingPeriod: 'MONTHLY', amount: '5000' }],
      })
      .expect(201);
    const planId = created.body.id as string;
    expect(created.body).toMatchObject({
      code: 'STARTER',
      status: 'DRAFT',
      prices: [
        { billingPeriod: 'MONTHLY', amount: '5000.00', status: 'ACTIVE' },
      ],
      limits: [],
      features: [],
    });

    await http()
      .post(`/platform/plans/${planId}/activate`)
      .set(bearer(token))
      .expect(409)
      .expect(({ body }) => {
        expect(body.code).toBe('PLAN_NOT_ACTIVATABLE');
        expect(body.message).toContain('missing limits');
      });

    await http()
      .put(`/platform/plans/${planId}/limits`)
      .set(bearer(token))
      .send({ limits: FULL_LIMITS })
      .expect(200);
    await http()
      .put(`/platform/plans/${planId}/features`)
      .set(bearer(token))
      .send({ features: ['SMS_NOTIFICATIONS'] })
      .expect(200);
    await http()
      .put(`/platform/plans/${planId}/prices/ANNUAL`)
      .set(bearer(token))
      .send({ amount: '50000.00' })
      .expect(200);

    const active = await http()
      .post(`/platform/plans/${planId}/activate`)
      .set(bearer(token))
      .expect(200);
    expect(active.body.status).toBe('ACTIVE');
    expect(
      active.body.prices.map((p: { billingPeriod: string }) => p.billingPeriod),
    ).toEqual(['MONTHLY', 'ANNUAL']);

    const repriced = await http()
      .put(`/platform/plans/${planId}/prices/MONTHLY`)
      .set(bearer(token))
      .send({ amount: '5500.50' })
      .expect(200);
    expect(
      repriced.body.prices.find(
        (p: { billingPeriod: string }) => p.billingPeriod === 'MONTHLY',
      ).amount,
    ).toBe('5500.50');

    const history = await http()
      .get(`/platform/plans/${planId}/prices?includeArchived=true`)
      .set(bearer(token))
      .expect(200);
    expect(
      history.body.items
        .filter((p: { billingPeriod: string }) => p.billingPeriod === 'MONTHLY')
        .map((p: { amount: string; status: string }) => [p.amount, p.status]),
    ).toEqual(
      expect.arrayContaining([
        ['5000.00', 'ARCHIVED'],
        ['5500.50', 'ACTIVE'],
      ]),
    );

    await http()
      .post(`/platform/plans/${planId}/archive`)
      .set(bearer(token))
      .expect(200)
      .expect(({ body }) => expect(body.status).toBe('ARCHIVED'));
    await http()
      .delete(`/platform/plans/${planId}`)
      .set(bearer(token))
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe('INVALID_PLAN_STATE'));
    await http()
      .post(`/platform/plans/${planId}/activate`)
      .set(bearer(token))
      .expect(200)
      .expect(({ body }) =>
        expect(body).toMatchObject({ status: 'ACTIVE', archivedAt: null }),
      );

    const actions = (
      await prisma.platformAuditLog.findMany({
        where: { targetType: 'PRICE_PLAN', targetId: planId },
        orderBy: { createdAt: 'asc' },
      })
    ).map((entry) => entry.action);
    expect(actions).toEqual([
      'PLAN_CREATED',
      'PLAN_LIMITS_UPDATED',
      'PLAN_FEATURES_UPDATED',
      'PLAN_PRICE_SET',
      'PLAN_ACTIVATED',
      'PLAN_PRICE_SET',
      'PLAN_ARCHIVED',
      'PLAN_ACTIVATED',
    ]);
  });

  it('deletes a draft plan together with its prices', async () => {
    const token = await tokenFor(PlatformRole.SUPER_ADMIN);
    const created = await http()
      .post('/platform/plans')
      .set(bearer(token))
      .send({
        code: 'TEMP',
        name: 'Temp',
        prices: [{ billingPeriod: 'MONTHLY', amount: '1' }],
        limits: FULL_LIMITS,
        features: ['API_ACCESS'],
      })
      .expect(201);

    await http()
      .delete(`/platform/plans/${created.body.id}`)
      .set(bearer(token))
      .expect(204);

    await http()
      .get(`/platform/plans/${created.body.id}`)
      .set(bearer(token))
      .expect(404)
      .expect(({ body }) => expect(body.code).toBe('PLAN_NOT_FOUND'));
    expect(await prisma.planPrice.count()).toBe(0);
  });

  it('keeps an active plan from losing its last price', async () => {
    const token = await tokenFor(PlatformRole.SUPER_ADMIN);
    const created = await http()
      .post('/platform/plans')
      .set(bearer(token))
      .send({
        code: 'SOLO',
        name: 'Solo',
        prices: [{ billingPeriod: 'MONTHLY', amount: '1000' }],
        limits: FULL_LIMITS,
      })
      .expect(201);
    await http()
      .post(`/platform/plans/${created.body.id}/activate`)
      .set(bearer(token))
      .expect(200);

    await http()
      .post(
        `/platform/plans/${created.body.id}/prices/${created.body.prices[0].id}/archive`,
      )
      .set(bearer(token))
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe('PLAN_LAST_ACTIVE_PRICE'));
  });

  it('rejects a duplicate plan code', async () => {
    const token = await tokenFor(PlatformRole.SUPER_ADMIN);
    await http()
      .post('/platform/plans')
      .set(bearer(token))
      .send({ code: 'PRO', name: 'Pro' })
      .expect(201);
    await http()
      .post('/platform/plans')
      .set(bearer(token))
      .send({ code: 'pro', name: 'Pro again' })
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe('PLAN_CODE_TAKEN'));
  });

  it('filters the plan list', async () => {
    const token = await tokenFor(PlatformRole.SUPER_ADMIN);
    await http()
      .post('/platform/plans')
      .set(bearer(token))
      .send({ code: 'PUBLIC_A', name: 'Public A' })
      .expect(201);
    await http()
      .post('/platform/plans')
      .set(bearer(token))
      .send({ code: 'PRIVATE_B', name: 'Private B', isPublic: false })
      .expect(201);

    const res = await http()
      .get('/platform/plans?isPublic=false')
      .set(bearer(token))
      .expect(200);
    expect(res.body).toMatchObject({ total: 1, page: 1, pageSize: 20 });
    expect(res.body.items[0].code).toBe('PRIVATE_B');
  });

  it.each([
    [{ code: 'X', name: 'X' }, 'code'],
    [{ code: 'BAD CODE', name: 'X' }, 'code'],
    [
      {
        code: 'OK',
        name: 'X',
        prices: [{ billingPeriod: 'MONTHLY', amount: 5000 }],
      },
      'amount',
    ],
    [
      {
        code: 'OK',
        name: 'X',
        prices: [{ billingPeriod: 'MONTHLY', amount: '1.999' }],
      },
      'amount',
    ],
    [
      {
        code: 'OK',
        name: 'X',
        prices: [{ billingPeriod: 'WEEKLY', amount: '1' }],
      },
      'billingPeriod',
    ],
    [{ code: 'OK', name: 'X', currency: 'USD' }, 'currency'],
  ])('rejects invalid create body %j', async (body, field) => {
    const token = await tokenFor(PlatformRole.SUPER_ADMIN);
    await http()
      .post('/platform/plans')
      .set(bearer(token))
      .send(body)
      .expect(400)
      .expect(({ body: res }) => {
        expect(res.code).toBe('VALIDATION_FAILED');
        expect(res.message).toContain(field);
      });
  });

  it('rejects an unknown billing period in the URL', async () => {
    const token = await tokenFor(PlatformRole.SUPER_ADMIN);
    await http()
      .put(`/platform/plans/${crypto.randomUUID()}/prices/WEEKLY`)
      .set(bearer(token))
      .send({ amount: '1' })
      .expect(400);
  });

  it.each([PlatformRole.OPERATIONS_ADMIN, PlatformRole.SUPPORT])(
    '%s can read plans but not manage them',
    async (role) => {
      const token = await tokenFor(role);
      await http().get('/platform/plans').set(bearer(token)).expect(200);
      await http()
        .post('/platform/plans')
        .set(bearer(token))
        .send({ code: 'NOPE', name: 'Nope' })
        .expect(403)
        .expect(({ body }) =>
          expect(body.code).toBe('PLATFORM_PERMISSION_DENIED'),
        );
      expect(await prisma.pricePlan.count()).toBe(0);
    },
  );

  it('requires authentication', async () => {
    await http().get('/platform/plans').expect(401);
  });
});
