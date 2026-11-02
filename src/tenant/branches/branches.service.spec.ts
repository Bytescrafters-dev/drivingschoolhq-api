import {
  BranchStatus,
  District,
  TenantRole,
  TenantUserBranchAccess,
  TenantUserStatus,
} from '../../generated/prisma/enums.js';
import { TenantEntitlementsService } from '../../platform/entitlements/tenant-entitlements.service.js';
import { InMemoryBranchRepository } from '../../../test/support/branch-fakes.js';
import {
  FixedClock,
  META,
  expectAppError,
  passthroughTx,
} from '../../../test/support/fakes.js';
import {
  FakeTenantAuditRepository,
  InMemoryTenantContextRepository,
} from '../../../test/support/tenant-auth-fakes.js';
import {
  FakeTenantSessionsService,
  InMemoryTenantUserRepository,
} from '../../../test/support/tenancy-fakes.js';
import { TenantAuditService } from '../audit/tenant-audit.service.js';
import type { AuthenticatedTenantUser } from '../auth/interfaces/authenticated-tenant-user.js';
import { BranchAccessService } from './branch-access.service.js';
import { BranchesService } from './branches.service.js';

const DETAILS = {
  name: 'Kandy',
  address: ' 5 Peradeniya Road ',
  district: District.KANDY,
  phone: '081 222 3333',
};

function setup(options: { maxBranches?: number | null } = {}) {
  const tenants = new InMemoryTenantContextRepository();
  const users = new InMemoryTenantUserRepository();
  const branches = new InMemoryBranchRepository(users);
  const auditRepo = new FakeTenantAuditRepository();
  // `null` means unlimited, so only an omitted option falls back to 3.
  const limits: { maxBranches: number | null } = {
    maxBranches: options.maxBranches === undefined ? 3 : options.maxBranches,
  };
  const entitlements = new TenantEntitlementsService({
    findActiveLimit: () => Promise.resolve(limits.maxBranches),
  });
  const clock = new FixedClock();
  const sessions = new FakeTenantSessionsService();
  const service = new BranchesService(
    branches,
    tenants,
    new BranchAccessService(branches),
    entitlements,
    new TenantAuditService(auditRepo),
    passthroughTx,
    clock,
    sessions.asService(),
  );
  const tenant = tenants.seed();
  const main = branches.seed({ tenantId: tenant.id, name: 'Main Branch' });

  function user(
    overrides: {
      role?: TenantRole;
      branchAccess?: TenantUserBranchAccess;
      branchIds?: string[];
      status?: TenantUserStatus;
      tenantId?: string;
    } = {},
  ) {
    const tenantId = overrides.tenantId ?? tenant.id;
    const branchIds = overrides.branchIds ?? [main.id];
    const row = users.seedUser({
      tenantId,
      role: overrides.role ?? TenantRole.ADMIN,
      branchAccess: overrides.branchAccess ?? TenantUserBranchAccess.ALL,
      defaultBranchId: branchIds[0]!,
      status: overrides.status ?? TenantUserStatus.ACTIVE,
    });
    if (row.branchAccess === TenantUserBranchAccess.SELECTED) {
      branches.assign(tenantId, row.id, ...branchIds);
    }
    return row;
  }

  function actor(row: ReturnType<typeof user>): AuthenticatedTenantUser {
    return {
      id: row.id,
      tenantId: row.tenantId,
      email: row.email,
      fullName: row.fullName,
      role: row.role,
      sessionId: crypto.randomUUID(),
      mustChangePassword: false,
      branchAccess: row.branchAccess,
      defaultBranchId: row.defaultBranchId,
    };
  }

  const owner = user({ role: TenantRole.OWNER });
  return {
    service,
    tenants,
    users,
    branches,
    auditRepo,
    sessions,
    limits,
    clock,
    tenant,
    main,
    owner,
    user,
    actor,
  };
}

describe('BranchesService', () => {
  describe('create', () => {
    it('creates a normalised branch and audits it', async () => {
      const { service, owner, actor, auditRepo, tenant } = setup();

      const branch = await service.create(actor(owner), DETAILS, META);

      expect(branch).toMatchObject({
        tenantId: tenant.id,
        name: 'Kandy',
        address: '5 Peradeniya Road',
        district: District.KANDY,
        phone: '+94812223333',
        status: BranchStatus.ACTIVE,
      });
      expect(auditRepo.entries[0]).toMatchObject({
        tenantId: tenant.id,
        actorTenantUserId: owner.id,
        action: 'BRANCH_CREATED',
        targetType: 'BRANCH',
        targetId: branch.id,
        branchId: branch.id,
      });
    });

    it('stops at the plan limit, counting the Main Branch', async () => {
      const { service, owner, actor } = setup({ maxBranches: 2 });
      await service.create(actor(owner), DETAILS, META);
      await expectAppError(
        service.create(actor(owner), { ...DETAILS, name: 'Galle' }, META),
        'PLAN_LIMIT_REACHED',
      );
    });

    it('does not count closed branches and allows unlimited plans', async () => {
      const { service, owner, actor, branches, tenant } = setup({
        maxBranches: 1,
      });
      branches.seed({
        tenantId: tenant.id,
        status: BranchStatus.CLOSED,
        closedAt: new Date(),
      });
      await expectAppError(
        service.create(actor(owner), DETAILS, META),
        'PLAN_LIMIT_REACHED',
      );

      const unlimited = setup({ maxBranches: null });
      for (const name of ['A', 'B', 'C', 'D']) {
        await unlimited.service.create(
          unlimited.actor(unlimited.owner),
          { ...DETAILS, name },
          META,
        );
      }
      expect(await unlimited.branches.countActive(unlimited.tenant.id)).toBe(5);
    });

    it('assigns a SELECTED admin to the branch they create', async () => {
      const { service, user, actor, branches, main } = setup();
      const admin = user({
        branchAccess: TenantUserBranchAccess.SELECTED,
        branchIds: [main.id],
      });

      const branch = await service.create(actor(admin), DETAILS, META);

      const mine = await service.list(actor(admin), false);
      expect(mine.map((item) => item.branch.id)).toEqual([main.id, branch.id]);
      expect(
        branches.assignments.filter((a) => a.userId === admin.id),
      ).toHaveLength(2);
    });

    it('rejects a duplicate name regardless of case', async () => {
      const { service, owner, actor } = setup();
      await expectAppError(
        service.create(actor(owner), { ...DETAILS, name: 'main branch' }, META),
        'BRANCH_NAME_TAKEN',
      );
    });
  });

  describe('visibility', () => {
    it('shows SELECTED users only their branches and hides other tenants', async () => {
      const { service, user, actor, branches, tenant, tenants, main } = setup();
      const kandy = branches.seed({ tenantId: tenant.id, name: 'Kandy' });
      const other = tenants.seed();
      const foreign = branches.seed({ tenantId: other.id, name: 'Foreign' });
      const clerk = user({
        role: TenantRole.FRONT_DESK,
        branchAccess: TenantUserBranchAccess.SELECTED,
        branchIds: [kandy.id],
      });

      expect(
        (await service.list(actor(clerk), true)).map((i) => i.branch.id),
      ).toEqual([kandy.id]);
      await expectAppError(
        service.get(actor(clerk), main.id),
        'BRANCH_NOT_FOUND',
      );
      const owner = setup().owner;
      await expectAppError(
        service.get(actor({ ...owner, tenantId: tenant.id }), foreign.id),
        'BRANCH_NOT_FOUND',
      );
    });

    it('marks the default branch in the list', async () => {
      const { service, owner, actor, branches, tenant, main } = setup();
      branches.seed({ tenantId: tenant.id, name: 'Kandy' });
      const items = await service.list(actor(owner), false);
      expect(items.find((i) => i.isDefault)?.branch.id).toBe(main.id);
    });
  });

  describe('update', () => {
    it('updates only changed fields and audits the diff', async () => {
      const { service, owner, actor, auditRepo, main } = setup();
      const updated = await service.update(
        actor(owner),
        main.id,
        { name: 'Colombo HQ', district: main.district },
        META,
      );
      expect(updated.name).toBe('Colombo HQ');
      expect(auditRepo.entries[0]!.metadata).toEqual({
        name: { from: 'Main Branch', to: 'Colombo HQ' },
      });
    });

    it('refuses to edit a closed branch or one without access', async () => {
      const { service, user, actor, branches, tenant } = setup();
      const closed = branches.seed({
        tenantId: tenant.id,
        status: BranchStatus.CLOSED,
        closedAt: new Date(),
      });
      const owner = user({ role: TenantRole.OWNER });
      await expectAppError(
        service.update(actor(owner), closed.id, { name: 'X' }, META),
        'BRANCH_CLOSED',
      );
      const kandy = branches.seed({ tenantId: tenant.id, name: 'Kandy' });
      const admin = user({
        branchAccess: TenantUserBranchAccess.SELECTED,
        branchIds: [kandy.id],
      });
      await expectAppError(
        service.update(actor(admin), closed.id, { name: 'X' }, META),
        'BRANCH_NOT_FOUND',
      );
    });
  });

  describe('close and reopen', () => {
    it('never closes the last active branch', async () => {
      const { service, owner, actor, main } = setup();
      await expectAppError(
        service.close(actor(owner), main.id, META),
        'LAST_ACTIVE_BRANCH',
      );
    });

    it('locks out active staff for whom it was the only active branch', async () => {
      const { service, owner, user, actor, branches, tenant, sessions, main } =
        setup();
      const kandy = branches.seed({ tenantId: tenant.id, name: 'Kandy' });
      const onlyKandy = user({
        role: TenantRole.FRONT_DESK,
        branchAccess: TenantUserBranchAccess.SELECTED,
        branchIds: [kandy.id],
      });
      // Disabled staff and staff with another active branch are not affected.
      user({
        role: TenantRole.FRONT_DESK,
        branchAccess: TenantUserBranchAccess.SELECTED,
        branchIds: [kandy.id],
        status: TenantUserStatus.DISABLED,
      });
      user({
        role: TenantRole.FRONT_DESK,
        branchAccess: TenantUserBranchAccess.SELECTED,
        branchIds: [kandy.id, main.id],
      });

      const { branch, lockedOutStaff } = await service.close(
        actor(owner),
        kandy.id,
        META,
      );

      expect(branch.status).toBe(BranchStatus.CLOSED);
      expect(lockedOutStaff.map((u) => u.id)).toEqual([onlyKandy.id]);
      expect(sessions.revocations).toEqual([
        {
          tenantId: tenant.id,
          userId: onlyKandy.id,
          reason: 'NO_ACTIVE_BRANCH',
        },
      ]);
    });

    it('closes, moves defaults to another accessible branch, and audits', async () => {
      const { service, owner, user, actor, branches, users, tenant, main } =
        setup();
      const kandy = branches.seed({ tenantId: tenant.id, name: 'Kandy' });
      const galle = branches.seed({ tenantId: tenant.id, name: 'Galle' });
      const allAccess = user({ branchIds: [kandy.id] });
      const selected = user({
        role: TenantRole.FRONT_DESK,
        branchAccess: TenantUserBranchAccess.SELECTED,
        branchIds: [kandy.id, galle.id],
      });

      const { branch: closed, lockedOutStaff } = await service.close(
        actor(owner),
        kandy.id,
        META,
      );

      expect(closed).toMatchObject({ status: BranchStatus.CLOSED });
      expect(closed.closedAt).not.toBeNull();
      expect(lockedOutStaff).toEqual([]);
      const row = (id: string) => users.rows.find((u) => u.id === id)!;
      expect(row(allAccess.id).defaultBranchId).toBe(main.id);
      expect(row(selected.id).defaultBranchId).toBe(galle.id);
    });

    it('lets an admin close only branches they can access', async () => {
      const { service, user, actor, branches, tenant, main } = setup();
      const kandy = branches.seed({ tenantId: tenant.id, name: 'Kandy' });
      const admin = user({
        branchAccess: TenantUserBranchAccess.SELECTED,
        branchIds: [main.id],
      });
      await expectAppError(
        service.close(actor(admin), kandy.id, META),
        'BRANCH_NOT_FOUND',
      );
    });

    it('reopens within the plan limit only', async () => {
      const { service, owner, actor, branches, tenant, limits } = setup();
      const kandy = branches.seed({ tenantId: tenant.id, name: 'Kandy' });
      await service.close(actor(owner), kandy.id, META);
      await expectAppError(
        service.close(actor(owner), kandy.id, META),
        'BRANCH_ALREADY_CLOSED',
      );

      limits.maxBranches = 1;
      await expectAppError(
        service.reopen(actor(owner), kandy.id, META),
        'PLAN_LIMIT_REACHED',
      );
      limits.maxBranches = 2;
      const reopened = await service.reopen(actor(owner), kandy.id, META);
      expect(reopened).toMatchObject({
        status: BranchStatus.ACTIVE,
        closedAt: null,
      });
      await expectAppError(
        service.reopen(actor(owner), kandy.id, META),
        'BRANCH_NOT_CLOSED',
      );
    });
  });

  describe('setMyDefault', () => {
    it('changes the default to an accessible active branch and audits it', async () => {
      const { service, owner, actor, branches, users, auditRepo, tenant } =
        setup();
      const kandy = branches.seed({ tenantId: tenant.id, name: 'Kandy' });

      await service.setMyDefault(actor(owner), kandy.id, META);

      expect(users.rows.find((u) => u.id === owner.id)!.defaultBranchId).toBe(
        kandy.id,
      );
      expect(auditRepo.entries[0]).toMatchObject({
        action: 'DEFAULT_BRANCH_CHANGED',
        branchId: kandy.id,
      });
    });

    it('rejects closed and inaccessible branches', async () => {
      const { service, user, actor, branches, tenant, main } = setup();
      const closed = branches.seed({
        tenantId: tenant.id,
        status: BranchStatus.CLOSED,
        closedAt: new Date(),
      });
      const owner = user({ role: TenantRole.OWNER });
      await expectAppError(
        service.setMyDefault(actor(owner), closed.id, META),
        'BRANCH_CLOSED',
      );
      const kandy = branches.seed({ tenantId: tenant.id, name: 'Kandy' });
      const clerk = user({
        role: TenantRole.FRONT_DESK,
        branchAccess: TenantUserBranchAccess.SELECTED,
        branchIds: [main.id],
      });
      await expectAppError(
        service.setMyDefault(actor(clerk), kandy.id, META),
        'BRANCH_NOT_FOUND',
      );
    });
  });
});
