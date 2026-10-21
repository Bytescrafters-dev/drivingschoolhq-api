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

describe('Platform audit log filtered by tenant (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let token: string;
  let planPriceId: string;
  const http = () => request(app.getHttpServer());
  const bearer = () => ({ Authorization: `Bearer ${token}` });

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
      password: PASSWORD,
    });
    token = (
      await http()
        .post('/platform/auth/login')
        .send({ email: admin.email, password: PASSWORD })
        .expect(200)
    ).body.accessToken;
    const plan = await createPricePlan(prisma, admin.id);
    planPriceId = (await createPlanPrice(prisma, plan.id)).id;
  });

  async function onboard(dsCode: string): Promise<string> {
    const res = await http()
      .post('/platform/tenants')
      .set(bearer())
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
          email: 'owner@school.lk',
          phone: '0771234567',
          nic: '199012345678',
          temporaryPassword: 'Owner-Temp-Pass-1',
        },
      })
      .expect(201);
    return res.body.id as string;
  }

  const auditFor = (tenantId: string) =>
    http()
      .get('/platform/audit-logs')
      .query({ tenantId, limit: 100 })
      .set(bearer())
      .expect(200);

  it("returns every entry about the tenant's profile, subscriptions and owner, and nothing else", async () => {
    const a = await onboard('DS101');
    const b = await onboard('DS102');

    await http()
      .patch(`/platform/tenants/${a}`)
      .set(bearer())
      .send({ displayName: 'Renamed' })
      .expect(200);
    await http()
      .patch(`/platform/tenants/${a}/subscription/grace-period`)
      .set(bearer())
      .send({ gracePeriodDays: 14 })
      .expect(200);
    await http()
      .post(`/platform/tenants/${a}/owner/reset-password`)
      .set(bearer())
      .send({ temporaryPassword: 'Second-Temp-Pass-1' })
      .expect(200);
    await http()
      .post(`/platform/tenants/${a}/close`)
      .set(bearer())
      .send({ reason: 'Contract ended' })
      .expect(200);

    const res = await auditFor(a);
    const items = res.body.items as {
      tenantId: string;
      action: string;
      metadata: Record<string, unknown> | null;
    }[];
    expect(items.map((e) => e.action).reverse()).toEqual([
      'TENANT_CREATED',
      'SUBSCRIPTION_CREATED',
      'TENANT_OWNER_CREATED',
      'TENANT_UPDATED',
      'SUBSCRIPTION_GRACE_PERIOD_CHANGED',
      'TENANT_OWNER_PASSWORD_RESET',
      'SUBSCRIPTION_ENDED',
      'TENANT_CLOSED',
    ]);
    expect(items.every((e) => e.tenantId === a)).toBe(true);
    // The tenant is a column now, not duplicated inside metadata.
    expect(items.some((e) => e.metadata && 'tenantId' in e.metadata)).toBe(
      false,
    );
    expect(res.body.nextCursor).toBeNull();

    const other = (await auditFor(b)).body.items as { tenantId: string }[];
    expect(other).toHaveLength(3);
    expect(other.every((e) => e.tenantId === b)).toBe(true);
  });

  it('combines the tenant filter with other filters and pages through results', async () => {
    const a = await onboard('DS101');
    await onboard('DS102');

    const subscriptionsOnly = await http()
      .get('/platform/audit-logs')
      .query({ tenantId: a, targetType: 'TENANT_SUBSCRIPTION' })
      .set(bearer())
      .expect(200);
    expect(
      subscriptionsOnly.body.items.map((e: { action: string }) => e.action),
    ).toEqual(['SUBSCRIPTION_CREATED']);

    const first = await http()
      .get('/platform/audit-logs')
      .query({ tenantId: a, limit: 2 })
      .set(bearer())
      .expect(200);
    expect(first.body.items).toHaveLength(2);
    const second = await http()
      .get('/platform/audit-logs')
      .query({ tenantId: a, limit: 2, cursor: first.body.nextCursor })
      .set(bearer())
      .expect(200);
    expect(second.body.items).toHaveLength(1);
    expect(second.body.nextCursor).toBeNull();
  });

  it('rejects a tenantId that is not a UUID', async () => {
    await http()
      .get('/platform/audit-logs')
      .query({ tenantId: 'DS101' })
      .set(bearer())
      .expect(400);
  });

  it('refuses tenant-related audit rows without a tenant at the database level', async () => {
    const tenantId = await onboard('DS101');
    for (const targetType of ['TENANT', 'TENANT_SUBSCRIPTION', 'TENANT_USER']) {
      await expect(
        prisma.platformAuditLog.create({
          data: { action: 'TEST', targetType, targetId: tenantId },
        }),
      ).rejects.toThrow(/platform_audit_logs_tenant_target_chk/);
    }
    // Entries about non-tenant targets still need no tenant.
    await prisma.platformAuditLog.create({
      data: { action: 'TEST', targetType: 'PRICE_PLAN', targetId: tenantId },
    });
  });
});
