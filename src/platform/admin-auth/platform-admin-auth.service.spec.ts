import {
  PlatformAdminStatus,
  PlatformSessionRevokedReason,
} from '../../generated/prisma/enums.js';
import {
  FakeAuditService,
  FakePasswordHasher,
  FixedClock,
  InMemoryAdminRepository,
  InMemorySessionRepository,
  META,
  actorFrom,
  expectAppError,
  passthroughTx,
} from '../../../test/support/fakes.js';
import { PlatformAuditAction } from '../audit/common/platform-audit-action.js';
import { PlatformAdminAuthService } from './platform-admin-auth.service.js';
import type { PlatformTokenService } from './platform-token.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;

class FakeTokenService {
  private counter = 0;
  accessTokenTtlSeconds = 900;
  refreshTokenTtlMs = 7 * DAY_MS;
  async issueAccessToken(adminId: string, sessionId: string) {
    return `access:${adminId}:${sessionId}`;
  }
  generateRefreshToken() {
    const token = `refresh-${++this.counter}`;
    return { token, hash: this.hashRefreshToken(token) };
  }
  hashRefreshToken(token: string) {
    return `sha:${token}`;
  }
}

function setup() {
  const admins = new InMemoryAdminRepository();
  const sessions = new InMemorySessionRepository(admins);
  const audit = new FakeAuditService();
  const hasher = new FakePasswordHasher();
  const clock = new FixedClock();
  const service = new PlatformAdminAuthService(
    admins,
    sessions,
    new FakeTokenService() as unknown as PlatformTokenService,
    hasher.asHasher(),
    audit.asService(),
    passthroughTx,
    clock,
  );
  const admin = admins.seed({
    email: 'admin@test.lk',
    password: 'Correct-Password-1',
    mustChangePassword: true,
  });
  return { admins, sessions, audit, hasher, clock, service, admin };
}

describe('PlatformAdminAuthService', () => {
  describe('login', () => {
    it('opens a session, records last login and returns tokens with the password-change flag', async () => {
      const { service, sessions, admins, audit, admin, clock } = setup();

      const tokens = await service.login(
        ' ADMIN@test.lk ',
        'Correct-Password-1',
        META,
      );

      expect(tokens).toMatchObject({
        tokenType: 'Bearer',
        accessTokenExpiresIn: 900,
        mustChangePassword: true,
        refreshTokenExpiresAt: new Date(clock.now().getTime() + 7 * DAY_MS),
      });
      expect(sessions.activeFor(admin.id)).toHaveLength(1);
      expect(admins.get(admin.id).admin.lastLoginAt).toEqual(clock.now());
      expect(audit.actions()).toEqual([PlatformAuditAction.LOGIN_SUCCEEDED]);
    });

    it('returns the same error for unknown email, wrong password and disabled admin', async () => {
      const { service, admins, hasher, audit } = setup();
      admins.seed({
        email: 'off@test.lk',
        password: 'Correct-Password-1',
        status: PlatformAdminStatus.DISABLED,
      });

      await expectAppError(
        service.login('nobody@test.lk', 'x', META),
        'INVALID_CREDENTIALS',
      );
      await expectAppError(
        service.login('admin@test.lk', 'wrong', META),
        'INVALID_CREDENTIALS',
      );
      await expectAppError(
        service.login('off@test.lk', 'Correct-Password-1', META),
        'INVALID_CREDENTIALS',
      );

      expect(hasher.dummyVerifications).toBe(1);
      expect(audit.entries.map((e) => e.metadata?.reason)).toEqual([
        'UNKNOWN_EMAIL',
        'INVALID_PASSWORD',
        'ADMIN_DISABLED',
      ]);
      expect(audit.entries.every((e) => e.actorAdminId === null)).toBe(true);
      expect(JSON.stringify(audit.entries)).not.toContain('wrong');
    });
  });

  describe('refresh', () => {
    it('rotates the session and returns new tokens', async () => {
      const { service, sessions, admin } = setup();
      const first = await service.login(
        'admin@test.lk',
        'Correct-Password-1',
        META,
      );

      const second = await service.refresh(first.refreshToken, META);

      expect(second.refreshToken).not.toBe(first.refreshToken);
      const active = sessions.activeFor(admin.id);
      expect(active).toHaveLength(1);
      const old = await sessions.findByRefreshTokenHash(
        `sha:${first.refreshToken}`,
      );
      expect(old).toMatchObject({
        revokedReason: PlatformSessionRevokedReason.ROTATED,
      });
    });

    it('treats reuse of a rotated token as theft: revokes all sessions and audits', async () => {
      const { service, sessions, audit, admin } = setup();
      const first = await service.login(
        'admin@test.lk',
        'Correct-Password-1',
        META,
      );
      await service.refresh(first.refreshToken, META);

      await expectAppError(
        service.refresh(first.refreshToken, META),
        'INVALID_REFRESH_TOKEN',
      );

      expect(sessions.activeFor(admin.id)).toHaveLength(0);
      expect(audit.actions()).toContain(
        PlatformAuditAction.REFRESH_TOKEN_REUSE_DETECTED,
      );
    });

    it('rejects an expired refresh token at the expiry instant', async () => {
      const { service, clock } = setup();
      const tokens = await service.login(
        'admin@test.lk',
        'Correct-Password-1',
        META,
      );
      clock.advanceMs(7 * DAY_MS);
      await expectAppError(
        service.refresh(tokens.refreshToken, META),
        'INVALID_REFRESH_TOKEN',
      );
    });

    it('accepts a refresh token just before expiry', async () => {
      const { service, clock } = setup();
      const tokens = await service.login(
        'admin@test.lk',
        'Correct-Password-1',
        META,
      );
      clock.advanceMs(7 * DAY_MS - 1);
      await expect(
        service.refresh(tokens.refreshToken, META),
      ).resolves.toBeDefined();
    });

    it('rejects refresh for a disabled admin and unknown tokens', async () => {
      const { service, admins, admin } = setup();
      const tokens = await service.login(
        'admin@test.lk',
        'Correct-Password-1',
        META,
      );
      await admins.disable(admin.id, new Date());
      await expectAppError(
        service.refresh(tokens.refreshToken, META),
        'INVALID_REFRESH_TOKEN',
      );
      await expectAppError(
        service.refresh('never-issued', META),
        'INVALID_REFRESH_TOKEN',
      );
    });
  });

  describe('changePassword', () => {
    async function loggedIn() {
      const ctx = setup();
      await ctx.service.login('admin@test.lk', 'Correct-Password-1', META);
      const [current] = ctx.sessions.activeFor(ctx.admin.id);
      const other = await ctx.sessions.create({
        adminId: ctx.admin.id,
        refreshTokenHash: 'other',
        expiresAt: new Date('2027-01-01'),
        ipAddress: null,
        userAgent: null,
      });
      return {
        ...ctx,
        actor: actorFrom(ctx.admin, current!.id),
        otherSessionId: other.id,
      };
    }

    it('updates the password, clears the flag, keeps the current session and revokes others', async () => {
      const { service, admins, sessions, audit, actor, otherSessionId, clock } =
        await loggedIn();

      await service.changePassword(
        actor,
        'Correct-Password-1',
        'Brand-New-Password-2',
        META,
      );

      const stored = admins.get(actor.id);
      expect(stored.passwordHash).toBe('hashed:Brand-New-Password-2');
      expect(stored.admin).toMatchObject({
        mustChangePassword: false,
        passwordChangedAt: clock.now(),
      });
      expect(sessions.activeFor(actor.id).map((s) => s.id)).toEqual([
        actor.sessionId,
      ]);
      expect(sessions.rows.get(otherSessionId)?.revokedReason).toBe(
        PlatformSessionRevokedReason.PASSWORD_CHANGED,
      );
      expect(audit.actions()).toContain(PlatformAuditAction.PASSWORD_CHANGED);
    });

    it('rejects a wrong current password', async () => {
      const { service, actor, admins } = await loggedIn();
      await expectAppError(
        service.changePassword(actor, 'nope', 'Brand-New-Password-2', META),
        'CURRENT_PASSWORD_INCORRECT',
      );
      expect(admins.get(actor.id).admin.mustChangePassword).toBe(true);
    });

    it('rejects reusing the current password', async () => {
      const { service, actor } = await loggedIn();
      await expectAppError(
        service.changePassword(
          actor,
          'Correct-Password-1',
          'Correct-Password-1',
          META,
        ),
        'PASSWORD_REUSED',
      );
    });
  });

  it('logout revokes only the current session', async () => {
    const { service, sessions, audit, admin } = setup();
    await service.login('admin@test.lk', 'Correct-Password-1', META);
    await service.login('admin@test.lk', 'Correct-Password-1', META);
    const [current, other] = sessions.activeFor(admin.id);

    await service.logout(actorFrom(admin, current!.id), META);

    expect(sessions.activeFor(admin.id).map((s) => s.id)).toEqual([other!.id]);
    expect(audit.actions()).toContain(PlatformAuditAction.LOGOUT);
  });
});
