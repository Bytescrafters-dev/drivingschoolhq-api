import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { PasswordHasher } from '../../src/common/security/password-hasher.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { PlatformRole } from '../../src/generated/prisma/enums.js';
import { createTestPrisma, resetDatabase } from '../support/database.js';
import { createPlatformAdmin } from '../support/platform-fixtures.js';
import {
  createPlanPrice,
  createPricePlan,
} from '../support/tenancy-fixtures.js';

const PASSWORD = 'Fixture-Password-1';

describe('Tenant owner management (e2e)', () => {
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
    const price = await createPlanPrice(prisma, plan.id);
    const res = await http()
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
        subscription: { planPriceId: price.id },
        owner: {
          fullName: 'First Owner',
          email: 'owner@school.lk',
          phone: '0771234567',
          nic: '199012345678',
          temporaryPassword: 'Owner-Temp-Pass-1',
        },
      })
      .expect(201);
    return res.body.id as string;
  }

  it('updates, resets, disables and enables the owner with an audit trail', async () => {
    const token = await tokenFor(PlatformRole.OPERATIONS_ADMIN);
    const tenantId = await onboard(token);
    const base = `/platform/tenants/${tenantId}/owner`;

    const updated = await http()
      .patch(base)
      .set(bearer(token))
      .send({
        fullName: 'Second Owner',
        email: 'Second@School.lk',
        phone: '071 987 6543',
        nic: '901234567v',
      })
      .expect(200);
    expect(updated.body).toMatchObject({
      fullName: 'Second Owner',
      email: 'second@school.lk',
      phone: '+94719876543',
      nic: '901234567V',
      role: 'OWNER',
    });
    expect(JSON.stringify(updated.body)).not.toContain('passwordHash');

    await http()
      .post(`${base}/reset-password`)
      .set(bearer(token))
      .send({ temporaryPassword: 'Reset-Temp-Pass-1' })
      .expect(200)
      .expect(({ body }) => expect(body.mustChangePassword).toBe(true));
    const stored = await prisma.tenantUser.findFirstOrThrow({
      where: { tenantId },
    });
    expect(
      await new PasswordHasher().verify(
        stored.passwordHash,
        'Reset-Temp-Pass-1',
      ),
    ).toBe(true);

    await http()
      .post(`${base}/disable`)
      .set(bearer(token))
      .expect(200)
      .expect(({ body }) => expect(body.status).toBe('DISABLED'));
    await http()
      .post(`${base}/disable`)
      .set(bearer(token))
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe('OWNER_ALREADY_DISABLED'));
    await http()
      .post(`${base}/enable`)
      .set(bearer(token))
      .expect(200)
      .expect(({ body }) => expect(body.status).toBe('ACTIVE'));

    // Tenant access is unaffected by owner status changes.
    await http()
      .get(`/platform/tenants/${tenantId}`)
      .set(bearer(token))
      .expect(200)
      .expect(({ body }) => expect(body.access.status).toBe('ACTIVE'));

    const actions = (
      await prisma.platformAuditLog.findMany({
        where: { targetType: 'TENANT_USER' },
        orderBy: { createdAt: 'asc' },
      })
    ).map((e) => e.action);
    expect(actions).toEqual([
      'TENANT_OWNER_CREATED',
      'TENANT_OWNER_UPDATED',
      'TENANT_OWNER_PASSWORD_RESET',
      'TENANT_OWNER_DISABLED',
      'TENANT_OWNER_ENABLED',
    ]);
  });

  it('blocks owner changes while the tenant is closed but still allows reading', async () => {
    const token = await tokenFor(PlatformRole.SUPER_ADMIN);
    const tenantId = await onboard(token);
    await http()
      .post(`/platform/tenants/${tenantId}/close`)
      .set(bearer(token))
      .send({ reason: 'Closed' })
      .expect(200);

    await http()
      .get(`/platform/tenants/${tenantId}/owner`)
      .set(bearer(token))
      .expect(200);
    await http()
      .post(`/platform/tenants/${tenantId}/owner/disable`)
      .set(bearer(token))
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe('TENANT_CLOSED'));
  });

  it.each([
    [{ phone: '12345' }],
    [{ nic: 'ABC' }],
    [{ email: 'not-an-email' }],
    [{ role: 'ADMIN' }],
  ])('rejects invalid update %j', async (patch) => {
    const token = await tokenFor(PlatformRole.SUPER_ADMIN);
    const tenantId = await onboard(token);
    await http()
      .patch(`/platform/tenants/${tenantId}/owner`)
      .set(bearer(token))
      .send(patch)
      .expect(400)
      .expect(({ body }) => expect(body.code).toBe('VALIDATION_FAILED'));
  });

  it('rejects a short temporary password', async () => {
    const token = await tokenFor(PlatformRole.SUPER_ADMIN);
    const tenantId = await onboard(token);
    await http()
      .post(`/platform/tenants/${tenantId}/owner/reset-password`)
      .set(bearer(token))
      .send({ temporaryPassword: 'short' })
      .expect(400);
  });

  it.each([PlatformRole.BILLING_ADMIN, PlatformRole.SUPPORT])(
    '%s can view but not manage the owner',
    async (role) => {
      const admin = await tokenFor(PlatformRole.SUPER_ADMIN);
      const tenantId = await onboard(admin);
      const token = await tokenFor(role);
      const base = `/platform/tenants/${tenantId}/owner`;

      await http().get(base).set(bearer(token)).expect(200);
      await http()
        .patch(base)
        .set(bearer(token))
        .send({ fullName: 'x' })
        .expect(403);
      await http()
        .post(`${base}/reset-password`)
        .set(bearer(token))
        .send({ temporaryPassword: 'Another-Temp-Pass-1' })
        .expect(403);
      await http().post(`${base}/disable`).set(bearer(token)).expect(403);
    },
  );

  it('returns 404 for an unknown tenant', async () => {
    const token = await tokenFor(PlatformRole.SUPER_ADMIN);
    await http()
      .get(`/platform/tenants/${crypto.randomUUID()}/owner`)
      .set(bearer(token))
      .expect(404)
      .expect(({ body }) => expect(body.code).toBe('TENANT_NOT_FOUND'));
  });
});
