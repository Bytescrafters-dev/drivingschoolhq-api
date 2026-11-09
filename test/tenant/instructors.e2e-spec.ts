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

const ALL_CLASSES = [
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
];
const GRADE_C_CLASSES = ['A1', 'A', 'B1', 'B', 'G'];

const LICENCE = {
  licenceNumber: 'DI/WP/0007',
  grade: 'A',
  issuedOn: '2026-02-01',
  expiresOn: '2028-01-31',
};

/** A calendar date safely inside the 30-day expiry warning window. */
function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

interface Person {
  id: string;
  token: string;
}

describe('Instructor profiles (e2e)', () => {
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

  /** Plan limits; MAX_INSTRUCTORS null = unlimited. */
  async function setUpPlan(maxInstructors: number | null) {
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
    await prisma.planLimit.create({
      data: {
        planId,
        code: PlanLimitCode.MAX_INSTRUCTORS,
        value: maxInstructors,
      },
    });
  }

  function login(dsCode: string, email: string, password: string) {
    return http().post('/tenant/auth/login').send({ dsCode, email, password });
  }

  async function firstLogin(
    dsCode: string,
    email: string,
    temp: string,
    real: string,
  ): Promise<Person> {
    const first = await login(dsCode, email, temp).expect(200);
    await http()
      .post('/tenant/auth/change-password')
      .set(bearer(first.body.accessToken))
      .send({ currentPassword: temp, newPassword: real })
      .expect(204);
    const token = (await login(dsCode, email, real).expect(200)).body
      .accessToken as string;
    const me = await http().get('/tenant/auth/me').set(bearer(token));
    return { id: me.body.user.id as string, token };
  }

  async function onboard(dsCode: string) {
    await http()
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
    const owner = await firstLogin(dsCode, 'owner@school.lk', TEMP, REAL);
    const me = await http().get('/tenant/auth/me').set(bearer(owner.token));
    const mainBranchId = me.body.user.defaultBranchId as string;
    // The Main Branch is Grade C and offers everything Grade C permits.
    await http()
      .post(`/tenant/branches/${mainBranchId}/licence`)
      .set(bearer(owner.token))
      .send({ ...LICENCE, licenceNumber: 'DS/WP/0042', grade: 'C' })
      .expect(201);
    return { owner, mainBranchId };
  }

  async function staff(
    dsCode: string,
    ownerToken: string,
    body: Record<string, unknown>,
  ): Promise<Person> {
    await http()
      .post('/tenant/staff')
      .set(bearer(ownerToken))
      .send({ fullName: 'Staff', temporaryPassword: STAFF_TEMP, ...body })
      .expect(201);
    return firstLogin(dsCode, body.email as string, STAFF_TEMP, STAFF_REAL);
  }

  function selected(email: string, role: string, branchId: string) {
    return {
      email,
      role,
      branchAccess: 'SELECTED',
      branchIds: [branchId],
      defaultBranchId: branchId,
    };
  }

  function list(token: string, branchId: string) {
    return http()
      .get('/tenant/instructors')
      .set(bearer(token))
      .set('X-Branch-Id', branchId);
  }

  function rowOf(body: { items: { user: { id: string } }[] }, id: string) {
    return body.items.find((i) => i.user.id === id) as
      Record<string, any> | undefined;
  }

  it('sets up, edits and inactivates an instructor; teaching = branch ∩ instructor', async () => {
    await setUpPlan(null);
    const { owner, mainBranchId } = await onboard('DS1');
    const nimal = await staff(
      'DS1',
      owner.token,
      selected('nimal@school.lk', 'INSTRUCTOR', mainBranchId),
    );

    // INSTRUCTOR-role staff without a profile: setup required, no seat.
    const before = await list(owner.token, mainBranchId).expect(200);
    expect(rowOf(before.body, nimal.id)).toMatchObject({
      profileStatus: 'SETUP_REQUIRED',
      profile: null,
      teachableHere: [],
      canCreate: true,
      readiness: {
        assignable: false,
        blockers: [{ code: 'INSTRUCTOR_SETUP_REQUIRED' }],
      },
    });
    await http()
      .get('/tenant/instructors')
      .set(bearer(owner.token))
      .expect(400);
    const mine = await http()
      .get('/tenant/me/instructor-profile')
      .set(bearer(nimal.token))
      .expect(200);
    expect(mine.body).toMatchObject({
      profileStatus: 'SETUP_REQUIRED',
      canCreate: true,
    });

    // The instructor sets up their own Grade A profile: all 13 classes.
    const created = await http()
      .post(`/tenant/instructors/${nimal.id}/profile`)
      .set(bearer(nimal.token))
      .send({ ...LICENCE, licenceNumber: ' DI/WP/0007 ' })
      .expect(201);
    expect(created.body).toMatchObject({
      profileStatus: 'ACTIVE',
      qualifiedVehicleClasses: ALL_CLASSES,
      currentLicence: { licenceNumber: 'DI/WP/0007', grade: 'A' },
      canEdit: true,
      canChangeStatus: false,
      readiness: { assignable: true },
      branches: [
        { id: mainBranchId, teachableVehicleClasses: GRADE_C_CLASSES },
      ],
    });
    await http()
      .post(`/tenant/instructors/${nimal.id}/profile`)
      .set(bearer(nimal.token))
      .send(LICENCE)
      .expect(409)
      .expect(({ body }) =>
        expect(body.code).toBe('INSTRUCTOR_PROFILE_EXISTS'),
      );

    // At the Grade C branch they teach only what the branch offers.
    const after = await list(owner.token, mainBranchId).expect(200);
    expect(rowOf(after.body, nimal.id)).toMatchObject({
      profileStatus: 'ACTIVE',
      teachableHere: GRADE_C_CLASSES,
      canEdit: true,
      canChangeStatus: true,
    });

    // Opt out of CE; a class the grade does not permit is rejected.
    const optedOut = await http()
      .put(`/tenant/instructors/${nimal.id}/vehicle-classes`)
      .set(bearer(nimal.token))
      .send({ codes: ALL_CLASSES.filter((c) => c !== 'CE') })
      .expect(200);
    expect(optedOut.body.qualifiedVehicleClasses).toHaveLength(12);

    // Renewal at Grade C: classes C does not permit are dropped (audited).
    const renewed = await http()
      .post(`/tenant/instructors/${nimal.id}/licence`)
      .set(bearer(owner.token))
      .send({ ...LICENCE, licenceNumber: 'DI/WP/0099', grade: 'C' })
      .expect(201);
    expect(renewed.body.removedVehicleClasses).toEqual([
      'C1',
      'C',
      'D1',
      'D',
      'DE',
      'G1',
      'J',
    ]);
    expect(renewed.body.qualifiedVehicleClasses).toEqual(GRADE_C_CLASSES);
    expect(renewed.body.licenceHistory).toHaveLength(2);
    await http()
      .put(`/tenant/instructors/${nimal.id}/vehicle-classes`)
      .set(bearer(nimal.token))
      .send({ codes: ['B', 'CE'] })
      .expect(409)
      .expect(({ body }) =>
        expect(body.code).toBe('VEHICLE_CLASS_NOT_PERMITTED'),
      );
    const corrected = await http()
      .patch(`/tenant/instructors/${nimal.id}/licence`)
      .set(bearer(nimal.token))
      .send({ expiresOn: daysFromNow(10) })
      .expect(200);
    expect(corrected.body.licenceHistory).toHaveLength(2);
    expect(corrected.body.readiness).toMatchObject({
      assignable: true,
      warnings: [{ code: 'INSTRUCTOR_LICENCE_EXPIRING' }],
    });

    // Only managers inactivate/reactivate, the instructor's own included.
    await http()
      .post(`/tenant/instructors/${nimal.id}/inactivate`)
      .set(bearer(nimal.token))
      .expect(403)
      .expect(({ body }) =>
        expect(body.code).toBe('INSTRUCTOR_MANAGEMENT_DENIED'),
      );
    const inactive = await http()
      .post(`/tenant/instructors/${nimal.id}/inactivate`)
      .set(bearer(owner.token))
      .expect(200);
    expect(inactive.body.profileStatus).toBe('INACTIVE');
    expect(inactive.body.readiness.blockers).toEqual([
      { code: 'INSTRUCTOR_INACTIVE' },
    ]);
    const inactiveOnly = await http()
      .get('/tenant/instructors?profileStatus=INACTIVE')
      .set(bearer(owner.token))
      .set('X-Branch-Id', mainBranchId)
      .expect(200);
    expect(inactiveOnly.body.items.map((i: any) => i.user.id)).toEqual([
      nimal.id,
    ]);
    await http()
      .post(`/tenant/instructors/${nimal.id}/reactivate`)
      .set(bearer(owner.token))
      .expect(200)
      .expect(({ body }) => expect(body.profileStatus).toBe('ACTIVE'));

    const actions = (
      await prisma.tenantAuditLog.findMany({
        where: { targetId: nimal.id, action: { startsWith: 'INSTRUCTOR_' } },
        orderBy: { createdAt: 'asc' },
      })
    ).map((a) => a.action);
    expect([...actions].sort()).toEqual(
      [
        'INSTRUCTOR_PROFILE_CREATED',
        'INSTRUCTOR_VEHICLE_CLASSES_CHANGED',
        'INSTRUCTOR_LICENCE_RECORDED',
        'INSTRUCTOR_LICENCE_CORRECTED',
        'INSTRUCTOR_PROFILE_INACTIVATED',
        'INSTRUCTOR_PROFILE_REACTIVATED',
      ].sort(),
    );
  });

  it('counts ACTIVE profiles against MAX_INSTRUCTORS; a disabled staff member keeps their seat', async () => {
    await setUpPlan(1);
    const { owner, mainBranchId } = await onboard('DS1');
    const nimal = await staff(
      'DS1',
      owner.token,
      selected('nimal@school.lk', 'INSTRUCTOR', mainBranchId),
    );

    // The owner teaches too: any role may hold a profile.
    await http()
      .post(`/tenant/instructors/${owner.id}/profile`)
      .set(bearer(owner.token))
      .send(LICENCE)
      .expect(201);
    await http()
      .post(`/tenant/instructors/${nimal.id}/profile`)
      .set(bearer(owner.token))
      .send(LICENCE)
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe('PLAN_LIMIT_REACHED'));

    // Inactivating frees the seat.
    await http()
      .post(`/tenant/instructors/${owner.id}/inactivate`)
      .set(bearer(owner.token))
      .expect(200);
    await http()
      .post(`/tenant/instructors/${nimal.id}/profile`)
      .set(bearer(owner.token))
      .send(LICENCE)
      .expect(201);
    await http()
      .post(`/tenant/instructors/${owner.id}/reactivate`)
      .set(bearer(owner.token))
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe('PLAN_LIMIT_REACHED'));

    // Disabling the staff member does not touch the profile or its seat.
    await http()
      .post(`/tenant/staff/${nimal.id}/disable`)
      .set(bearer(owner.token))
      .expect(200);
    const row = rowOf(
      (await list(owner.token, mainBranchId).expect(200)).body,
      nimal.id,
    );
    expect(row).toMatchObject({
      user: { status: 'DISABLED' },
      profileStatus: 'ACTIVE',
      readiness: { assignable: false, blockers: [{ code: 'STAFF_DISABLED' }] },
    });
    await http()
      .post(`/tenant/instructors/${owner.id}/reactivate`)
      .set(bearer(owner.token))
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe('PLAN_LIMIT_REACHED'));

    // A disabled staff member's profile cannot be reactivated.
    await http()
      .post(`/tenant/instructors/${nimal.id}/inactivate`)
      .set(bearer(owner.token))
      .expect(200);
    await http()
      .post(`/tenant/instructors/${nimal.id}/reactivate`)
      .set(bearer(owner.token))
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe('STAFF_DISABLED'));
    await http()
      .post(`/tenant/instructors/${owner.id}/reactivate`)
      .set(bearer(owner.token))
      .expect(200);
  });

  it('applies who-may-manage-whom: self-service for all, others for managers, owner-only owner', async () => {
    await setUpPlan(null);
    const { owner, mainBranchId } = await onboard('DS1');
    const admin = await staff('DS1', owner.token, {
      email: 'admin@school.lk',
      role: 'ADMIN',
      branchAccess: 'ALL',
      defaultBranchId: mainBranchId,
    });
    const manager = await staff(
      'DS1',
      owner.token,
      selected('manager@school.lk', 'BRANCH_MANAGER', mainBranchId),
    );
    const desk = await staff(
      'DS1',
      owner.token,
      selected('desk@school.lk', 'FRONT_DESK', mainBranchId),
    );
    const accountant = await staff(
      'DS1',
      owner.token,
      selected('acc@school.lk', 'ACCOUNTANT', mainBranchId),
    );
    const nimal = await staff(
      'DS1',
      owner.token,
      selected('nimal@school.lk', 'INSTRUCTOR', mainBranchId),
    );

    // Managers set up profiles for lower roles.
    await http()
      .post(`/tenant/instructors/${nimal.id}/profile`)
      .set(bearer(manager.token))
      .send(LICENCE)
      .expect(201);
    await http()
      .post(`/tenant/instructors/${owner.id}/profile`)
      .set(bearer(owner.token))
      .send(LICENCE)
      .expect(201);

    // Every role can see instructors and their profiles.
    for (const viewer of [desk, accountant, nimal]) {
      const items = (await list(viewer.token, mainBranchId).expect(200)).body
        .items;
      expect(items.map((i: any) => i.user.id).sort()).toEqual(
        [owner.id, nimal.id].sort(),
      );
      await http()
        .get(`/tenant/instructors/${owner.id}`)
        .set(bearer(viewer.token))
        .expect(200);
    }

    // Non-managers cannot touch anyone else's profile.
    for (const actor of [desk, accountant]) {
      await http()
        .put(`/tenant/instructors/${nimal.id}/vehicle-classes`)
        .set(bearer(actor.token))
        .send({ codes: ['B'] })
        .expect(403)
        .expect(({ body }) =>
          expect(body.code).toBe('INSTRUCTOR_MANAGEMENT_DENIED'),
        );
    }
    await http()
      .post(`/tenant/instructors/${desk.id}/profile`)
      .set(bearer(nimal.token))
      .send(LICENCE)
      .expect(403);

    // ...but anyone may set up their own.
    const deskProfile = await http()
      .post(`/tenant/instructors/${desk.id}/profile`)
      .set(bearer(desk.token))
      .send({ ...LICENCE, grade: 'B' })
      .expect(201);
    expect(deskProfile.body.qualifiedVehicleClasses).toHaveLength(11);
    expect(deskProfile.body.user.role).toBe('FRONT_DESK');

    // The owner's profile is owner-only.
    await http()
      .patch(`/tenant/instructors/${owner.id}/licence`)
      .set(bearer(admin.token))
      .send({ grade: 'B' })
      .expect(403)
      .expect(({ body }) =>
        expect(body.code).toBe('INSTRUCTOR_MANAGEMENT_DENIED'),
      );
    await http()
      .post(`/tenant/instructors/${owner.id}/inactivate`)
      .set(bearer(admin.token))
      .expect(403);

    // Candidates: managers only; people without a profile they can manage.
    await http()
      .get('/tenant/instructors/candidates')
      .set(bearer(desk.token))
      .set('X-Branch-Id', mainBranchId)
      .expect(403);
    const candidates = await http()
      .get('/tenant/instructors/candidates')
      .set(bearer(manager.token))
      .set('X-Branch-Id', mainBranchId)
      .expect(200);
    expect(candidates.body.items.map((i: any) => i.user.id).sort()).toEqual(
      [manager.id, accountant.id].sort(),
    );
  });

  it('lists only people who work in the selected branch and hides other tenants', async () => {
    await setUpPlan(null);
    const { owner, mainBranchId } = await onboard('DS1');
    const kandyId = (
      await http()
        .post('/tenant/branches')
        .set(bearer(owner.token))
        .send({
          name: 'Kandy',
          address: '5 Peradeniya Road',
          district: 'KANDY',
          phone: '0812223333',
        })
        .expect(201)
    ).body.id as string;
    const kamal = await staff(
      'DS1',
      owner.token,
      selected('kamal@school.lk', 'INSTRUCTOR', kandyId),
    );
    const manager = await staff(
      'DS1',
      owner.token,
      selected('manager@school.lk', 'BRANCH_MANAGER', mainBranchId),
    );
    await http()
      .post(`/tenant/instructors/${kamal.id}/profile`)
      .set(bearer(owner.token))
      .send(LICENCE)
      .expect(201);

    const main = await list(owner.token, mainBranchId).expect(200);
    expect(rowOf(main.body, kamal.id)).toBeUndefined();
    const kandy = await list(owner.token, kandyId).expect(200);
    // Kandy has no profile yet: nothing is teachable there.
    expect(rowOf(kandy.body, kamal.id)).toMatchObject({
      profileStatus: 'ACTIVE',
      teachableHere: [],
    });

    // A manager of another branch neither sees nor manages Kamal.
    await list(manager.token, kandyId)
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe('BRANCH_ACCESS_DENIED'));
    await http()
      .get(`/tenant/instructors/${kamal.id}`)
      .set(bearer(manager.token))
      .expect(404);
    await http()
      .post(`/tenant/instructors/${kamal.id}/inactivate`)
      .set(bearer(manager.token))
      .expect(404)
      .expect(({ body }) => expect(body.code).toBe('INSTRUCTOR_NOT_FOUND'));

    // Another tenant cannot reach DS1's instructor.
    const { owner: otherOwner } = await onboard('DS2');
    await http()
      .get(`/tenant/instructors/${kamal.id}`)
      .set(bearer(otherOwner.token))
      .expect(404);
    await http()
      .post(`/tenant/instructors/${kamal.id}/profile`)
      .set(bearer(otherOwner.token))
      .send(LICENCE)
      .expect(404);
  });
});
