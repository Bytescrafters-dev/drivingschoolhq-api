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

const GRADE_C = {
  licenceNumber: 'DS/WP/0042',
  grade: 'C',
  issuedOn: '2026-01-15',
  expiresOn: '2027-01-14',
};

describe('Branch profile: vehicle classes, grade and licence (e2e)', () => {
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
    for (const code of [
      PlanLimitCode.MAX_BRANCHES,
      PlanLimitCode.MAX_STAFF_USERS,
    ]) {
      await prisma.planLimit.create({ data: { planId, code, value: null } });
    }
  });

  function login(dsCode: string, email: string, password: string) {
    return http().post('/tenant/auth/login').send({ dsCode, email, password });
  }

  async function firstLogin(
    dsCode: string,
    email: string,
    temp: string,
    real: string,
  ) {
    const first = await login(dsCode, email, temp).expect(200);
    await http()
      .post('/tenant/auth/change-password')
      .set(bearer(first.body.accessToken))
      .send({ currentPassword: temp, newPassword: real })
      .expect(204);
    return (await login(dsCode, email, real).expect(200)).body
      .accessToken as string;
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
    const token = await firstLogin(dsCode, 'owner@school.lk', TEMP, REAL);
    const me = await http().get('/tenant/auth/me').set(bearer(token));
    return {
      tenantId: res.body.id as string,
      token,
      mainBranchId: me.body.user.defaultBranchId as string,
    };
  }

  async function staff(
    dsCode: string,
    ownerToken: string,
    body: Record<string, unknown>,
  ) {
    await http()
      .post('/tenant/staff')
      .set(bearer(ownerToken))
      .send({ fullName: 'Staff', temporaryPassword: STAFF_TEMP, ...body })
      .expect(201);
    return firstLogin(dsCode, body.email as string, STAFF_TEMP, STAFF_REAL);
  }

  it('lists the DMT classes with the grades permitted to teach them', async () => {
    const { token } = await onboard('DS1');
    const res = await http()
      .get('/tenant/vehicle-classes')
      .set(bearer(token))
      .expect(200);
    expect(res.body.items.map((c: { code: string }) => c.code)).toEqual([
      'A1',
      'A',
      'B1',
      'B',
      'C1',
      'C',
      'CE',
      'D1',
      'D',
      'DE',
      'G1',
      'G',
      'J',
    ]);
    const ce = res.body.items.find((c: { code: string }) => c.code === 'CE');
    expect(ce.permittedGrades).toEqual(['A']);
    const b = res.body.items.find((c: { code: string }) => c.code === 'B');
    expect(b.permittedGrades).toEqual(['A', 'B', 'C']);
  });

  it('completes the Main Branch profile: licence, pre-filled classes, opt-out, downgrade', async () => {
    const { token, mainBranchId } = await onboard('DS1');

    // Created with minimal details: profile incomplete.
    const before = await http()
      .get('/tenant/branches')
      .set(bearer(token))
      .expect(200);
    expect(before.body.items[0].profile).toEqual({
      grade: null,
      licenceNumber: null,
      licenceExpiresOn: null,
      offeredVehicleClasses: [],
      readiness: {
        operational: false,
        blockers: [{ code: 'BRANCH_LICENCE_MISSING' }],
        warnings: [],
      },
    });
    await http()
      .put(`/tenant/branches/${mainBranchId}/vehicle-classes`)
      .set(bearer(token))
      .send({ codes: ['B'] })
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe('BRANCH_LICENCE_MISSING'));

    // First licence (Grade A): every class pre-filled.
    const recorded = await http()
      .post(`/tenant/branches/${mainBranchId}/licence`)
      .set(bearer(token))
      .send({ ...GRADE_C, grade: 'A' })
      .expect(201);
    expect(recorded.body.currentLicence).toMatchObject({
      licenceNumber: 'DS/WP/0042',
      grade: 'A',
      issuedOn: '2026-01-15',
      expiresOn: '2027-01-14',
    });
    expect(recorded.body.offeredVehicleClasses).toHaveLength(13);
    expect(recorded.body.removedVehicleClasses).toEqual([]);

    // The school opts out of CE.
    const allButCe = recorded.body.permittedVehicleClasses
      .map((c: { code: string }) => c.code)
      .filter((code: string) => code !== 'CE');
    const optedOut = await http()
      .put(`/tenant/branches/${mainBranchId}/vehicle-classes`)
      .set(bearer(token))
      .send({ codes: allButCe })
      .expect(200);
    expect(optedOut.body.offeredVehicleClasses).toHaveLength(12);
    expect(optedOut.body.readiness.operational).toBe(true);

    // Corrected down to Grade C: classes C permits survive, the rest go.
    const corrected = await http()
      .patch(`/tenant/branches/${mainBranchId}/licence`)
      .set(bearer(token))
      .send({ grade: 'C' })
      .expect(200);
    expect(corrected.body.removedVehicleClasses).toEqual([
      'C1',
      'C',
      'D1',
      'D',
      'DE',
      'G1',
      'J',
    ]);
    expect(
      corrected.body.offeredVehicleClasses.map((c: { code: string }) => c.code),
    ).toEqual(['A1', 'A', 'B1', 'B', 'G']);
    await http()
      .put(`/tenant/branches/${mainBranchId}/vehicle-classes`)
      .set(bearer(token))
      .send({ codes: ['B', 'CE'] })
      .expect(409)
      .expect(({ body }) =>
        expect(body.code).toBe('VEHICLE_CLASS_NOT_PERMITTED'),
      );

    // Detail endpoint carries the summary.
    const detail = await http()
      .get(`/tenant/branches/${mainBranchId}`)
      .set(bearer(token))
      .expect(200);
    expect(detail.body.profile).toMatchObject({
      grade: 'C',
      licenceNumber: 'DS/WP/0042',
      licenceExpiresOn: '2027-01-14',
      offeredVehicleClasses: ['A1', 'A', 'B1', 'B', 'G'],
    });

    // Validation at the boundary.
    await http()
      .post(`/tenant/branches/${mainBranchId}/licence`)
      .set(bearer(token))
      .send({ ...GRADE_C, grade: 'D' })
      .expect(400);
    await http()
      .post(`/tenant/branches/${mainBranchId}/licence`)
      .set(bearer(token))
      .send({ ...GRADE_C, expiresOn: '2025-01-01' })
      .expect(400)
      .expect(({ body }) => expect(body.code).toBe('INVALID_LICENCE_DATES'));
  });

  it('lets only OWNER and ADMIN manage the profile; branch staff can read it', async () => {
    const { token: ownerToken, mainBranchId } = await onboard('DS1');
    const other = (
      await http()
        .post('/tenant/branches')
        .set(bearer(ownerToken))
        .send({
          name: 'Kandy',
          address: 'Somewhere',
          district: 'KANDY',
          phone: '0812223333',
        })
        .expect(201)
    ).body.id as string;
    const adminToken = await staff('DS1', ownerToken, {
      email: 'admin@school.lk',
      role: 'ADMIN',
      branchAccess: 'ALL',
      defaultBranchId: mainBranchId,
    });
    const managerToken = await staff('DS1', ownerToken, {
      email: 'manager@school.lk',
      role: 'BRANCH_MANAGER',
      branchAccess: 'SELECTED',
      branchIds: [mainBranchId],
      defaultBranchId: mainBranchId,
    });

    await http()
      .post(`/tenant/branches/${mainBranchId}/licence`)
      .set(bearer(adminToken))
      .send(GRADE_C)
      .expect(201);

    await http()
      .get(`/tenant/branches/${mainBranchId}/profile`)
      .set(bearer(managerToken))
      .expect(200)
      .expect(({ body }) => expect(body.currentLicence.grade).toBe('C'));
    for (const send of [
      () =>
        http().post(`/tenant/branches/${mainBranchId}/licence`).send(GRADE_C),
      () =>
        http()
          .patch(`/tenant/branches/${mainBranchId}/licence`)
          .send({ grade: 'A' }),
      () =>
        http()
          .put(`/tenant/branches/${mainBranchId}/vehicle-classes`)
          .send({ codes: ['B'] }),
    ]) {
      await send()
        .set(bearer(managerToken))
        .expect(403)
        .expect(({ body }) =>
          expect(body.code).toBe('TENANT_PERMISSION_DENIED'),
        );
    }
    // Not assigned to the other branch: it doesn't exist for them.
    await http()
      .get(`/tenant/branches/${other}/profile`)
      .set(bearer(managerToken))
      .expect(404)
      .expect(({ body }) => expect(body.code).toBe('BRANCH_NOT_FOUND'));
  });

  it("hides another school's branches and rejects edits to closed branches", async () => {
    const a = await onboard('DS1');
    const b = await onboard('DS2');
    await http()
      .get(`/tenant/branches/${b.mainBranchId}/profile`)
      .set(bearer(a.token))
      .expect(404);
    await http()
      .post(`/tenant/branches/${b.mainBranchId}/licence`)
      .set(bearer(a.token))
      .send(GRADE_C)
      .expect(404)
      .expect(({ body }) => expect(body.code).toBe('BRANCH_NOT_FOUND'));

    const kandy = (
      await http()
        .post('/tenant/branches')
        .set(bearer(a.token))
        .send({
          name: 'Kandy',
          address: 'Somewhere',
          district: 'KANDY',
          phone: '0812223333',
        })
        .expect(201)
    ).body.id as string;
    await http()
      .post(`/tenant/branches/${kandy}/close`)
      .set(bearer(a.token))
      .expect(200);
    await http()
      .post(`/tenant/branches/${kandy}/licence`)
      .set(bearer(a.token))
      .send(GRADE_C)
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe('BRANCH_CLOSED'));
  });

  it('shows platform admins the grade and licence, read-only', async () => {
    const { tenantId, token, mainBranchId } = await onboard('DS1');
    await http()
      .post(`/tenant/branches/${mainBranchId}/licence`)
      .set(bearer(token))
      .send(GRADE_C)
      .expect(201);

    const list = await http()
      .get(`/platform/tenants/${tenantId}/branches`)
      .set(bearer(adminToken))
      .expect(200);
    expect(list.body.items[0].profile).toMatchObject({
      grade: 'C',
      licenceNumber: 'DS/WP/0042',
      licenceExpiresOn: '2027-01-14',
      offeredVehicleClasses: ['A1', 'A', 'B1', 'B', 'G'],
    });

    const profile = await http()
      .get(`/platform/tenants/${tenantId}/branches/${mainBranchId}/profile`)
      .set(bearer(adminToken))
      .expect(200);
    expect(profile.body.licenceHistory).toHaveLength(1);
    expect(profile.body.permittedVehicleClasses).toHaveLength(5);

    await http()
      .get(
        `/platform/tenants/${tenantId}/branches/${crypto.randomUUID()}/profile`,
      )
      .set(bearer(adminToken))
      .expect(404)
      .expect(({ body }) => expect(body.code).toBe('BRANCH_NOT_FOUND'));
    // A tenant token is not a platform token.
    await http()
      .get(`/platform/tenants/${tenantId}/branches/${mainBranchId}/profile`)
      .set(bearer(token))
      .expect(401);
  });
});
