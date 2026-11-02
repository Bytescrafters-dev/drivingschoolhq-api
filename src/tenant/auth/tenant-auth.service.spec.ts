import {
  BranchStatus,
  TenantAccessStatus,
  TenantRole,
  TenantStatus,
  TenantUserBranchAccess,
  TenantUserStatus,
} from '../../generated/prisma/enums.js';
import { META, expectAppError } from '../../../test/support/fakes.js';
import { tenantAuthSetup } from '../../../test/support/tenant-auth-fakes.js';
import { TenantAuditAction } from '../audit/common/tenant-audit-action.js';
import type { AuthenticatedTenantUser } from './interfaces/authenticated-tenant-user.js';

const PASSWORD = 'Owner-Temp-Pass-1';

function withUser(
  overrides: {
    tenantStatus?: TenantStatus;
    accessStatus?: TenantAccessStatus;
    userStatus?: TenantUserStatus;
    mustChangePassword?: boolean;
  } = {},
) {
  const ctx = tenantAuthSetup();
  const tenant = ctx.tenants.seed({
    dsCode: 'DS1',
    status: overrides.tenantStatus ?? TenantStatus.ACTIVE,
    accessStatus: overrides.accessStatus ?? TenantAccessStatus.ACTIVE,
  });
  const mainBranch = ctx.branches.seed({
    tenantId: tenant.id,
    name: 'Main Branch',
  });
  const user = ctx.users.seedUser({
    tenantId: tenant.id,
    role: TenantRole.OWNER,
    branchAccess: TenantUserBranchAccess.ALL,
    defaultBranchId: mainBranch.id,
    email: 'owner@school.lk',
    status: overrides.userStatus ?? TenantUserStatus.ACTIVE,
    mustChangePassword: overrides.mustChangePassword ?? true,
    passwordHash: `hashed:${PASSWORD}`,
  });
  return { ...ctx, tenant, user, mainBranch };
}

function actorOf(
  user: {
    id: string;
    tenantId: string;
    email: string;
    role?: TenantRole;
    branchAccess: TenantUserBranchAccess;
    defaultBranchId: string;
  },
  sessionId: string,
): AuthenticatedTenantUser {
  return {
    id: user.id,
    tenantId: user.tenantId,
    email: user.email,
    fullName: 'Owner',
    role: user.role ?? TenantRole.OWNER,
    sessionId,
    mustChangePassword: false,
    branchAccess: user.branchAccess,
    defaultBranchId: user.defaultBranchId,
  };
}

describe('TenantAuthService', () => {
  describe('login', () => {
    it('opens a session for the user of the school identified by DS code', async () => {
      const { service, sessions, users, user, tokens, auditRepo, clock } =
        withUser();

      const result = await service.login(
        ' ds1 ',
        ' Owner@School.LK ',
        PASSWORD,
        META,
      );

      expect(result).toMatchObject({
        tokenType: 'Bearer',
        accessTokenExpiresIn: 900,
        mustChangePassword: true,
      });
      const claims = await tokens.verifyAccessToken(result.accessToken);
      expect(claims).toMatchObject({
        userId: user.id,
        tenantId: user.tenantId,
      });
      expect(sessions.activeFor(user.id)).toHaveLength(1);
      expect(users.rows[0]!.lastLoginAt).toEqual(clock.now());
      expect(auditRepo.entries).toEqual([
        expect.objectContaining({
          tenantId: user.tenantId,
          actorTenantUserId: user.id,
          action: TenantAuditAction.LOGIN_SUCCEEDED,
        }),
      ]);
    });

    it('lets users of a suspended school sign in', async () => {
      const { service } = withUser({
        accessStatus: TenantAccessStatus.SUSPENDED,
      });
      await expect(
        service.login('DS1', 'owner@school.lk', PASSWORD, META),
      ).resolves.toMatchObject({ tokenType: 'Bearer' });
    });

    it('burns hash time and writes no tenant audit for an unknown DS code', async () => {
      const { service, hasher, auditRepo } = withUser();
      await expectAppError(
        service.login('DS404', 'owner@school.lk', PASSWORD, META),
        'INVALID_CREDENTIALS',
      );
      expect(hasher.dummyVerifications).toBe(1);
      expect(auditRepo.entries).toHaveLength(0);
    });

    it('burns hash time and audits an unknown email', async () => {
      const { service, hasher, auditRepo, tenant } = withUser();
      await expectAppError(
        service.login('DS1', 'nobody@school.lk', PASSWORD, META),
        'INVALID_CREDENTIALS',
      );
      expect(hasher.dummyVerifications).toBe(1);
      expect(auditRepo.entries[0]).toMatchObject({
        tenantId: tenant.id,
        actorTenantUserId: null,
        action: TenantAuditAction.LOGIN_FAILED,
        metadata: { email: 'nobody@school.lk', reason: 'UNKNOWN_EMAIL' },
      });
    });

    it('does not find a user through another school', async () => {
      const { service, tenants } = withUser();
      tenants.seed({ dsCode: 'DS2' });
      await expectAppError(
        service.login('DS2', 'owner@school.lk', PASSWORD, META),
        'INVALID_CREDENTIALS',
      );
    });

    it.each([
      ['a wrong password', {}, 'wrong-password', 'INVALID_PASSWORD'],
      [
        'a disabled user',
        { userStatus: TenantUserStatus.DISABLED },
        PASSWORD,
        'USER_DISABLED',
      ],
    ])(
      'rejects %s with the generic error',
      async (_label, overrides, password, reason) => {
        const { service, auditRepo, sessions } = withUser(overrides);
        await expectAppError(
          service.login('DS1', 'owner@school.lk', password, META),
          'INVALID_CREDENTIALS',
        );
        expect(auditRepo.entries[0]!.metadata).toMatchObject({ reason });
        expect(sessions.rows).toHaveLength(0);
      },
    );

    it('reveals a closed school only after the password is verified', async () => {
      const closed = withUser({ tenantStatus: TenantStatus.CLOSED });
      await expectAppError(
        closed.service.login('DS1', 'owner@school.lk', 'wrong', META),
        'INVALID_CREDENTIALS',
      );
      await expectAppError(
        closed.service.login('DS1', 'owner@school.lk', PASSWORD, META),
        'TENANT_CLOSED',
      );
      expect(closed.sessions.rows).toHaveLength(0);
    });

    it('refuses SELECTED staff none of whose branches is open, after the password check', async () => {
      const { service, users, branches, tenant, auditRepo, sessions } =
        withUser();
      const kandy = branches.seed({
        tenantId: tenant.id,
        name: 'Kandy',
        status: BranchStatus.CLOSED,
        closedAt: new Date(),
      });
      const clerk = users.seedUser({
        tenantId: tenant.id,
        email: 'clerk@school.lk',
        role: TenantRole.FRONT_DESK,
        branchAccess: TenantUserBranchAccess.SELECTED,
        defaultBranchId: kandy.id,
        passwordHash: `hashed:${PASSWORD}`,
      });
      branches.assign(tenant.id, clerk.id, kandy.id);

      await expectAppError(
        service.login('DS1', 'clerk@school.lk', 'wrong', META),
        'INVALID_CREDENTIALS',
      );
      await expectAppError(
        service.login('DS1', 'clerk@school.lk', PASSWORD, META),
        'NO_ACTIVE_BRANCH',
      );
      expect(sessions.rows).toHaveLength(0);
      expect(auditRepo.entries.at(-1)).toMatchObject({
        action: TenantAuditAction.LOGIN_FAILED,
        metadata: { reason: 'NO_ACTIVE_BRANCH' },
      });

      // Reopening the branch lets them in again.
      await branches.setStatus(tenant.id, kandy.id, BranchStatus.ACTIVE, null);
      await service.login('DS1', 'clerk@school.lk', PASSWORD, META);
    });

    it('never writes the password to the audit log', async () => {
      const { service, auditRepo } = withUser();
      await service
        .login('DS1', 'owner@school.lk', 'Secret-Wrong-1', META)
        .catch(() => undefined);
      await service.login('DS1', 'owner@school.lk', PASSWORD, META);
      const serialized = JSON.stringify(auditRepo.entries);
      expect(serialized).not.toContain(PASSWORD);
      expect(serialized).not.toContain('Secret-Wrong-1');
    });
  });

  describe('refresh', () => {
    it('rotates the refresh token', async () => {
      const { service, sessions, user } = withUser();
      const first = await service.login(
        'DS1',
        'owner@school.lk',
        PASSWORD,
        META,
      );

      const second = await service.refresh(first.refreshToken, META);

      expect(second.refreshToken).not.toBe(first.refreshToken);
      expect(sessions.activeFor(user.id)).toHaveLength(1);
      await expectAppError(
        service.refresh(first.refreshToken, META),
        'INVALID_REFRESH_TOKEN',
      );
    });

    it('revokes every session of the user when a rotated token is reused', async () => {
      const { service, sessions, user, auditRepo } = withUser();
      const first = await service.login(
        'DS1',
        'owner@school.lk',
        PASSWORD,
        META,
      );
      await service.refresh(first.refreshToken, META);

      await expectAppError(
        service.refresh(first.refreshToken, META),
        'INVALID_REFRESH_TOKEN',
      );
      expect(sessions.activeFor(user.id)).toHaveLength(0);
      expect(auditRepo.actions()).toContain(
        TenantAuditAction.REFRESH_TOKEN_REUSE_DETECTED,
      );
    });

    it('refuses to refresh once the school is closed or the user disabled', async () => {
      const { service, tenants, users, tenant } = withUser();
      const a = await service.login('DS1', 'owner@school.lk', PASSWORD, META);
      const b = await service.login('DS1', 'owner@school.lk', PASSWORD, META);

      tenants.rows.find((t) => t.id === tenant.id)!.status =
        TenantStatus.CLOSED;
      await expectAppError(
        service.refresh(a.refreshToken, META),
        'INVALID_REFRESH_TOKEN',
      );

      tenants.rows.find((t) => t.id === tenant.id)!.status =
        TenantStatus.ACTIVE;
      users.rows[0]!.status = TenantUserStatus.DISABLED;
      await expectAppError(
        service.refresh(b.refreshToken, META),
        'INVALID_REFRESH_TOKEN',
      );
    });

    it('refuses to refresh once none of a SELECTED user’s branches is open', async () => {
      const { service, users, branches, tenant, mainBranch } = withUser();
      const clerk = users.seedUser({
        tenantId: tenant.id,
        email: 'clerk@school.lk',
        role: TenantRole.FRONT_DESK,
        branchAccess: TenantUserBranchAccess.SELECTED,
        defaultBranchId: mainBranch.id,
        passwordHash: `hashed:${PASSWORD}`,
      });
      branches.assign(tenant.id, clerk.id, mainBranch.id);
      const tokens = await service.login(
        'DS1',
        'clerk@school.lk',
        PASSWORD,
        META,
      );

      await branches.setStatus(
        tenant.id,
        mainBranch.id,
        BranchStatus.CLOSED,
        new Date(),
      );
      await expectAppError(
        service.refresh(tokens.refreshToken, META),
        'NO_ACTIVE_BRANCH',
      );
    });
  });

  describe('changePassword', () => {
    it('sets the new password, clears the temporary flag and signs out other sessions', async () => {
      const { service, sessions, users, user, auditRepo } = withUser();
      const current = await service.login(
        'DS1',
        'owner@school.lk',
        PASSWORD,
        META,
      );
      await service.login('DS1', 'owner@school.lk', PASSWORD, META);
      const currentSessionId = sessions.rows[0]!.id;

      await service.changePassword(
        actorOf(user, currentSessionId),
        PASSWORD,
        'Brand-New-Pass-1',
        META,
      );

      expect(users.rows[0]).toMatchObject({
        passwordHash: 'hashed:Brand-New-Pass-1',
        mustChangePassword: false,
      });
      expect(sessions.activeFor(user.id).map((s) => s.id)).toEqual([
        currentSessionId,
      ]);
      expect(auditRepo.actions()).toContain(TenantAuditAction.PASSWORD_CHANGED);
      expect(current.refreshToken).toBeDefined();
    });

    it.each([
      [
        'wrong current password',
        'nope',
        'Brand-New-Pass-1',
        'CURRENT_PASSWORD_INCORRECT',
      ],
      ['reused password', PASSWORD, PASSWORD, 'PASSWORD_REUSED'],
    ])('rejects a %s', async (_l, currentPassword, newPassword, code) => {
      const { service, user } = withUser();
      await expectAppError(
        service.changePassword(
          actorOf(user, crypto.randomUUID()),
          currentPassword,
          newPassword,
          META,
        ),
        code,
      );
    });
  });

  describe('me', () => {
    it('returns the workable branches and the default branch', async () => {
      const { service, user, tenant, branches, mainBranch } = withUser();
      const second = branches.seed({ tenantId: tenant.id, name: 'Kandy' });
      branches.seed({
        tenantId: tenant.id,
        name: 'Old',
        status: BranchStatus.CLOSED,
        closedAt: new Date(),
      });

      const me = await service.me(actorOf(user, crypto.randomUUID()));

      expect(me.branches.branches.map((b) => b.name)).toEqual([
        'Main Branch',
        'Kandy',
      ]);
      expect(me.branches.defaultBranchId).toBe(mainBranch.id);
      expect(second.id).not.toBe(mainBranch.id);
    });

    it('falls back to the first workable branch when the stored default is closed', async () => {
      const { service, user, tenant, branches, mainBranch } = withUser();
      const kandy = branches.seed({ tenantId: tenant.id, name: 'Kandy' });
      await branches.setStatus(
        tenant.id,
        mainBranch.id,
        BranchStatus.CLOSED,
        new Date(),
      );

      const me = await service.me(actorOf(user, crypto.randomUUID()));
      expect(me.branches.defaultBranchId).toBe(kandy.id);
    });

    it('shows a SELECTED user only their assigned branches', async () => {
      const { service, users, tenant, branches, mainBranch } = withUser();
      const kandy = branches.seed({ tenantId: tenant.id, name: 'Kandy' });
      const clerk = users.seedUser({
        tenantId: tenant.id,
        branchAccess: TenantUserBranchAccess.SELECTED,
        defaultBranchId: kandy.id,
      });
      branches.assign(tenant.id, clerk.id, kandy.id);

      const me = await service.me(actorOf(clerk, crypto.randomUUID()));
      expect(me.branches.branches.map((b) => b.id)).toEqual([kandy.id]);
      expect(me.branches.defaultBranchId).toBe(kandy.id);
      expect(mainBranch.id).not.toBe(kandy.id);
    });

    it('returns the current phone', async () => {
      const { service, users, user } = withUser();
      users.rows.find((u) => u.id === user.id)!.phone = '+94771234567';
      const me = await service.me(actorOf(user, crypto.randomUUID()));
      expect(me.phone).toBe('+94771234567');
    });

    it("returns the permissions of the user's role", async () => {
      const { service, users, user, tenant } = withUser();
      const clerk = users.seedUser({
        tenantId: tenant.id,
        role: TenantRole.FRONT_DESK,
      });

      expect(
        (await service.me(actorOf(user, crypto.randomUUID()))).permissions,
      ).toEqual(['BRANCHES_MANAGE', 'STAFF_MANAGE']);
      expect(
        (await service.me(actorOf(clerk, crypto.randomUUID()))).permissions,
      ).toEqual([]);
    });
  });
});
