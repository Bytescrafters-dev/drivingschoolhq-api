import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { PlatformRole } from '../../src/generated/prisma/enums.js';
import { createTestPrisma, resetDatabase } from '../support/database.js';
import { createPlatformAdmin } from '../support/platform-fixtures.js';
import {
  createPlanPrice,
  createPricePlan,
} from '../support/tenancy-fixtures.js';

const PASSWORD = 'Fixture-Password-1';

describe('Tenant subscriptions (e2e)', () => {
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
    return res.body.accessToken as string;
  }

  async function onboard(token: string) {
    const creator = await createPlatformAdmin(prisma);
    const plan = await createPricePlan(prisma, creator.id);
    const monthly = await createPlanPrice(prisma, plan.id);
    const premium = await createPricePlan(prisma, creator.id);
    const premiumPrice = await createPlanPrice(prisma, premium.id, {
      amount: '9000.00',
    });
    const created = await http()
      .post('/platform/tenants')
      .set(bearer(token))
      .send({
        tenant: {
          dsCode: 'DS-1',
          name: 'School',
          displayName: 'School',
          address: 'Colombo',
          district: 'COLOMBO',
          phone: '0771234567',
        },
        subscription: { planPriceId: monthly.id, gracePeriodDays: 5 },
        owner: {
          fullName: 'Owner',
          email: 'owner@school.lk',
          phone: '0771234567',
          nic: '199012345678',
          temporaryPassword: 'Owner-Temp-Pass-1',
        },
      })
      .expect(201);
    return { tenant: created.body, premiumPrice };
  }

  it('schedules, replaces and cancels a plan change and updates the grace period', async () => {
    const token = await tokenFor(PlatformRole.OPERATIONS_ADMIN);
    const { tenant, premiumPrice } = await onboard(token);
    const base = `/platform/tenants/${tenant.id}`;
    expect(tenant.subscription).toMatchObject({
      inTrial: false,
      currentPeriodStart: tenant.subscription.startDate,
    });
    const renewal = tenant.subscription.nextRenewalDate as string;

    const scheduled = await http()
      .post(`${base}/subscription/scheduled-change`)
      .set(bearer(token))
      .send({ planPriceId: premiumPrice.id })
      .expect(200);
    expect(scheduled.body.scheduledSubscription).toMatchObject({
      status: 'SCHEDULED',
      planPriceId: premiumPrice.id,
      listAmount: '9000.00',
      startDate: renewal,
      gracePeriodDays: 5,
    });

    const replaced = await http()
      .post(`${base}/subscription/scheduled-change`)
      .set(bearer(token))
      .send({
        planPriceId: premiumPrice.id,
        agreedAmount: '8000',
        discountReason: 'Negotiated',
      })
      .expect(200);
    expect(replaced.body.scheduledSubscription.agreedAmount).toBe('8000.00');

    await http()
      .post(`${base}/subscription/scheduled-change/cancel`)
      .set(bearer(token))
      .send({ reason: 'Stay on current plan' })
      .expect(200)
      .expect(({ body }) => expect(body.scheduledSubscription).toBeNull());

    await http()
      .patch(`${base}/subscription/grace-period`)
      .set(bearer(token))
      .send({ gracePeriodDays: 14 })
      .expect(200)
      .expect(({ body }) => expect(body.subscription.gracePeriodDays).toBe(14));

    const history = await http()
      .get(`${base}/subscriptions`)
      .set(bearer(token))
      .expect(200);
    expect(history.body.items.map((s: { status: string }) => s.status)).toEqual(
      ['CANCELLED', 'CANCELLED', 'ACTIVE'],
    );
  });

  it('rejects changes for a closed tenant', async () => {
    const token = await tokenFor(PlatformRole.SUPER_ADMIN);
    const { tenant, premiumPrice } = await onboard(token);
    await http()
      .post(`/platform/tenants/${tenant.id}/close`)
      .set(bearer(token))
      .send({ reason: 'Closed' })
      .expect(200);

    await http()
      .post(`/platform/tenants/${tenant.id}/subscription/scheduled-change`)
      .set(bearer(token))
      .send({ planPriceId: premiumPrice.id })
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe('TENANT_CLOSED'));
  });

  it('rejects invalid input', async () => {
    const token = await tokenFor(PlatformRole.SUPER_ADMIN);
    const { tenant, premiumPrice } = await onboard(token);
    const base = `/platform/tenants/${tenant.id}`;

    await http()
      .patch(`${base}/subscription/grace-period`)
      .set(bearer(token))
      .send({ gracePeriodDays: 91 })
      .expect(400);
    await http()
      .post(`${base}/subscription/scheduled-change`)
      .set(bearer(token))
      .send({ planPriceId: premiumPrice.id, trialEndDate: '2030-01-01' })
      .expect(400);
    await http()
      .post(`${base}/subscription/scheduled-change/cancel`)
      .set(bearer(token))
      .send({ reason: 'nothing scheduled' })
      .expect(404)
      .expect(({ body }) => expect(body.code).toBe('NO_SCHEDULED_CHANGE'));
  });

  it.each([PlatformRole.BILLING_ADMIN, PlatformRole.SUPPORT])(
    '%s can read but not change subscriptions',
    async (role) => {
      const admin = await tokenFor(PlatformRole.SUPER_ADMIN);
      const { tenant, premiumPrice } = await onboard(admin);
      const token = await tokenFor(role);
      const base = `/platform/tenants/${tenant.id}`;

      await http().get(`${base}/subscriptions`).set(bearer(token)).expect(200);
      await http().get(`${base}/subscription`).set(bearer(token)).expect(200);
      await http()
        .post(`${base}/subscription/scheduled-change`)
        .set(bearer(token))
        .send({ planPriceId: premiumPrice.id })
        .expect(403);
      await http()
        .patch(`${base}/subscription/grace-period`)
        .set(bearer(token))
        .send({ gracePeriodDays: 3 })
        .expect(403);
    },
  );
});
