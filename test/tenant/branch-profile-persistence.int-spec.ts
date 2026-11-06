import { Test, type TestingModule } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import {
  DrivingSchoolGrade,
  TenantRole,
  TenantUserBranchAccess,
} from '../../src/generated/prisma/enums.js';
import type { AuthenticatedTenantUser } from '../../src/tenant/auth/interfaces/authenticated-tenant-user.js';
import { BranchProfileService } from '../../src/tenant/branches/profile/branch-profile.service.js';
import { createTestPrisma, resetDatabase } from '../support/database.js';
import { META } from '../support/fakes.js';
import { createPlatformAdmin } from '../support/platform-fixtures.js';
import {
  createTenant,
  createTenantUser,
  mainBranchOf,
} from '../support/tenancy-fixtures.js';

const LICENCE = {
  licenceNumber: 'DS/CP/0007',
  grade: DrivingSchoolGrade.A,
  issuedOn: '2026-01-01',
  expiresOn: '2027-01-01',
};

describe('Branch profile persistence (real database)', () => {
  let prisma: PrismaClient;
  let moduleRef: TestingModule;
  let service: BranchProfileService;

  beforeAll(async () => {
    prisma = createTestPrisma();
    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    await moduleRef.init();
    service = moduleRef.get(BranchProfileService);
  });

  afterAll(async () => {
    await moduleRef.close();
    await prisma.$disconnect();
  });

  beforeEach(() => resetDatabase(prisma));

  async function school() {
    const admin = await createPlatformAdmin(prisma);
    const tenant = await createTenant(prisma, admin.id);
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
    return { tenant, main, owner, actor };
  }

  it('seeds the 13 DMT classes and the grade matrix (A 13, B 11, C 5); reset keeps them', async () => {
    expect(await prisma.vehicleClass.count()).toBe(13);
    const perGrade = await prisma.drivingSchoolGradeVehicleClass.groupBy({
      by: ['grade'],
      _count: { _all: true },
      orderBy: { grade: 'asc' },
    });
    expect(perGrade.map((g) => [g.grade, g._count._all])).toEqual([
      ['A', 13],
      ['B', 11],
      ['C', 5],
    ]);
    const gradeB = await prisma.drivingSchoolGradeVehicleClass.findMany({
      where: { grade: DrivingSchoolGrade.B },
      select: { vehicleClass: { select: { code: true } } },
    });
    expect(gradeB.map((g) => g.vehicleClass.code)).not.toContain('CE');
    expect(gradeB.map((g) => g.vehicleClass.code)).not.toContain('DE');
  });

  it('records, renews and corrects a licence with history, pointer, offerings and audit', async () => {
    const { tenant, main, actor } = await school();
    const first = await service.recordLicence(actor, main.id, LICENCE, META);
    expect(first.profile.offeredClasses).toHaveLength(13);

    const renewed = await service.recordLicence(
      actor,
      main.id,
      {
        ...LICENCE,
        grade: DrivingSchoolGrade.B,
        issuedOn: '2027-01-02',
        expiresOn: '2028-01-01',
      },
      META,
    );
    expect(renewed.removedVehicleClasses).toEqual(['CE', 'DE']);

    const branch = await prisma.branch.findUniqueOrThrow({
      where: { id: main.id },
      select: { currentLicenceId: true },
    });
    expect(branch.currentLicenceId).toBe(renewed.profile.currentLicence!.id);
    expect(
      await prisma.branchSchoolLicence.count({ where: { branchId: main.id } }),
    ).toBe(2);
    expect(
      await prisma.branchVehicleClass.count({ where: { branchId: main.id } }),
    ).toBe(11);

    await service.correctLicence(
      actor,
      main.id,
      { grade: DrivingSchoolGrade.C },
      META,
    );
    expect(
      await prisma.branchVehicleClass.count({ where: { branchId: main.id } }),
    ).toBe(5);
    const stored = await prisma.branchSchoolLicence.findUniqueOrThrow({
      where: { id: renewed.profile.currentLicence!.id },
    });
    expect(stored.grade).toBe('C');
    expect(stored.issuedOn.toISOString()).toBe('2027-01-02T00:00:00.000Z');

    const audit = await prisma.tenantAuditLog.findMany({
      where: { tenantId: tenant.id, branchId: main.id },
      select: { action: true, metadata: true },
    });
    // Same-millisecond timestamps are possible, so don't rely on order.
    expect(audit.map((a) => a.action).sort()).toEqual([
      'BRANCH_LICENCE_CORRECTED',
      'BRANCH_LICENCE_RECORDED',
      'BRANCH_LICENCE_RECORDED',
    ]);
    const corrected = audit.find(
      (a) => a.action === 'BRANCH_LICENCE_CORRECTED',
    );
    expect(corrected!.metadata).toMatchObject({
      changes: { grade: { from: 'B', to: 'C' } },
      removedVehicleClasses: ['C1', 'C', 'D1', 'D', 'G1', 'J'],
    });
  });

  it('refuses licences, current-licence pointers and offerings across tenants', async () => {
    const a = await school();
    const b = await school();
    const classB = await prisma.vehicleClass.findUniqueOrThrow({
      where: { code: 'B' },
    });

    // Licence for tenant A's branch claimed by tenant B.
    await expect(
      prisma.branchSchoolLicence.create({
        data: {
          tenantId: b.tenant.id,
          branchId: a.main.id,
          licenceNumber: 'X',
          grade: DrivingSchoolGrade.A,
          issuedOn: new Date('2026-01-01'),
          expiresOn: new Date('2027-01-01'),
          recordedByTenantUserId: b.owner.id,
        },
      }),
    ).rejects.toThrow();

    // Branch A pointing at a licence of branch B (other tenant).
    const bLicence = await service.recordLicence(
      b.actor,
      b.main.id,
      LICENCE,
      META,
    );
    await expect(
      prisma.branch.update({
        where: { id: a.main.id },
        data: { currentLicenceId: bLicence.profile.currentLicence!.id },
      }),
    ).rejects.toThrow();

    // Offering on tenant A's branch tagged with tenant B.
    await expect(
      prisma.branchVehicleClass.create({
        data: {
          tenantId: b.tenant.id,
          branchId: a.main.id,
          vehicleClassId: classB.id,
        },
      }),
    ).rejects.toThrow();
  });

  it('cannot point a branch at a licence of another branch of the same school', async () => {
    const { tenant, main, actor } = await school();
    const second = await prisma.branch.create({
      data: {
        tenantId: tenant.id,
        name: 'Second',
        address: '2 Road',
        district: 'COLOMBO',
        phone: '+94771234567',
        createdByTenantUserId: actor.id,
      },
    });
    const { profile } = await service.recordLicence(
      actor,
      main.id,
      LICENCE,
      META,
    );
    await expect(
      prisma.branch.update({
        where: { id: second.id },
        data: { currentLicenceId: profile.currentLicence!.id },
      }),
    ).rejects.toThrow();
  });
});
