import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  PlatformAdminStatus,
  PlatformRole,
  PlatformSessionRevokedReason,
} from '../../../generated/prisma/enums.js';
import {
  FixedClock,
  InMemoryAdminRepository,
  InMemorySessionRepository,
  expectAppError,
} from '../../../../test/support/fakes.js';
import { PlatformPermission } from '../../permissions/platform-permission.js';
import type { PlatformAuthenticatedRequest } from '../interfaces/authenticated-platform-admin.js';
import {
  ALLOW_PASSWORD_CHANGE_REQUIRED,
  REQUIRED_PLATFORM_PERMISSIONS,
} from '../common/metadata-keys.js';
import type { PlatformTokenService } from '../platform-token.service.js';
import { PlatformAuthGuard } from './platform-auth.guard.js';
import { PlatformPermissionGuard } from './platform-permission.guard.js';

function contextFor(
  request: Partial<PlatformAuthenticatedRequest>,
  metadata: Record<string, unknown> = {},
): ExecutionContext {
  const handler = () => undefined;
  for (const [key, value] of Object.entries(metadata)) {
    Reflect.defineMetadata(key, value, handler);
  }
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handler,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

function setup() {
  const admins = new InMemoryAdminRepository();
  const sessions = new InMemorySessionRepository(admins);
  const clock = new FixedClock();
  const tokens = {
    // token format for tests: "<adminId>.<sessionId>"; "bad" fails verification.
    verifyAccessToken: async (token: string) => {
      const [adminId, sessionId] = token.split('.');
      return adminId && sessionId ? { adminId, sessionId } : null;
    },
  } as unknown as PlatformTokenService;
  const guard = new PlatformAuthGuard(tokens, sessions, clock, new Reflector());
  return { admins, sessions, clock, guard };
}

async function sessionFor(
  ctx: ReturnType<typeof setup>,
  overrides: Parameters<InMemoryAdminRepository['seed']>[0] = {},
) {
  const admin = ctx.admins.seed(overrides);
  const session = await ctx.sessions.create({
    adminId: admin.id,
    refreshTokenHash: crypto.randomUUID(),
    expiresAt: new Date(ctx.clock.now().getTime() + 60_000),
    ipAddress: null,
    userAgent: null,
  });
  return { admin, session, header: `Bearer ${admin.id}.${session.id}` };
}

describe('PlatformAuthGuard', () => {
  it('requires a bearer token', async () => {
    const { guard } = setup();
    await expectAppError(
      guard.canActivate(contextFor({ headers: {} })),
      'AUTHENTICATION_REQUIRED',
    );
    await expectAppError(
      guard.canActivate(
        contextFor({ headers: { authorization: 'Basic abc' } }),
      ),
      'AUTHENTICATION_REQUIRED',
    );
  });

  it('rejects tokens that fail verification', async () => {
    const { guard } = setup();
    await expectAppError(
      guard.canActivate(
        contextFor({ headers: { authorization: 'Bearer bad' } }),
      ),
      'INVALID_ACCESS_TOKEN',
    );
  });

  it('attaches the authenticated admin with role permissions', async () => {
    const ctx = setup();
    const { admin, session, header } = await sessionFor(ctx, {
      role: PlatformRole.SUPPORT,
    });
    const request: Partial<PlatformAuthenticatedRequest> = {
      headers: { authorization: header },
    };

    await expect(ctx.guard.canActivate(contextFor(request))).resolves.toBe(
      true,
    );
    expect(request.platformAdmin).toMatchObject({
      id: admin.id,
      sessionId: session.id,
      role: PlatformRole.SUPPORT,
    });
    expect(request.platformAdmin?.permissions).toContain(
      PlatformPermission.TENANTS_READ,
    );
  });

  it('rejects revoked sessions, expired sessions, disabled admins and mismatched subjects', async () => {
    const ctx = setup();

    const revoked = await sessionFor(ctx);
    await ctx.sessions.revokeIfActive(
      revoked.session.id,
      PlatformSessionRevokedReason.LOGOUT,
      ctx.clock.now(),
    );

    const expired = await sessionFor(ctx);
    ctx.sessions.rows.get(expired.session.id)!.expiresAt = ctx.clock.now();

    const disabled = await sessionFor(ctx, {
      status: PlatformAdminStatus.DISABLED,
    });

    const other = await sessionFor(ctx);
    const mismatched = `Bearer ${crypto.randomUUID()}.${other.session.id}`;

    for (const header of [
      revoked.header,
      expired.header,
      disabled.header,
      mismatched,
    ]) {
      await expectAppError(
        ctx.guard.canActivate(
          contextFor({ headers: { authorization: header } }),
        ),
        'SESSION_INVALID',
      );
    }
  });

  it('blocks admins with a temporary password unless the route allows it', async () => {
    const ctx = setup();
    const { header } = await sessionFor(ctx, { mustChangePassword: true });

    await expectAppError(
      ctx.guard.canActivate(contextFor({ headers: { authorization: header } })),
      'PASSWORD_CHANGE_REQUIRED',
    );
    await expect(
      ctx.guard.canActivate(
        contextFor(
          { headers: { authorization: header } },
          { [ALLOW_PASSWORD_CHANGE_REQUIRED]: true },
        ),
      ),
    ).resolves.toBe(true);
  });
});

describe('PlatformPermissionGuard', () => {
  const guard = new PlatformPermissionGuard(new Reflector());
  const asRole = (role: PlatformRole) =>
    ({ platformAdmin: { role } }) as unknown as PlatformAuthenticatedRequest;

  it('allows authenticated routes without required permissions', () => {
    expect(guard.canActivate(contextFor(asRole(PlatformRole.SUPPORT)))).toBe(
      true,
    );
  });

  it('denies when the role lacks a required permission', () => {
    const ctx = contextFor(asRole(PlatformRole.BILLING_ADMIN), {
      [REQUIRED_PLATFORM_PERMISSIONS]: [
        PlatformPermission.PLATFORM_ADMINS_MANAGE,
      ],
    });
    expect(() => guard.canActivate(ctx)).toThrowError(
      expect.objectContaining({ code: 'PLATFORM_PERMISSION_DENIED' }),
    );
  });

  it('allows when the role has every required permission', () => {
    const ctx = contextFor(asRole(PlatformRole.SUPER_ADMIN), {
      [REQUIRED_PLATFORM_PERMISSIONS]: [PlatformPermission.PLATFORM_AUDIT_READ],
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });
});
