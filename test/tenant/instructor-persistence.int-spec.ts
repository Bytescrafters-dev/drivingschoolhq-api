import { Test, type TestingModule } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import {
  DrivingSchoolGrade,
  PlanLimitCode,
  TenantRole,
  TenantUserBranchAccess,
} from '../../src/generated/prisma/enums.js';
import type { AuthenticatedTenantUser } from '../../src/tenant/auth/interfaces/authenticated-tenant-user.js';
import { InstructorsService } from '../../src/tenant/instructors/instructors.service.js';
import { createTestPrisma, resetDatabase } from '../support/database.js';
import { META } from '../support/fakes.js';
import { createPlatformAdmin } from '../support/platform-fixtures.js';
import {
  createPlanPrice,
  createPricePlan,
  createSubscription,
  createTenant,
  createTenantUser,
  mainBranchOf,
} from '../support/tenancy-fixtures.js';

const LICENCE = {
  licenceNumber: 'DI/CP/0007',
  grade: DrivingSchoolGrade.A,
  issuedOn: '2026-01-01',
  expiresOn: '2028-01-01',
};

describe('Instructor profile persistence (real database)', () => {
  let prisma: PrismaClient;
  let moduleRef: TestingModule;
  let service: InstructorsService;

  beforeAll(async () => {
    prisma = createTestPrisma();
    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    await moduleRef.init();
    service = moduleRef.get(InstructorsService);
  });

  afterAll(async () => {
    await moduleRef.close();
    await prisma.$disconnect();
  });

  beforeEach(() => resetDatabase(prisma));

  async function school(maxInstructors: number | null = null) {
    const admin = await createPlatformAdmin(prisma);
    const tenant = await createTenant(prisma, admin.id);
    const plan = await createPricePlan(prisma, admin.id);
    const price = await createPlanPrice(prisma, plan.id);
    await prisma.planLimit.create({
      data: {
        planId: plan.id,
        code: PlanLimitCode.MAX_INSTRUCTORS,
        value: maxInstructors,
      },
    });
    await createSubscription(prisma, {
      tenantId: tenant.id,
      planId: plan.id,
      planPriceId: price.id,
      createdById: admin.id,
    });
    const main = await mainBranchOf(prisma, tenant.id);
    const owner = await createTenantUser(prisma, {
      tenantId: tenant.id,
      role: TenantRole.OWNER,
      createdByPlatformAdminId: admin.id,
    });
    const actor: AuthenticatedTenantUser = {
      id: owner.id,
      tenantId: tenant.id,
      email: owner.email,
      fullName: owner.fullName,
      role: TenantRole.OWNER,
      sessionId: crypto.randomUUID(),
      mustChangePassword: false,
      branchAccess: TenantUserBranchAccess.ALL,
      defaultBranchId: main.id,
    };
    const instructor = () =>
      createTenantUser(prisma, {
        tenantId: tenant.id,
        role: TenantRole.INSTRUCTOR,
        createdByTenantUserId: owner.id,
      });
    return { tenant, main, owner, actor, instructor };
  }

  it('creates a profile with its first licence, pre-filled classes and audit', async () => {
    const { tenant, actor, instructor } = await school();
    const nimal = await instructor();
    const detail = await service.createProfile(actor, nimal.id, LICENCE, META);

    const stored = await prisma.instructorProfile.findUniqueOrThrow({
      where: {
        tenantId_tenantUserId: { tenantId: tenant.id, tenantUserId: nimal.id },
      },
      include: { licences: true, qualifiedClasses: true },
    });
    expect(stored.status).toBe('ACTIVE');
    expect(stored.createdByTenantUserId).toBe(actor.id);
    expect(stored.licences).toHaveLength(1);
    expect(stored.currentLicenceId).toBe(stored.licences[0]!.id);
    expect(stored.licences[0]!.licenceNumber).toBe('DI/CP/0007');
    expect(stored.qualifiedClasses).toHaveLength(13);
    expect(detail.person.profile!.id).toBe(stored.id);

    const audit = await prisma.tenantAuditLog.findFirstOrThrow({
      where: { tenantId: tenant.id, action: 'INSTRUCTOR_PROFILE_CREATED' },
    });
    expect(audit).toMatchObject({
      actorTenantUserId: actor.id,
      targetType: 'TENANT_USER',
      targetId: nimal.id,
    });
    expect(audit.metadata).toMatchObject({
      instructorProfileId: stored.id,
      grade: 'A',
      vehicleClasses: expect.arrayContaining(['CE', 'DE']),
    });
  });

  it('never lets concurrent set-ups exceed MAX_INSTRUCTORS', async () => {
    const { tenant, actor, instructor } = await school(1);
    const people = await Promise.all([instructor(), instructor()]);
    const results = await Promise.allSettled(
      people.map((p) => service.createProfile(actor, p.id, LICENCE, META)),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected');
    expect((rejected as PromiseRejectedResult).reason.code).toBe(
      'PLAN_LIMIT_REACHED',
    );
    expect(
      await prisma.instructorProfile.count({ where: { tenantId: tenant.id } }),
    ).toBe(1);
  });

  it('allows one profile per person', async () => {
    const { tenant, actor, instructor } = await school();
    const nimal = await instructor();
    await service.createProfile(actor, nimal.id, LICENCE, META);
    await expect(
      prisma.instructorProfile.create({
        data: {
          tenantId: tenant.id,
          tenantUserId: nimal.id,
          createdByTenantUserId: actor.id,
        },
      }),
    ).rejects.toThrow();
  });

  it('refuses profiles, licence pointers and classes across tenants and profiles', async () => {
    const a = await school();
    const b = await school();
    const aNimal = await a.instructor();
    const aKamal = await a.instructor();
    const classB = await prisma.vehicleClass.findUniqueOrThrow({
      where: { code: 'B' },
    });

    // A profile for tenant A's user tagged with tenant B.
    await expect(
      prisma.instructorProfile.create({
        data: {
          tenantId: b.tenant.id,
          tenantUserId: aNimal.id,
          createdByTenantUserId: b.owner.id,
        },
      }),
    ).rejects.toThrow();

    const nimal = await service.createProfile(
      a.actor,
      aNimal.id,
      LICENCE,
      META,
    );
    const kamal = await service.createProfile(
      a.actor,
      aKamal.id,
      LICENCE,
      META,
    );
    const nimalProfile = nimal.person.profile!;
    const kamalProfile = kamal.person.profile!;

    // Pointing a profile at another profile's licence (same school).
    await expect(
      prisma.instructorProfile.update({
        where: { id: kamalProfile.id },
        data: { currentLicenceId: nimalProfile.currentLicence!.id },
      }),
    ).rejects.toThrow();

    // A licence or a class of tenant A's profile tagged with tenant B.
    await expect(
      prisma.instructorLicence.create({
        data: {
          tenantId: b.tenant.id,
          instructorProfileId: nimalProfile.id,
          licenceNumber: 'X',
          grade: DrivingSchoolGrade.A,
          issuedOn: new Date('2026-01-01'),
          expiresOn: new Date('2027-01-01'),
          recordedByTenantUserId: b.owner.id,
        },
      }),
    ).rejects.toThrow();
    await prisma.instructorVehicleClass.deleteMany({
      where: {
        instructorProfileId: nimalProfile.id,
        vehicleClassId: classB.id,
      },
    });
    await expect(
      prisma.instructorVehicleClass.create({
        data: {
          tenantId: b.tenant.id,
          instructorProfileId: nimalProfile.id,
          vehicleClassId: classB.id,
        },
      }),
    ).rejects.toThrow();
  });
});
