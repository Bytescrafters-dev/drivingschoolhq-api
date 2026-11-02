import { Test, type TestingModule } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import {
  BranchStatus,
  District,
  PlanLimitCode,
  TenantRole,
  TenantUserBranchAccess,
} from '../../src/generated/prisma/enums.js';
import type { AuthenticatedTenantUser } from '../../src/tenant/auth/interfaces/authenticated-tenant-user.js';
import { BranchesService } from '../../src/tenant/branches/branches.service.js';
import {
  BRANCH_REPOSITORY,
  type BranchRepository,
} from '../../src/tenant/branches/interfaces/branch.repository.js';
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

const DETAILS = {
  address: '1 Main Street',
  district: District.KANDY,
  phone: '0812223333',
};

describe('Branch persistence (real database)', () => {
  let prisma: PrismaClient;
  let moduleRef: TestingModule;
  let service: BranchesService;
  let repo: BranchRepository;

  beforeAll(async () => {
    prisma = createTestPrisma();
    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    await moduleRef.init();
    service = moduleRef.get(BranchesService);
    repo = moduleRef.get(BRANCH_REPOSITORY);
  });

  afterAll(async () => {
    await moduleRef.close();
    await prisma.$disconnect();
  });

  beforeEach(() => resetDatabase(prisma));

  /** A school with an ACTIVE subscription to a plan with the given branch limit. */
  async function school(maxBranches: number | null = 5) {
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
        code: PlanLimitCode.MAX_BRANCHES,
        value: maxBranches,
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

  it("rejects assignments and defaults that point at another tenant's branch", async () => {
    const a = await school();
    const b = await school();

    await expect(
      prisma.tenantUserBranch.create({
        data: {
          tenantId: a.tenant.id,
          userId: a.owner.id,
          branchId: b.main.id,
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.tenantUserBranch.create({
        data: {
          tenantId: b.tenant.id,
          userId: a.owner.id,
          branchId: b.main.id,
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.tenantUser.update({
        where: { id: a.owner.id },
        data: { defaultBranchId: b.main.id },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.tenantAuditLog.create({
        data: { tenantId: a.tenant.id, action: 'X', branchId: b.main.id },
      }),
    ).rejects.toThrow();
  });

  it('keeps the owner on ALL branches and branch names unique ignoring case', async () => {
    const { tenant, owner } = await school();
    await expect(
      prisma.tenantUser.update({
        where: { id: owner.id },
        data: { branchAccess: TenantUserBranchAccess.SELECTED },
      }),
    ).rejects.toThrow(/tenant_users_owner_all_branches_chk/);

    await expect(
      service.create(actorOf(owner), { ...DETAILS, name: 'MAIN BRANCH' }, META),
    ).rejects.toMatchObject({ code: 'BRANCH_NAME_TAKEN' });
    // Other schools may reuse the name.
    const other = await school();
    await service.create(
      actorOf(other.owner),
      { ...DETAILS, name: 'Kandy' },
      META,
    );
    await service.create(actorOf(owner), { ...DETAILS, name: 'Kandy' }, META);
    expect(await repo.countActive(tenant.id)).toBe(2);
  });

  it('never exceeds MAX_BRANCHES under concurrent creates', async () => {
    const { tenant, owner } = await school(3);
    const results = await Promise.allSettled(
      ['A', 'B', 'C', 'D', 'E'].map((name) =>
        service.create(actorOf(owner), { ...DETAILS, name }, META),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    expect(await repo.countActive(tenant.id)).toBe(3);
  });

  it('never closes the last active branch under concurrent closes', async () => {
    const { tenant, main, owner } = await school();
    const kandy = await createBranch(prisma, { tenantId: tenant.id });
    const results = await Promise.allSettled([
      service.close(actorOf(owner), main.id, META),
      service.close(actorOf(owner), kandy.id, META),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await repo.countActive(tenant.id)).toBe(1);
  });

  it('locks out staff whose last open branch closes and moves defaults', async () => {
    const { admin, tenant, main, owner } = await school();
    const kandy = await createBranch(prisma, { tenantId: tenant.id });
    const galle = await createBranch(prisma, { tenantId: tenant.id });
    const make = (args: {
      branchAccess: TenantUserBranchAccess;
      defaultBranchId: string;
    }) =>
      createTenantUser(prisma, {
        tenantId: tenant.id,
        role: TenantRole.FRONT_DESK,
        createdByPlatformAdminId: admin.id,
        ...args,
      });

    // Only Kandy → loses access when Kandy closes.
    const onlyKandy = await make({
      branchAccess: TenantUserBranchAccess.SELECTED,
      defaultBranchId: kandy.id,
    });
    expect(
      (await repo.findExclusiveUsers(tenant.id, kandy.id)).map((u) => u.id),
    ).toEqual([onlyKandy.id]);
    const session = await prisma.tenantUserSession.create({
      data: {
        tenantId: tenant.id,
        userId: onlyKandy.id,
        refreshTokenHash: crypto.randomUUID(),
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });

    // Kandy + Galle (SELECTED) → moves to Galle; ALL → moves to the oldest
    // other active branch (Main).
    const kandyAndGalle = await make({
      branchAccess: TenantUserBranchAccess.SELECTED,
      defaultBranchId: kandy.id,
    });
    await prisma.tenantUserBranch.create({
      data: {
        tenantId: tenant.id,
        userId: kandyAndGalle.id,
        branchId: galle.id,
      },
    });
    const all = await make({
      branchAccess: TenantUserBranchAccess.ALL,
      defaultBranchId: kandy.id,
    });

    const { lockedOutStaff } = await service.close(
      actorOf(owner),
      kandy.id,
      META,
    );
    expect(lockedOutStaff.map((u) => u.id)).toEqual([onlyKandy.id]);
    expect(
      await prisma.tenantUserSession.findUniqueOrThrow({
        where: { id: session.id },
      }),
    ).toMatchObject({ revokedReason: 'NO_ACTIVE_BRANCH' });

    const defaultOf = async (id: string) =>
      (await prisma.tenantUser.findUniqueOrThrow({ where: { id } }))
        .defaultBranchId;
    expect(await defaultOf(kandyAndGalle.id)).toBe(galle.id);
    expect(await defaultOf(all.id)).toBe(main.id);
    // No other accessible branch: the locked-out user keeps the closed default.
    expect(await defaultOf(onlyKandy.id)).toBe(kandy.id);
    expect(
      (await prisma.branch.findUniqueOrThrow({ where: { id: kandy.id } }))
        .status,
    ).toBe(BranchStatus.CLOSED);
    const audit = await prisma.tenantAuditLog.findFirstOrThrow({
      where: { action: 'BRANCH_CLOSED' },
    });
    expect(audit).toMatchObject({
      branchId: kandy.id,
      metadata: { reassignedDefaults: 2, lockedOutUserIds: [onlyKandy.id] },
    });
  });
});
