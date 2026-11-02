import { Test, type TestingModule } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import {
  BranchStatus,
  PlanLimitCode,
  TenantRole,
  TenantUserBranchAccess,
  TenantUserStatus,
} from '../../src/generated/prisma/enums.js';
import type { AuthenticatedTenantUser } from '../../src/tenant/auth/interfaces/authenticated-tenant-user.js';
import { BranchesService } from '../../src/tenant/branches/branches.service.js';
import {
  STAFF_REPOSITORY,
  type StaffRepository,
} from '../../src/tenant/staff/interfaces/staff.repository.js';
import { StaffService } from '../../src/tenant/staff/staff.service.js';
import { createTestPrisma, resetDatabase } from '../support/database.js';
import { META } from '../support/fakes.js';
import { createPlatformAdmin } from '../support/platform-fixtures.js';
import {
  createBranch,
  createPlanPrice,
  createPricePlan,
  createSubscription,
  createTenant,
  createTenantUser,
  mainBranchOf,
} from '../support/tenancy-fixtures.js';

const PASSWORD = 'Staff-Temp-Pass-1';

describe('Staff persistence (real database)', () => {
  let prisma: PrismaClient;
  let moduleRef: TestingModule;
  let staff: StaffService;
  let branchesService: BranchesService;
  let repo: StaffRepository;

  beforeAll(async () => {
    prisma = createTestPrisma();
    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    await moduleRef.init();
    staff = moduleRef.get(StaffService);
    branchesService = moduleRef.get(BranchesService);
    repo = moduleRef.get(STAFF_REPOSITORY);
  });

  afterAll(async () => {
    await moduleRef.close();
    await prisma.$disconnect();
  });

  beforeEach(() => resetDatabase(prisma));

  /** A school with an ACTIVE subscription allowing `maxStaff` users. */
  async function school(maxStaff: number | null = 10) {
    const admin = await createPlatformAdmin(prisma);
    const tenant = await createTenant(prisma, admin.id);
    const plan = await createPricePlan(prisma, admin.id);
    const price = await createPlanPrice(prisma, plan.id);
    await createSubscription(prisma, {
      tenantId: tenant.id,
      planId: plan.id,
      planPriceId: price.id,
      createdById: admin.id,
    });
    await prisma.planLimit.create({
      data: {
        planId: plan.id,
        code: PlanLimitCode.MAX_STAFF_USERS,
        value: maxStaff,
      },
    });
    const main = await mainBranchOf(prisma, tenant.id);
    const owner = await createTenantUser(prisma, {
      tenantId: tenant.id,
      role: TenantRole.OWNER,
      createdByPlatformAdminId: admin.id,
    });
    return { admin, tenant, main, owner };
  }

  function actorOf(user: {
    id: string;
    tenantId: string;
    role: TenantRole;
    branchAccess: TenantUserBranchAccess;
    defaultBranchId: string;
  }): AuthenticatedTenantUser {
    return {
      id: user.id,
      tenantId: user.tenantId,
      email: 'x@school.lk',
      fullName: 'X',
      role: user.role,
      sessionId: crypto.randomUUID(),
      mustChangePassword: false,
      branchAccess: user.branchAccess,
      defaultBranchId: user.defaultBranchId,
    };
  }

  const newStaff = (
    branchId: string,
    overrides: Partial<Parameters<StaffService['create']>[1]> = {},
  ) => ({
    fullName: 'Kamal Silva',
    email: `${crypto.randomUUID().slice(0, 8)}@school.lk`,
    role: TenantRole.FRONT_DESK,
    branchAccess: TenantUserBranchAccess.SELECTED,
    branchIds: [branchId],
    defaultBranchId: branchId,
    temporaryPassword: PASSWORD,
    ...overrides,
  });

  it('never exceeds MAX_STAFF_USERS (owner included) under concurrent creates', async () => {
    const { tenant, main, owner } = await school(3);
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        staff.create(actorOf(owner), newStaff(main.id), META),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    const rejected = results.find((r) => r.status === 'rejected');
    expect((rejected as PromiseRejectedResult).reason).toMatchObject({
      code: 'PLAN_LIMIT_REACHED',
    });
    expect(await repo.countActive(tenant.id)).toBe(3);
  });

  it('frees a seat on disable and checks it again on enable', async () => {
    const { tenant, main, owner } = await school(2);
    const first = await staff.create(actorOf(owner), newStaff(main.id), META);
    await expect(
      staff.create(actorOf(owner), newStaff(main.id), META),
    ).rejects.toMatchObject({ code: 'PLAN_LIMIT_REACHED' });

    await staff.disable(actorOf(owner), first.member.id, META);
    const second = await staff.create(actorOf(owner), newStaff(main.id), META);
    await expect(
      staff.enable(actorOf(owner), first.member.id, META),
    ).rejects.toMatchObject({ code: 'PLAN_LIMIT_REACHED' });

    await staff.disable(actorOf(owner), second.member.id, META);
    await staff.enable(actorOf(owner), first.member.id, META);
    expect(await repo.countActive(tenant.id)).toBe(2);
  });

  it('maps duplicate email and NIC within a school, but allows them across schools', async () => {
    const a = await school();
    const b = await school();
    await staff.create(
      actorOf(a.owner),
      newStaff(a.main.id, { email: 'kamal@school.lk', nic: '199112345678' }),
      META,
    );
    await expect(
      staff.create(
        actorOf(a.owner),
        newStaff(a.main.id, { email: ' Kamal@School.lk ' }),
        META,
      ),
    ).rejects.toMatchObject({ code: 'TENANT_USER_EMAIL_TAKEN' });
    await expect(
      staff.create(
        actorOf(a.owner),
        newStaff(a.main.id, { nic: '199112345678' }),
        META,
      ),
    ).rejects.toMatchObject({ code: 'TENANT_USER_NIC_TAKEN' });
    await staff.create(
      actorOf(b.owner),
      newStaff(b.main.id, { email: 'kamal@school.lk', nic: '199112345678' }),
      META,
    );
  });

  it("rejects another school's branches and users", async () => {
    const a = await school();
    const b = await school();
    await expect(
      staff.create(actorOf(a.owner), newStaff(b.main.id), META),
    ).rejects.toMatchObject({ code: 'BRANCH_SELECTION_INVALID' });

    const theirs = await staff.create(
      actorOf(b.owner),
      newStaff(b.main.id),
      META,
    );
    await expect(
      staff.get(actorOf(a.owner), theirs.member.id),
    ).rejects.toMatchObject({ code: 'STAFF_NOT_FOUND' });
    await expect(
      staff.disable(actorOf(a.owner), theirs.member.id, META),
    ).rejects.toMatchObject({ code: 'STAFF_NOT_FOUND' });
  });

  it('never modifies the owner through the staff repository', async () => {
    const { tenant, owner } = await school();
    await expect(
      repo.setStatus(
        tenant.id,
        owner.id,
        TenantUserStatus.DISABLED,
        new Date(),
      ),
    ).rejects.toThrow();
    await expect(
      repo.setRole(tenant.id, owner.id, TenantRole.ADMIN),
    ).rejects.toThrow();
    expect(
      await prisma.tenantUser.findUniqueOrThrow({ where: { id: owner.id } }),
    ).toMatchObject({
      role: TenantRole.OWNER,
      status: TenantUserStatus.ACTIVE,
    });
  });

  it('keeps assignments to closed branches when replacing access, so reopening restores them', async () => {
    const { tenant, main, owner } = await school();
    const kandy = await createBranch(prisma, { tenantId: tenant.id });
    const galle = await createBranch(prisma, { tenantId: tenant.id });
    const clerk = await staff.create(
      actorOf(owner),
      newStaff(main.id, { branchIds: [main.id, kandy.id] }),
      META,
    );
    await branchesService.close(actorOf(owner), kandy.id, META);

    const updated = await staff.setAccess(
      actorOf(owner),
      clerk.member.id,
      {
        branchAccess: TenantUserBranchAccess.SELECTED,
        branchIds: [galle.id],
        defaultBranchId: galle.id,
      },
      META,
    );
    expect(updated.member.branches.map((b) => [b.id, b.status]).sort()).toEqual(
      [
        [kandy.id, BranchStatus.CLOSED],
        [galle.id, BranchStatus.ACTIVE],
      ].sort(),
    );

    // Switching to ALL drops every assignment.
    const all = await staff.setAccess(
      actorOf(owner),
      clerk.member.id,
      {
        branchAccess: TenantUserBranchAccess.ALL,
        defaultBranchId: main.id,
      },
      META,
    );
    expect(all.member.branches).toEqual([]);
    expect(
      await prisma.tenantUserBranch.count({
        where: { userId: clerk.member.id },
      }),
    ).toBe(0);
  });

  it('keeps branch changes and branch closes consistent under the tenant lock', async () => {
    const { tenant, main, owner } = await school();
    const kandy = await createBranch(prisma, { tenantId: tenant.id });
    const clerk = await staff.create(actorOf(owner), newStaff(kandy.id), META);

    // Move the clerk to Main while Kandy closes: either order must leave the
    // clerk consistent (Main assigned → still has an open branch).
    await Promise.all([
      staff.setAccess(
        actorOf(owner),
        clerk.member.id,
        {
          branchAccess: TenantUserBranchAccess.SELECTED,
          branchIds: [main.id],
          defaultBranchId: main.id,
        },
        META,
      ),
      branchesService.close(actorOf(owner), kandy.id, META),
    ]);

    const row = await prisma.tenantUser.findUniqueOrThrow({
      where: { id: clerk.member.id },
      include: { branchAssignments: { include: { branch: true } } },
    });
    expect(row.defaultBranchId).toBe(main.id);
    expect(
      row.branchAssignments.some(
        (a) => a.branchId === main.id && a.branch.status === 'ACTIVE',
      ),
    ).toBe(true);
  });
});
