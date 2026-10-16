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

const ADMIN_PASSWORD = 'Fixture-Password-1';
const TEMP = 'Owner-Temp-Pass-1';

describe('Tenant user authentication (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let adminToken: string;
  let planPriceId: string;
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

  beforeEach(async () => {
    await resetDatabase(prisma);
    const admin = await createPlatformAdmin(prisma, {
      role: PlatformRole.SUPER_ADMIN,
      password: ADMIN_PASSWORD,
    });
    adminToken = (
      await http()
        .post('/platform/auth/login')
        .send({ email: admin.email, password: ADMIN_PASSWORD })
        .expect(200)
    ).body.accessToken;
    const plan = await createPricePlan(prisma, admin.id);
    planPriceId = (await createPlanPrice(prisma, plan.id)).id;
  });

  async function onboard(dsCode: string, email = 'owner@school.lk') {
    const res = await http()
      .post('/platform/tenants')
      .set(bearer(adminToken))
      .send({
        tenant: {
          dsCode,
          name: `School ${dsCode}`,
          displayName: `School ${dsCode}`,
          address: 'Colombo',
          district: 'COLOMBO',
          phone: '0771234567',
        },
        subscription: { planPriceId },
        owner: {
          fullName: 'Owner',
          email,
          phone: '0771234567',
          nic: '199012345678',
          temporaryPassword: TEMP,
        },
      })
      .expect(201);
    return res.body.id as string;
  }

  const login = (dsCode: string, email: string, password: string) =>
    http().post('/tenant/auth/login').send({ dsCode, email, password });

  it('owner signs in with a temporary password, must change it, then uses the session', async () => {
    const tenantId = await onboard('DS-1');

    const first = await login('ds-1', 'Owner@School.lk', TEMP).expect(200);
    expect(first.body).toMatchObject({
      tokenType: 'Bearer',
      mustChangePassword: true,
    });
    const temp = first.body.accessToken as string;

    const me = await http()
      .get('/tenant/auth/me')
      .set(bearer(temp))
      .expect(200);
    expect(me.body).toMatchObject({
      user: {
        email: 'owner@school.lk',
        role: 'OWNER',
        mustChangePassword: true,
      },
      tenant: { id: tenantId, dsCode: 'DS-1', accessStatus: 'ACTIVE' },
    });

    await http()
      .post('/tenant/auth/change-password')
      .set(bearer(temp))
      .send({ currentPassword: TEMP, newPassword: 'Owner-Real-Pass-1' })
      .expect(204);
    await login('DS-1', 'owner@school.lk', TEMP).expect(401);
    const real = await login(
      'DS-1',
      'owner@school.lk',
      'Owner-Real-Pass-1',
    ).expect(200);
    expect(real.body.mustChangePassword).toBe(false);

    const refreshed = await http()
      .post('/tenant/auth/refresh')
      .send({ refreshToken: real.body.refreshToken })
      .expect(200);
    await http()
      .post('/tenant/auth/logout')
      .set(bearer(refreshed.body.accessToken))
      .expect(204);
    await http()
      .get('/tenant/auth/me')
      .set(bearer(refreshed.body.accessToken))
      .expect(401);

    const actions = (
      await prisma.tenantAuditLog.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'asc' },
      })
    ).map((e) => e.action);
    expect(actions).toEqual([
      'LOGIN_SUCCEEDED',
      'PASSWORD_CHANGED',
      'LOGIN_FAILED',
      'LOGIN_SUCCEEDED',
      'LOGOUT',
    ]);
  });

  it('uses the DS code to pick the right school when the same email exists in two', async () => {
    const a = await onboard('DS-A');
    const b = await onboard('DS-B');

    const res = await login('DS-B', 'owner@school.lk', TEMP).expect(200);
    const me = await http()
      .get('/tenant/auth/me')
      .set(bearer(res.body.accessToken))
      .expect(200);
    expect(me.body.tenant.id).toBe(b);
    expect(me.body.tenant.id).not.toBe(a);
  });

  it('returns the same error for an unknown school, unknown email and wrong password', async () => {
    await onboard('DS-1');
    const attempts: [string, string, string][] = [
      ['DS-404', 'owner@school.lk', TEMP],
      ['DS-1', 'nobody@school.lk', TEMP],
      ['DS-1', 'owner@school.lk', 'Wrong-Password-1'],
    ];
    for (const [ds, email, pw] of attempts) {
      await login(ds, email, pw)
        .expect(401)
        .expect(({ body }) => expect(body.code).toBe('INVALID_CREDENTIALS'));
    }
  });

  it('keeps platform and tenant tokens apart', async () => {
    await onboard('DS-1');
    const tenantToken = (
      await login('DS-1', 'owner@school.lk', TEMP).expect(200)
    ).body.accessToken;

    await http().get('/tenant/auth/me').set(bearer(adminToken)).expect(401);
    await http().get('/platform/auth/me').set(bearer(tenantToken)).expect(401);
    await http().get('/platform/tenants').set(bearer(tenantToken)).expect(401);
  });

  it('platform actions end tenant sessions immediately', async () => {
    const tenantId = await onboard('DS-1');
    const token = async (password = TEMP) =>
      (await login('DS-1', 'owner@school.lk', password).expect(200)).body
        .accessToken as string;
    const me = (t: string) => http().get('/tenant/auth/me').set(bearer(t));

    let t = await token();
    await http()
      .post(`/platform/tenants/${tenantId}/owner/disable`)
      .set(bearer(adminToken))
      .expect(200);
    await me(t).expect(401);
    await login('DS-1', 'owner@school.lk', TEMP).expect(401);
    await http()
      .post(`/platform/tenants/${tenantId}/owner/enable`)
      .set(bearer(adminToken))
      .expect(200);

    t = await token();
    await http()
      .post(`/platform/tenants/${tenantId}/owner/reset-password`)
      .set(bearer(adminToken))
      .send({ temporaryPassword: 'Second-Temp-Pass-1' })
      .expect(200);
    await me(t).expect(401);
    await login('DS-1', 'owner@school.lk', TEMP).expect(401);

    t = await token('Second-Temp-Pass-1');
    await http()
      .post(`/platform/tenants/${tenantId}/close`)
      .set(bearer(adminToken))
      .send({ reason: 'Closed' })
      .expect(200);
    await me(t).expect(401);
    await login('DS-1', 'owner@school.lk', 'Second-Temp-Pass-1')
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe('TENANT_CLOSED'));
  });

  it('lets a suspended school sign in and see its access status', async () => {
    const tenantId = await onboard('DS-1');
    await prisma.tenantAccess.update({
      where: { tenantId },
      data: { status: 'SUSPENDED' },
    });
    const res = await login('DS-1', 'owner@school.lk', TEMP).expect(200);
    await http()
      .get('/tenant/auth/me')
      .set(bearer(res.body.accessToken))
      .expect(200)
      .expect(({ body }) => expect(body.tenant.accessStatus).toBe('SUSPENDED'));
  });

  it('validates the login body', async () => {
    await http()
      .post('/tenant/auth/login')
      .send({ email: 'owner@school.lk', password: TEMP })
      .expect(400);
    await http()
      .post('/tenant/auth/login')
      .send({ dsCode: 'DS-1', email: 'not-an-email', password: TEMP })
      .expect(400);
  });
});
