import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { PasswordHasher } from '../../src/common/security/password-hasher.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import {
  PlanLimitCode,
  PlatformRole,
  TenantRole,
  TenantUserBranchAccess,
} from '../../src/generated/prisma/enums.js';
import { createTestPrisma, resetDatabase } from '../support/database.js';
import { createPlatformAdmin } from '../support/platform-fixtures.js';
import {
  createBranch,
  createPlanPrice,
  createPricePlan,
  createTenantUser,
} from '../support/tenancy-fixtures.js';

const ADMIN_PASSWORD = 'Fixture-Password-1';
const TEMP = 'Owner-Temp-Pass-1';
const REAL = 'Owner-Real-Pass-1';
const STAFF_PASSWORD = 'Staff-Real-Pass-1';

describe('Tenant branches (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let adminToken: string;
  let adminId: string;
  let planId: string;
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
    adminId = admin.id;
    adminToken = (
      await http()
        .post('/platform/auth/login')
        .send({ email: admin.email, password: ADMIN_PASSWORD })
        .expect(200)
    ).body.accessToken;
    const plan = await createPricePlan(prisma, admin.id);
    planId = plan.id;
    planPriceId = (await createPlanPrice(prisma, plan.id)).id;
    await setMaxBranches(2);
  });

  async function setMaxBranches(value: number | null) {
    await prisma.planLimit.upsert({
      where: { planId_code: { planId, code: PlanLimitCode.MAX_BRANCHES } },
      create: { planId, code: PlanLimitCode.MAX_BRANCHES, value },
      update: { value },
    });
  }

  async function onboard(dsCode: string) {
    const res = await http()
      .post('/platform/tenants')
      .set(bearer(adminToken))
      .send({
        tenant: {
          dsCode,
          name: `School ${dsCode}`,
          displayName: `School ${dsCode}`,
          address: '12 Galle Road, Colombo 03',
          district: 'COLOMBO',
          phone: '0112345678',
        },
        subscription: { planPriceId },
        owner: {
          fullName: 'Owner',
          email: 'owner@school.lk',
          phone: '0771234567',
          nic: '199012345678',
          temporaryPassword: TEMP,
        },
      })
      .expect(201);
    return res.body.id as string;
  }

  async function login(dsCode: string, email: string, password: string) {
    const res = await http()
      .post('/tenant/auth/login')
      .send({ dsCode, email, password })
      .expect(200);
    return res.body.accessToken as string;
  }

  /** Onboards a school and returns an owner token with a real password. */
  async function ownerOf(dsCode: string) {
    const tenantId = await onboard(dsCode);
    const temp = await login(dsCode, 'owner@school.lk', TEMP);
    await http()
      .post('/tenant/auth/change-password')
      .set(bearer(temp))
      .send({ currentPassword: TEMP, newPassword: REAL })
      .expect(204);
    const token = await login(dsCode, 'owner@school.lk', REAL);
    const me = await http().get('/tenant/auth/me').set(bearer(token));
    return {
      tenantId,
      token,
      mainBranchId: me.body.user.defaultBranchId as string,
    };
  }

  async function staff(
    dsCode: string,
    tenantId: string,
    args: {
      role: TenantRole;
      branchAccess?: TenantUserBranchAccess;
      branchIds: string[];
    },
  ) {
    const email = `${args.role.toLowerCase()}-${crypto.randomUUID().slice(0, 6)}@school.lk`;
    const user = await createTenantUser(prisma, {
      tenantId,
      role: args.role,
      email,
      branchAccess: args.branchAccess ?? TenantUserBranchAccess.SELECTED,
      defaultBranchId: args.branchIds[0],
      createdByPlatformAdminId: adminId,
    });
    await prisma.tenantUser.update({
      where: { id: user.id },
      data: {
        passwordHash: await new PasswordHasher().hash(STAFF_PASSWORD),
        mustChangePassword: false,
      },
    });
    for (const branchId of args.branchIds.slice(1)) {
      await prisma.tenantUserBranch.create({
        data: { tenantId, userId: user.id, branchId },
      });
    }
    return { user, token: await login(dsCode, email, STAFF_PASSWORD) };
  }

  const createBranchReq = (token: string, name: string) =>
    http().post('/tenant/branches').set(bearer(token)).send({
      name,
      address: '5 Peradeniya Road',
      district: 'KANDY',
      phone: '0812223333',
    });

  it('every new school starts with a Main Branch the owner works in', async () => {
    const tenantId = await onboard('DS1');
    const token = await login('DS1', 'owner@school.lk', TEMP);

    const me = await http()
      .get('/tenant/auth/me')
      .set(bearer(token))
      .expect(200);
    expect(me.body.user).toMatchObject({
      branchAccess: 'ALL',
      permissions: ['BRANCHES_MANAGE'],
    });
    expect(me.body.branches).toEqual([
      {
        id: me.body.user.defaultBranchId,
        name: 'Main Branch',
        district: 'COLOMBO',
        isDefault: true,
      },
    ]);

    const platformView = await http()
      .get(`/platform/tenants/${tenantId}/branches`)
      .set(bearer(adminToken))
      .expect(200);
    expect(platformView.body.items).toEqual([
      expect.objectContaining({
        name: 'Main Branch',
        address: '12 Galle Road, Colombo 03',
        phone: '+94112345678',
        status: 'ACTIVE',
      }),
    ]);
  });

  it('owner manages branches within the plan limit', async () => {
    const { token, mainBranchId } = await ownerOf('DS1');

    const kandy = await createBranchReq(token, 'Kandy').expect(201);
    expect(kandy.body).toMatchObject({
      name: 'Kandy',
      district: 'KANDY',
      phone: '+94812223333',
      status: 'ACTIVE',
    });
    await createBranchReq(token, 'Galle')
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe('PLAN_LIMIT_REACHED'));

    await http()
      .patch(`/tenant/branches/${mainBranchId}`)
      .set(bearer(token))
      .send({ name: 'Colombo' })
      .expect(200)
      .expect(({ body }) => expect(body.name).toBe('Colombo'));
    await http()
      .patch(`/tenant/branches/${kandy.body.id}`)
      .set(bearer(token))
      .send({ name: 'COLOMBO' })
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe('BRANCH_NAME_TAKEN'));

    await http()
      .post(`/tenant/branches/${kandy.body.id}/close`)
      .set(bearer(token))
      .expect(200)
      .expect(({ body }) => expect(body.status).toBe('CLOSED'));
    await http()
      .post(`/tenant/branches/${mainBranchId}/close`)
      .set(bearer(token))
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe('LAST_ACTIVE_BRANCH'));

    const list = await http()
      .get('/tenant/branches')
      .set(bearer(token))
      .expect(200);
    expect(list.body.items.map((b: { name: string }) => b.name)).toEqual([
      'Colombo',
    ]);
    const withClosed = await http()
      .get('/tenant/branches?includeClosed=true')
      .set(bearer(token))
      .expect(200);
    expect(withClosed.body.items).toHaveLength(2);

    await http()
      .post(`/tenant/branches/${kandy.body.id}/reopen`)
      .set(bearer(token))
      .expect(200);
    await http()
      .patch('/tenant/me/default-branch')
      .set(bearer(token))
      .send({ branchId: kandy.body.id })
      .expect(200);
    const me = await http().get('/tenant/auth/me').set(bearer(token));
    expect(me.body.user.defaultBranchId).toBe(kandy.body.id);

    const actions = (
      await prisma.tenantAuditLog.findMany({
        where: { targetType: 'BRANCH' },
        orderBy: { createdAt: 'asc' },
      })
    ).map((e) => e.action);
    expect(actions).toEqual([
      'BRANCH_CREATED',
      'BRANCH_UPDATED',
      'BRANCH_CLOSED',
      'BRANCH_REOPENED',
    ]);
  });

  it('verifies the X-Branch-Id working branch on every request', async () => {
    const a = await ownerOf('DS101');
    const b = await ownerOf('DS102');
    const kandy = (await createBranchReq(a.token, 'Kandy').expect(201)).body;
    const context = (token: string, branchId?: string) => {
      const req = http().get('/tenant/branch-context').set(bearer(token));
      return branchId ? req.set('X-Branch-Id', branchId) : req;
    };

    await context(a.token, kandy.id)
      .expect(200)
      .expect(({ body }) =>
        expect(body.branch).toEqual({ id: kandy.id, name: 'Kandy' }),
      );
    await context(a.token)
      .expect(400)
      .expect(({ body }) => expect(body.code).toBe('BRANCH_REQUIRED'));
    // Another school's branch, an unknown id and a malformed id look the same.
    for (const id of [b.mainBranchId, crypto.randomUUID(), 'DS102']) {
      await context(a.token, id)
        .expect(403)
        .expect(({ body }) => expect(body.code).toBe('BRANCH_ACCESS_DENIED'));
    }
    await http()
      .post(`/tenant/branches/${kandy.id}/close`)
      .set(bearer(a.token))
      .expect(200);
    await context(a.token, kandy.id).expect(403);
    // And the platform token never works here.
    await context(adminToken, a.mainBranchId).expect(401);
  });

  it('staff see only their branches; only owners and admins manage branches', async () => {
    await setMaxBranches(null);
    const { tenantId, token, mainBranchId } = await ownerOf('DS1');
    const kandy = (await createBranchReq(token, 'Kandy').expect(201)).body;

    const clerk = await staff('DS1', tenantId, {
      role: TenantRole.FRONT_DESK,
      branchIds: [kandy.id],
    });
    const clerkMe = await http()
      .get('/tenant/auth/me')
      .set(bearer(clerk.token))
      .expect(200);
    expect(clerkMe.body.user.permissions).toEqual([]);
    const mine = await http()
      .get('/tenant/branches')
      .set(bearer(clerk.token))
      .expect(200);
    expect(mine.body.items.map((b: { id: string }) => b.id)).toEqual([
      kandy.id,
    ]);
    await http()
      .get(`/tenant/branches/${mainBranchId}`)
      .set(bearer(clerk.token))
      .expect(404);
    await http()
      .get('/tenant/branch-context')
      .set(bearer(clerk.token))
      .set('X-Branch-Id', mainBranchId)
      .expect(403);
    await createBranchReq(clerk.token, 'Galle')
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe('TENANT_PERMISSION_DENIED'));

    // Kandy is the clerk's only branch, so it cannot be closed yet.
    await http()
      .post(`/tenant/branches/${kandy.id}/close`)
      .set(bearer(token))
      .expect(409)
      .expect(({ body }) =>
        expect(body.code).toBe('BRANCH_HAS_EXCLUSIVE_STAFF'),
      );

    // A SELECTED admin creates a branch, is assigned to it, but cannot
    // close a branch outside their access.
    const admin = await staff('DS1', tenantId, {
      role: TenantRole.ADMIN,
      branchIds: [kandy.id],
    });
    const galle = (await createBranchReq(admin.token, 'Galle').expect(201))
      .body;
    const adminBranches = await http()
      .get('/tenant/branches')
      .set(bearer(admin.token))
      .expect(200);
    expect(
      adminBranches.body.items.map((b: { id: string }) => b.id).sort(),
    ).toEqual([kandy.id, galle.id].sort());
    await http()
      .post(`/tenant/branches/${mainBranchId}/close`)
      .set(bearer(admin.token))
      .expect(404);
    await http()
      .post(`/tenant/branches/${galle.id}/close`)
      .set(bearer(admin.token))
      .expect(200);
  });

  it('a platform downgrade never closes branches but blocks new ones', async () => {
    await setMaxBranches(null);
    const { tenantId, token } = await ownerOf('DS1');
    await createBranch(prisma, { tenantId, name: 'Kandy' });
    await createBranch(prisma, { tenantId, name: 'Galle' });
    await setMaxBranches(1);

    await createBranchReq(token, 'Jaffna').expect(409);
    const list = await http()
      .get('/tenant/branches')
      .set(bearer(token))
      .expect(200);
    expect(list.body.items).toHaveLength(3);
  });

  it('plans can no longer offer MULTI_BRANCH or zero branches', async () => {
    await http()
      .put(`/platform/plans/${planId}/features`)
      .set(bearer(adminToken))
      .send({ features: ['MULTI_BRANCH'] })
      .expect(400);
    await http()
      .put(`/platform/plans/${planId}/limits`)
      .set(bearer(adminToken))
      .send({
        limits: [
          { code: 'MAX_STAFF_USERS', value: 5 },
          { code: 'MAX_BRANCHES', value: 0 },
          { code: 'MAX_INSTRUCTORS', value: 5 },
          { code: 'MAX_VEHICLES', value: 5 },
        ],
      })
      .expect(400)
      .expect(({ body }) => expect(body.code).toBe('PLAN_LIMITS_INVALID'));
  });
});
