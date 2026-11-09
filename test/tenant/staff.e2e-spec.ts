import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import {
  PlanLimitCode,
  PlatformRole,
} from '../../src/generated/prisma/enums.js';
import { createTestPrisma, resetDatabase } from '../support/database.js';
import { createPlatformAdmin } from '../support/platform-fixtures.js';
import {
  createPlanPrice,
  createPricePlan,
} from '../support/tenancy-fixtures.js';

const ADMIN_PASSWORD = 'Fixture-Password-1';
const TEMP = 'Owner-Temp-Pass-1';
const REAL = 'Owner-Real-Pass-1';
const STAFF_TEMP = 'Staff-Temp-Pass-1';
const STAFF_REAL = 'Staff-Real-Pass-1';

describe('Tenant staff management (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let adminToken: string;
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
    adminToken = (
      await http()
        .post('/platform/auth/login')
        .send({ email: admin.email, password: ADMIN_PASSWORD })
        .expect(200)
    ).body.accessToken;
    const plan = await createPricePlan(prisma, admin.id);
    planId = plan.id;
    planPriceId = (await createPlanPrice(prisma, plan.id)).id;
    await setLimit(PlanLimitCode.MAX_BRANCHES, null);
    await setLimit(PlanLimitCode.MAX_STAFF_USERS, 10);
  });

  async function setLimit(code: PlanLimitCode, value: number | null) {
    await prisma.planLimit.upsert({
      where: { planId_code: { planId, code } },
      create: { planId, code, value },
      update: { value },
    });
  }

  function login(email: string, password: string) {
    return http()
      .post('/tenant/auth/login')
      .send({ dsCode: 'DS1', email, password });
  }

  /** Signs in with a temporary password and replaces it. */
  async function firstLogin(email: string, temp: string, real: string) {
    const first = await login(email, temp).expect(200);
    expect(first.body.mustChangePassword).toBe(true);
    await http()
      .post('/tenant/auth/change-password')
      .set(bearer(first.body.accessToken))
      .send({ currentPassword: temp, newPassword: real })
      .expect(204);
    return (await login(email, real).expect(200)).body.accessToken as string;
  }

  async function onboard() {
    const res = await http()
      .post('/platform/tenants')
      .set(bearer(adminToken))
      .send({
        tenant: {
          dsCode: 'DS1',
          name: 'School DS1',
          displayName: 'School DS1',
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
    const tenantId = res.body.id as string;
    const token = await firstLogin('owner@school.lk', TEMP, REAL);
    const me = await http().get('/tenant/auth/me').set(bearer(token));
    return {
      tenantId,
      token,
      mainBranchId: me.body.user.defaultBranchId as string,
    };
  }

  const createBranch = async (token: string, name: string) =>
    (
      await http()
        .post('/tenant/branches')
        .set(bearer(token))
        .send({
          name,
          address: 'Somewhere',
          district: 'KANDY',
          phone: '0812223333',
        })
        .expect(201)
    ).body.id as string;

  const createStaff = (token: string, body: Record<string, unknown>) =>
    http()
      .post('/tenant/staff')
      .set(bearer(token))
      .send({
        fullName: 'Staff Member',
        temporaryPassword: STAFF_TEMP,
        ...body,
      });

  it('delegates down the hierarchy: owner → admin → branch manager → front desk', async () => {
    const { token: ownerToken, mainBranchId } = await onboard();
    const kandy = await createBranch(ownerToken, 'Kandy');
    const galle = await createBranch(ownerToken, 'Galle');

    const ownerOptions = await http()
      .get('/tenant/staff/options')
      .set(bearer(ownerToken))
      .expect(200);
    expect(ownerOptions.body).toMatchObject({
      roles: [
        'ADMIN',
        'BRANCH_MANAGER',
        'FRONT_DESK',
        'INSTRUCTOR',
        'ACCOUNTANT',
      ],
      canGrantAll: true,
    });
    expect(ownerOptions.body.branches).toHaveLength(3);

    // Owner creates an ALL-access admin.
    const admin = await createStaff(ownerToken, {
      email: 'admin@school.lk',
      role: 'ADMIN',
      branchAccess: 'ALL',
      defaultBranchId: mainBranchId,
    }).expect(201);
    expect(admin.body).toMatchObject({
      role: 'ADMIN',
      branchAccess: 'ALL',
      branches: [],
      mustChangePassword: true,
      hasActiveBranch: true,
      canManage: true,
    });
    const adminToken = await firstLogin(
      'admin@school.lk',
      STAFF_TEMP,
      STAFF_REAL,
    );

    // Admin creates a branch manager for Kandy + Galle; not another admin.
    await createStaff(adminToken, {
      email: 'peer@school.lk',
      role: 'ADMIN',
      branchAccess: 'ALL',
      defaultBranchId: mainBranchId,
    })
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe('ROLE_NOT_ASSIGNABLE'));
    await createStaff(adminToken, {
      email: 'manager@school.lk',
      role: 'BRANCH_MANAGER',
      branchAccess: 'SELECTED',
      branchIds: [kandy, galle],
      defaultBranchId: kandy,
    }).expect(201);
    const managerToken = await firstLogin(
      'manager@school.lk',
      STAFF_TEMP,
      STAFF_REAL,
    );

    // The manager can only grant their own branches, never ALL.
    const managerOptions = await http()
      .get('/tenant/staff/options')
      .set(bearer(managerToken))
      .expect(200);
    expect(managerOptions.body.roles).toEqual([
      'FRONT_DESK',
      'INSTRUCTOR',
      'ACCOUNTANT',
    ]);
    expect(managerOptions.body.canGrantAll).toBe(false);
    expect(
      managerOptions.body.branches.map((b: { id: string }) => b.id).sort(),
    ).toEqual([kandy, galle].sort());
    await createStaff(managerToken, {
      email: 'all@school.lk',
      role: 'FRONT_DESK',
      branchAccess: 'ALL',
      defaultBranchId: kandy,
    })
      .expect(403)
      .expect(({ body }) =>
        expect(body.code).toBe('BRANCH_ACCESS_NOT_GRANTABLE'),
      );
    await createStaff(managerToken, {
      email: 'main@school.lk',
      role: 'FRONT_DESK',
      branchAccess: 'SELECTED',
      branchIds: [mainBranchId],
      defaultBranchId: mainBranchId,
    })
      .expect(403)
      .expect(({ body }) =>
        expect(body.code).toBe('BRANCH_ACCESS_NOT_GRANTABLE'),
      );
    await createStaff(managerToken, {
      email: 'bad-default@school.lk',
      role: 'FRONT_DESK',
      branchAccess: 'SELECTED',
      branchIds: [kandy],
      defaultBranchId: galle,
    })
      .expect(400)
      .expect(({ body }) => expect(body.code).toBe('BRANCH_SELECTION_INVALID'));
    const clerk = await createStaff(managerToken, {
      email: 'clerk@school.lk',
      phone: '0771112222',
      role: 'FRONT_DESK',
      branchAccess: 'SELECTED',
      branchIds: [kandy],
      defaultBranchId: kandy,
    }).expect(201);
    expect(clerk.body).toMatchObject({
      phone: '+94771112222',
      nic: null,
      branches: [{ id: kandy, name: 'Kandy', status: 'ACTIVE' }],
    });

    // The manager sees ALL-access users and Kandy/Galle staff, and may
    // manage only the clerk.
    const seen = await http()
      .get('/tenant/staff')
      .set(bearer(managerToken))
      .expect(200);
    const byEmail = Object.fromEntries(
      seen.body.items.map((u: { email: string; canManage: boolean }) => [
        u.email,
        u.canManage,
      ]),
    );
    expect(byEmail).toEqual({
      'admin@school.lk': false,
      'clerk@school.lk': true,
      'manager@school.lk': false,
      'owner@school.lk': false,
    });
    expect(seen.body).toMatchObject({ total: 4, page: 1, pageSize: 20 });

    // Nobody manages themselves or a peer/higher role.
    const me = await http().get('/tenant/auth/me').set(bearer(managerToken));
    await http()
      .post(`/tenant/staff/${me.body.user.id}/disable`)
      .set(bearer(managerToken))
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe('CANNOT_MANAGE_SELF'));
    await http()
      .patch(`/tenant/staff/${admin.body.id}/role`)
      .set(bearer(managerToken))
      .send({ role: 'FRONT_DESK' })
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe('STAFF_MANAGEMENT_DENIED'));
  });

  it('applies role/access changes immediately and signs out on disable, reset and email change', async () => {
    const { token, mainBranchId } = await onboard();
    const kandy = await createBranch(token, 'Kandy');
    const clerk = (
      await createStaff(token, {
        email: 'clerk@school.lk',
        role: 'FRONT_DESK',
        branchAccess: 'SELECTED',
        branchIds: [kandy],
        defaultBranchId: kandy,
      }).expect(201)
    ).body;
    const clerkToken = await firstLogin(
      'clerk@school.lk',
      STAFF_TEMP,
      STAFF_REAL,
    );
    const branchContext = (branchId: string) =>
      http()
        .get('/tenant/branch-context')
        .set(bearer(clerkToken))
        .set('X-Branch-Id', branchId);

    // Promotion takes effect on the next request; the session survives.
    await http()
      .patch(`/tenant/staff/${clerk.id}/role`)
      .set(bearer(token))
      .send({ role: 'BRANCH_MANAGER' })
      .expect(200);
    const me = await http()
      .get('/tenant/auth/me')
      .set(bearer(clerkToken))
      .expect(200);
    expect(me.body.user.permissions).toEqual([
      'STAFF_MANAGE',
      'INSTRUCTORS_VIEW',
      'INSTRUCTORS_MANAGE',
    ]);

    // Moving the clerk from Kandy to Main applies at once.
    await branchContext(kandy).expect(200);
    await http()
      .put(`/tenant/staff/${clerk.id}/branches`)
      .set(bearer(token))
      .send({
        branchAccess: 'SELECTED',
        branchIds: [mainBranchId],
        defaultBranchId: mainBranchId,
      })
      .expect(200);
    await branchContext(kandy).expect(403);
    await branchContext(mainBranchId).expect(200);

    // Email change: signed out; the new email works.
    await http()
      .patch(`/tenant/staff/${clerk.id}`)
      .set(bearer(token))
      .send({ email: 'clerk2@school.lk', nic: '199112345678' })
      .expect(200);
    await http().get('/tenant/auth/me').set(bearer(clerkToken)).expect(401);
    const second = (await login('clerk2@school.lk', STAFF_REAL).expect(200))
      .body.accessToken as string;

    // Password reset: signed out; the temporary password must be changed.
    await http()
      .post(`/tenant/staff/${clerk.id}/reset-password`)
      .set(bearer(token))
      .send({ temporaryPassword: 'Another-Temp-Pass-1' })
      .expect(200)
      .expect(({ body }) => expect(body.mustChangePassword).toBe(true));
    await http().get('/tenant/auth/me').set(bearer(second)).expect(401);
    const third = (
      await login('clerk2@school.lk', 'Another-Temp-Pass-1').expect(200)
    ).body.accessToken as string;

    // Disable: signed out, cannot sign in; enable restores sign-in.
    await http()
      .post(`/tenant/staff/${clerk.id}/disable`)
      .set(bearer(token))
      .expect(200)
      .expect(({ body }) => expect(body.status).toBe('DISABLED'));
    await http().get('/tenant/auth/me').set(bearer(third)).expect(401);
    await login('clerk2@school.lk', 'Another-Temp-Pass-1').expect(401);
    await http()
      .post(`/tenant/staff/${clerk.id}/disable`)
      .set(bearer(token))
      .expect(409);
    await http()
      .post(`/tenant/staff/${clerk.id}/enable`)
      .set(bearer(token))
      .expect(200);
    await login('clerk2@school.lk', 'Another-Temp-Pass-1').expect(200);

    const actions = (
      await prisma.tenantAuditLog.findMany({
        where: { targetId: clerk.id, action: { startsWith: 'STAFF_' } },
        orderBy: { createdAt: 'asc' },
      })
    ).map((e) => e.action);
    expect(actions).toEqual([
      'STAFF_CREATED',
      'STAFF_ROLE_CHANGED',
      'STAFF_BRANCHES_CHANGED',
      'STAFF_UPDATED',
      'STAFF_PASSWORD_RESET',
      'STAFF_DISABLED',
      'STAFF_ENABLED',
    ]);
  });

  it('enforces MAX_STAFF_USERS with the owner counted', async () => {
    const { token, mainBranchId } = await onboard();
    await setLimit(PlanLimitCode.MAX_STAFF_USERS, 2);
    const body = (email: string) => ({
      email,
      role: 'FRONT_DESK',
      branchAccess: 'SELECTED',
      branchIds: [mainBranchId],
      defaultBranchId: mainBranchId,
    });
    await createStaff(token, body('a@school.lk')).expect(201);
    await createStaff(token, body('b@school.lk'))
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe('PLAN_LIMIT_REACHED'));
  });

  it('is only for staff managers and never crosses schools', async () => {
    const { token, mainBranchId } = await onboard();
    const clerk = (
      await createStaff(token, {
        email: 'clerk@school.lk',
        role: 'FRONT_DESK',
        branchAccess: 'SELECTED',
        branchIds: [mainBranchId],
        defaultBranchId: mainBranchId,
      }).expect(201)
    ).body;
    const clerkToken = await firstLogin(
      'clerk@school.lk',
      STAFF_TEMP,
      STAFF_REAL,
    );
    for (const path of [
      '/tenant/staff',
      '/tenant/staff/options',
      `/tenant/staff/${clerk.id}`,
    ]) {
      await http()
        .get(path)
        .set(bearer(clerkToken))
        .expect(403)
        .expect(({ body }) =>
          expect(body.code).toBe('TENANT_PERMISSION_DENIED'),
        );
    }
    // Unknown ids look the same as another school's.
    await http()
      .get(`/tenant/staff/${crypto.randomUUID()}`)
      .set(bearer(token))
      .expect(404)
      .expect(({ body }) => expect(body.code).toBe('STAFF_NOT_FOUND'));
    // Platform tokens never work here.
    await http().get('/tenant/staff').set(bearer(adminToken)).expect(401);
  });

  it('lets platform admins see the users and seat usage, read-only', async () => {
    const { tenantId, token, mainBranchId } = await onboard();
    await createStaff(token, {
      email: 'clerk@school.lk',
      role: 'FRONT_DESK',
      branchAccess: 'SELECTED',
      branchIds: [mainBranchId],
      defaultBranchId: mainBranchId,
    }).expect(201);

    const res = await http()
      .get(`/platform/tenants/${tenantId}/users`)
      .set(bearer(adminToken))
      .expect(200);
    expect(res.body).toMatchObject({ seatsUsed: 2, seatLimit: 10 });
    expect(res.body.items.map((u: { role: string }) => u.role)).toEqual([
      'OWNER',
      'FRONT_DESK',
    ]);
    await http()
      .get(`/platform/tenants/${crypto.randomUUID()}/users`)
      .set(bearer(adminToken))
      .expect(404);
  });

  it('lets every user edit their own name and phone, but not email or NIC', async () => {
    const { token } = await onboard();
    const updated = await http()
      .patch('/tenant/me')
      .set(bearer(token))
      .send({ fullName: 'Sunil Owner', phone: '0712223344' })
      .expect(200);
    expect(updated.body).toMatchObject({
      fullName: 'Sunil Owner',
      phone: '+94712223344',
      email: 'owner@school.lk',
    });
    await http()
      .patch('/tenant/me')
      .set(bearer(token))
      .send({ phone: null })
      .expect(400)
      .expect(({ body }) => expect(body.code).toBe('PHONE_REQUIRED'));
    await http()
      .patch('/tenant/me')
      .set(bearer(token))
      .send({ email: 'new@school.lk' })
      .expect(400);
    const me = await http().get('/tenant/auth/me').set(bearer(token));
    expect(me.body.user).toMatchObject({
      fullName: 'Sunil Owner',
      phone: '+94712223344',
    });
  });
});
