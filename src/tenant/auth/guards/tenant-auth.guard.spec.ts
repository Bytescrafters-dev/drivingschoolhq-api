import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  TenantRole,
  TenantStatus,
  TenantUserStatus,
} from '../../../generated/prisma/enums.js';
import { META, expectAppError } from '../../../../test/support/fakes.js';
import {
  tenantAuthSetup,
  tenantTokenService,
} from '../../../../test/support/tenant-auth-fakes.js';
import type { TenantAuthenticatedRequest } from '../interfaces/authenticated-tenant-user.js';
import { TenantAuthGuard } from './tenant-auth.guard.js';

const PASSWORD = 'Owner-Temp-Pass-1';

function context(
  request: Partial<TenantAuthenticatedRequest>,
  allowPasswordChange = false,
): ExecutionContext {
  const handler = () => undefined;
  if (allowPasswordChange) {
    Reflect.defineMetadata('tenant:allowPasswordChangeRequired', true, handler);
  }
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handler,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

async function setup(mustChangePassword = false) {
  const ctx = tenantAuthSetup();
  const tenant = ctx.tenants.seed({ dsCode: 'DS1' });
  const user = ctx.users.seedUser({
    tenantId: tenant.id,
    role: TenantRole.OWNER,
    email: 'owner@school.lk',
    mustChangePassword,
    passwordHash: `hashed:${PASSWORD}`,
  });
  const { accessToken } = await ctx.service.login(
    'DS1',
    'owner@school.lk',
    PASSWORD,
    META,
  );
  const guard = new TenantAuthGuard(
    ctx.tokens,
    ctx.sessions,
    ctx.clock,
    new Reflector(),
  );
  const run = (token: string, allow = false) => {
    const request: Partial<TenantAuthenticatedRequest> = {
      headers: { authorization: `Bearer ${token}` },
    };
    return guard
      .canActivate(context(request, allow))
      .then(() => request.tenantUser);
  };
  return { ...ctx, tenant, user, accessToken, run };
}

describe('TenantAuthGuard', () => {
  it('attaches the tenant user resolved from the session', async () => {
    const { run, accessToken, user } = await setup();
    await expect(run(accessToken)).resolves.toMatchObject({
      id: user.id,
      tenantId: user.tenantId,
      role: 'OWNER',
    });
  });

  it('rejects a token whose tenant claim does not match the session', async () => {
    const { run, sessions, user, tokens } = await setup();
    const forged = await tokens.issueAccessToken({
      userId: user.id,
      sessionId: sessions.rows[0]!.id,
      tenantId: crypto.randomUUID(),
    });
    await expectAppError(run(forged), 'SESSION_INVALID');
  });

  it('rejects tokens signed with another secret (e.g. platform tokens)', async () => {
    const { run, sessions, user } = await setup();
    const other = tenantTokenService(
      'a-completely-different-secret-32-chars!!',
    );
    const token = await other.issueAccessToken({
      userId: user.id,
      sessionId: sessions.rows[0]!.id,
      tenantId: user.tenantId,
    });
    await expectAppError(run(token), 'INVALID_ACCESS_TOKEN');
  });

  it.each([
    [
      'revoked session',
      (c: Awaited<ReturnType<typeof setup>>) => {
        c.sessions.rows[0]!.revokedAt = new Date();
      },
    ],
    [
      'disabled user',
      (c: Awaited<ReturnType<typeof setup>>) => {
        c.users.rows[0]!.status = TenantUserStatus.DISABLED;
      },
    ],
    [
      'closed school',
      (c: Awaited<ReturnType<typeof setup>>) => {
        c.tenants.rows[0]!.status = TenantStatus.CLOSED;
      },
    ],
  ])('rejects a %s', async (_label, mutate) => {
    const c = await setup();
    mutate(c);
    await expectAppError(c.run(c.accessToken), 'SESSION_INVALID');
  });

  it('only lets users with a temporary password reach allowed routes', async () => {
    const { run, accessToken } = await setup(true);
    await expectAppError(run(accessToken), 'PASSWORD_CHANGE_REQUIRED');
    await expect(run(accessToken, true)).resolves.toBeDefined();
  });

  it('requires a bearer token', async () => {
    const { run } = await setup();
    await expectAppError(run(''), 'AUTHENTICATION_REQUIRED');
  });
});
