import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from '../../common/clock/clock.js';
import { AppError } from '../../common/errors/app-error.js';
import type { RequestMeta } from '../../common/http/request-meta.js';
import { PasswordHasher } from '../../common/security/password-hasher.js';
import { normalizeEmail } from '../../common/text/email.js';
import {
  TenantSessionRevokedReason,
  TenantStatus,
  TenantUserStatus,
} from '../../generated/prisma/enums.js';
import { TransactionManager } from '../../prisma/transaction-manager.js';
import {
  TenantAuditAction,
  TenantAuditTarget,
} from '../audit/common/tenant-audit-action.js';
import { TenantAuditService } from '../audit/tenant-audit.service.js';
import {
  TENANT_CONTEXT_REPOSITORY,
  type TenantContext,
  type TenantContextRepository,
} from '../context/interfaces/tenant-context.repository.js';
import {
  TENANT_SESSION_REPOSITORY,
  type TenantSessionRepository,
} from '../sessions/interfaces/tenant-session.repository.js';
import {
  TENANT_USER_REPOSITORY,
  type TenantUser,
  type TenantUserRepository,
} from '../users/interfaces/tenant-user.repository.js';
import type { AuthenticatedTenantUser } from './interfaces/authenticated-tenant-user.js';
import { TenantTokenService } from './tenant-token.service.js';

export interface TenantAuthTokens {
  tokenType: 'Bearer';
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
  mustChangePassword: boolean;
}

export interface TenantMe {
  user: AuthenticatedTenantUser;
  tenant: TenantContext;
}

type FailedLoginReason =
  'UNKNOWN_EMAIL' | 'INVALID_PASSWORD' | 'USER_DISABLED' | 'TENANT_CLOSED';

/**
 * Tenant user authentication: DS code + email + password, rotating refresh
 * tokens with reuse detection, forced change of temporary passwords.
 * Suspended tenants (billing) may still sign in; business access is enforced
 * separately. Closed tenants cannot sign in.
 */
@Injectable()
export class TenantAuthService {
  constructor(
    @Inject(TENANT_CONTEXT_REPOSITORY)
    private readonly tenants: TenantContextRepository,
    @Inject(TENANT_USER_REPOSITORY)
    private readonly users: TenantUserRepository,
    @Inject(TENANT_SESSION_REPOSITORY)
    private readonly sessions: TenantSessionRepository,
    private readonly tokens: TenantTokenService,
    private readonly passwords: PasswordHasher,
    private readonly audit: TenantAuditService,
    private readonly tx: TransactionManager,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async login(
    dsCode: string,
    email: string,
    password: string,
    meta: RequestMeta,
  ): Promise<TenantAuthTokens> {
    const tenant = await this.tenants.findByDsCode(dsCode.trim().toUpperCase());
    if (!tenant) {
      // Unknown school: there is no tenant audit log to write to.
      await this.passwords.verifyAgainstDummy(password);
      throw invalidCredentials();
    }

    const normalizedEmail = normalizeEmail(email);
    const credentials = await this.users.findCredentialsByEmail(
      tenant.id,
      normalizedEmail,
    );
    if (!credentials) {
      await this.passwords.verifyAgainstDummy(password);
      await this.recordFailedLogin(
        tenant.id,
        normalizedEmail,
        null,
        'UNKNOWN_EMAIL',
        meta,
      );
      throw invalidCredentials();
    }

    const { user } = credentials;
    const passwordValid = await this.passwords.verify(
      credentials.passwordHash,
      password,
    );
    if (!passwordValid || user.status !== TenantUserStatus.ACTIVE) {
      const reason = passwordValid ? 'USER_DISABLED' : 'INVALID_PASSWORD';
      await this.recordFailedLogin(
        tenant.id,
        normalizedEmail,
        user.id,
        reason,
        meta,
      );
      throw invalidCredentials();
    }
    if (tenant.status === TenantStatus.CLOSED) {
      // Only revealed after the password was verified.
      await this.recordFailedLogin(
        tenant.id,
        normalizedEmail,
        user.id,
        'TENANT_CLOSED',
        meta,
      );
      throw tenantClosed();
    }

    return this.tx.run(async () => {
      const now = this.clock.now();
      const { tokens } = await this.openSession(user, meta, now);
      await this.users.recordLogin(tenant.id, user.id, now);
      await this.audited(user, TenantAuditAction.LOGIN_SUCCEEDED, meta);
      return tokens;
    });
  }

  async refresh(
    refreshToken: string,
    meta: RequestMeta,
  ): Promise<TenantAuthTokens> {
    const session = await this.sessions.findByRefreshTokenHash(
      this.tokens.hashRefreshToken(refreshToken),
    );
    if (!session) throw invalidRefreshToken();

    if (session.revokedReason === TenantSessionRevokedReason.ROTATED) {
      // A rotated token was presented again: it may have been stolen.
      await this.tx.run(async () => {
        await this.sessions.revokeAllActiveForUser(
          session.tenantId,
          session.userId,
          TenantSessionRevokedReason.REFRESH_TOKEN_REUSE,
          this.clock.now(),
        );
        await this.audit.record({
          tenantId: session.tenantId,
          actorTenantUserId: null,
          action: TenantAuditAction.REFRESH_TOKEN_REUSE_DETECTED,
          target: { type: TenantAuditTarget.TENANT_USER, id: session.userId },
          metadata: { sessionId: session.id },
          meta,
        });
      });
      throw invalidRefreshToken();
    }

    const now = this.clock.now();
    if (session.revokedAt || session.expiresAt <= now) {
      throw invalidRefreshToken();
    }

    const [credentials, tenant] = await Promise.all([
      this.users.findCredentialsById(session.tenantId, session.userId),
      this.tenants.findById(session.tenantId),
    ]);
    if (
      !credentials ||
      credentials.user.status !== TenantUserStatus.ACTIVE ||
      !tenant ||
      tenant.status === TenantStatus.CLOSED
    ) {
      throw invalidRefreshToken();
    }

    return this.tx.run(async () => {
      const { sessionId, tokens } = await this.openSession(
        credentials.user,
        meta,
        now,
      );
      const rotated = await this.sessions.revokeIfActive(
        session.id,
        TenantSessionRevokedReason.ROTATED,
        now,
        sessionId,
      );
      // Lost a race with a concurrent refresh/revocation: roll back.
      if (!rotated) throw invalidRefreshToken();
      return tokens;
    });
  }

  async logout(
    actor: AuthenticatedTenantUser,
    meta: RequestMeta,
  ): Promise<void> {
    await this.tx.run(async () => {
      await this.sessions.revokeIfActive(
        actor.sessionId,
        TenantSessionRevokedReason.LOGOUT,
        this.clock.now(),
      );
      await this.audited(actor, TenantAuditAction.LOGOUT, meta);
    });
  }

  async changePassword(
    actor: AuthenticatedTenantUser,
    currentPassword: string,
    newPassword: string,
    meta: RequestMeta,
  ): Promise<void> {
    const credentials = await this.users.findCredentialsById(
      actor.tenantId,
      actor.id,
    );
    if (!credentials) {
      throw new AppError(
        'UNAUTHORIZED',
        'SESSION_INVALID',
        'Session is no longer valid',
      );
    }
    if (
      !(await this.passwords.verify(credentials.passwordHash, currentPassword))
    ) {
      throw new AppError(
        'BAD_REQUEST',
        'CURRENT_PASSWORD_INCORRECT',
        'Current password is incorrect',
      );
    }
    if (await this.passwords.verify(credentials.passwordHash, newPassword)) {
      throw new AppError(
        'BAD_REQUEST',
        'PASSWORD_REUSED',
        'New password must be different from the current password',
      );
    }

    const passwordHash = await this.passwords.hash(newPassword);
    await this.tx.run(async () => {
      const now = this.clock.now();
      await this.users.setOwnPassword(
        actor.tenantId,
        actor.id,
        passwordHash,
        now,
      );
      await this.sessions.revokeAllActiveForUser(
        actor.tenantId,
        actor.id,
        TenantSessionRevokedReason.PASSWORD_CHANGED,
        now,
        actor.sessionId,
      );
      await this.audited(actor, TenantAuditAction.PASSWORD_CHANGED, meta);
    });
  }

  async me(actor: AuthenticatedTenantUser): Promise<TenantMe> {
    const tenant = await this.tenants.findById(actor.tenantId);
    if (!tenant) {
      throw new AppError(
        'UNAUTHORIZED',
        'SESSION_INVALID',
        'Session is no longer valid',
      );
    }
    return { user: actor, tenant };
  }

  private async openSession(
    user: Pick<TenantUser, 'id' | 'tenantId' | 'mustChangePassword'>,
    meta: RequestMeta,
    now: Date,
  ): Promise<{ sessionId: string; tokens: TenantAuthTokens }> {
    const refresh = this.tokens.generateRefreshToken();
    const refreshTokenExpiresAt = new Date(
      now.getTime() + this.tokens.refreshTokenTtlMs,
    );
    const session = await this.sessions.create({
      tenantId: user.tenantId,
      userId: user.id,
      refreshTokenHash: refresh.hash,
      expiresAt: refreshTokenExpiresAt,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    return {
      sessionId: session.id,
      tokens: {
        tokenType: 'Bearer',
        accessToken: await this.tokens.issueAccessToken({
          userId: user.id,
          sessionId: session.id,
          tenantId: user.tenantId,
        }),
        accessTokenExpiresIn: this.tokens.accessTokenTtlSeconds,
        refreshToken: refresh.token,
        refreshTokenExpiresAt,
        mustChangePassword: user.mustChangePassword,
      },
    };
  }

  private audited(
    user: { id: string; tenantId: string },
    action: TenantAuditAction,
    meta: RequestMeta,
  ): Promise<void> {
    return this.audit.record({
      tenantId: user.tenantId,
      actorTenantUserId: user.id,
      action,
      target: { type: TenantAuditTarget.TENANT_USER, id: user.id },
      meta,
    });
  }

  private recordFailedLogin(
    tenantId: string,
    email: string,
    userId: string | null,
    reason: FailedLoginReason,
    meta: RequestMeta,
  ): Promise<void> {
    return this.audit.record({
      tenantId,
      actorTenantUserId: null,
      action: TenantAuditAction.LOGIN_FAILED,
      target: userId
        ? { type: TenantAuditTarget.TENANT_USER, id: userId }
        : undefined,
      metadata: { email, reason },
      meta,
    });
  }
}

function invalidCredentials(): AppError {
  return new AppError(
    'UNAUTHORIZED',
    'INVALID_CREDENTIALS',
    'Invalid DS code, email or password',
  );
}

function tenantClosed(): AppError {
  return new AppError(
    'FORBIDDEN',
    'TENANT_CLOSED',
    'This driving school account has been closed',
  );
}

function invalidRefreshToken(): AppError {
  return new AppError(
    'UNAUTHORIZED',
    'INVALID_REFRESH_TOKEN',
    'Invalid or expired refresh token',
  );
}
