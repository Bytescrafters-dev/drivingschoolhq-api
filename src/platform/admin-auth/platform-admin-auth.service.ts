import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from '../../common/clock/clock.js';
import { AppError } from '../../common/errors/app-error.js';
import type { RequestMeta } from '../../common/http/request-meta.js';
import {
  PlatformAdminStatus,
  PlatformSessionRevokedReason,
} from '../../generated/prisma/enums.js';
import { TransactionManager } from '../../prisma/transaction-manager.js';
import { normalizeEmail } from '../../common/text/email.js';
import {
  PLATFORM_ADMIN_USER_REPOSITORY,
  type PlatformAdmin,
  type PlatformAdminUserRepository,
} from '../admin-users/interfaces/platform-admin-user.repository.js';
import {
  PlatformAuditAction,
  PlatformAuditTarget,
} from '../audit/common/platform-audit-action.js';
import { PlatformAuditService } from '../audit/platform-audit.service.js';
import type { AuthenticatedPlatformAdmin } from './interfaces/authenticated-platform-admin.js';
import { PasswordHasher } from '../../common/security/password-hasher.js';
import {
  PLATFORM_SESSION_REPOSITORY,
  type PlatformSessionRepository,
} from './interfaces/platform-session.repository.js';
import { PlatformTokenService } from './platform-token.service.js';

export interface PlatformAuthTokens {
  tokenType: 'Bearer';
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
  mustChangePassword: boolean;
}

@Injectable()
export class PlatformAdminAuthService {
  constructor(
    @Inject(PLATFORM_ADMIN_USER_REPOSITORY)
    private readonly admins: PlatformAdminUserRepository,
    @Inject(PLATFORM_SESSION_REPOSITORY)
    private readonly sessions: PlatformSessionRepository,
    private readonly tokens: PlatformTokenService,
    private readonly passwords: PasswordHasher,
    private readonly audit: PlatformAuditService,
    private readonly tx: TransactionManager,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async login(
    email: string,
    password: string,
    meta: RequestMeta,
  ): Promise<PlatformAuthTokens> {
    const normalizedEmail = normalizeEmail(email);
    const credentials =
      await this.admins.findCredentialsByEmail(normalizedEmail);

    if (!credentials) {
      await this.passwords.verifyAgainstDummy(password);
      await this.recordFailedLogin(
        normalizedEmail,
        null,
        'UNKNOWN_EMAIL',
        meta,
      );
      throw invalidCredentials();
    }

    const passwordValid = await this.passwords.verify(
      credentials.passwordHash,
      password,
    );
    const { admin } = credentials;
    if (!passwordValid || admin.status !== PlatformAdminStatus.ACTIVE) {
      const reason = !passwordValid ? 'INVALID_PASSWORD' : 'ADMIN_DISABLED';
      await this.recordFailedLogin(normalizedEmail, admin.id, reason, meta);
      throw invalidCredentials();
    }

    return this.tx.run(async () => {
      const now = this.clock.now();
      const { tokens } = await this.openSession(admin, meta, now);
      await this.admins.recordLogin(admin.id, now);
      await this.audit.record({
        actorAdminId: admin.id,
        action: PlatformAuditAction.LOGIN_SUCCEEDED,
        target: { type: PlatformAuditTarget.PLATFORM_ADMIN, id: admin.id },
        meta,
      });
      return tokens;
    });
  }

  async refresh(
    refreshToken: string,
    meta: RequestMeta,
  ): Promise<PlatformAuthTokens> {
    const session = await this.sessions.findByRefreshTokenHash(
      this.tokens.hashRefreshToken(refreshToken),
    );
    if (!session) throw invalidRefreshToken();

    if (session.revokedReason === PlatformSessionRevokedReason.ROTATED) {
      // A rotated token was presented again: it may have been stolen. Revoke the admin's sessions.
      await this.tx.run(async () => {
        await this.sessions.revokeAllActiveForAdmin(
          session.adminId,
          PlatformSessionRevokedReason.REFRESH_TOKEN_REUSE,
          this.clock.now(),
        );
        await this.audit.record({
          actorAdminId: null,
          action: PlatformAuditAction.REFRESH_TOKEN_REUSE_DETECTED,
          target: {
            type: PlatformAuditTarget.PLATFORM_ADMIN,
            id: session.adminId,
          },
          metadata: { sessionId: session.id },
          meta,
        });
      });
      throw invalidRefreshToken();
    }

    const now = this.clock.now();
    if (session.revokedAt || session.expiresAt <= now)
      throw invalidRefreshToken();

    const admin = await this.admins.findById(session.adminId);
    if (!admin || admin.status !== PlatformAdminStatus.ACTIVE)
      throw invalidRefreshToken();

    return this.tx.run(async () => {
      const { sessionId, tokens } = await this.openSession(admin, meta, now);
      const rotated = await this.sessions.revokeIfActive(
        session.id,
        PlatformSessionRevokedReason.ROTATED,
        now,
        sessionId,
      );
      // Lost a race with a concurrent refresh/revocation of the same session: roll back.
      if (!rotated) throw invalidRefreshToken();
      return tokens;
    });
  }

  async logout(
    actor: AuthenticatedPlatformAdmin,
    meta: RequestMeta,
  ): Promise<void> {
    await this.tx.run(async () => {
      await this.sessions.revokeIfActive(
        actor.sessionId,
        PlatformSessionRevokedReason.LOGOUT,
        this.clock.now(),
      );
      await this.audit.record({
        actorAdminId: actor.id,
        action: PlatformAuditAction.LOGOUT,
        target: { type: PlatformAuditTarget.PLATFORM_ADMIN, id: actor.id },
        meta,
      });
    });
  }

  async changePassword(
    actor: AuthenticatedPlatformAdmin,
    currentPassword: string,
    newPassword: string,
    meta: RequestMeta,
  ): Promise<void> {
    const credentials = await this.admins.findCredentialsById(actor.id);
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
      await this.admins.setPassword(actor.id, {
        passwordHash,
        mustChangePassword: false,
        passwordChangedAt: now,
      });
      await this.sessions.revokeAllActiveForAdmin(
        actor.id,
        PlatformSessionRevokedReason.PASSWORD_CHANGED,
        now,
        actor.sessionId,
      );
      await this.audit.record({
        actorAdminId: actor.id,
        action: PlatformAuditAction.PASSWORD_CHANGED,
        target: { type: PlatformAuditTarget.PLATFORM_ADMIN, id: actor.id },
        meta,
      });
    });
  }

  private async openSession(
    admin: PlatformAdmin,
    meta: RequestMeta,
    now: Date,
  ): Promise<{ sessionId: string; tokens: PlatformAuthTokens }> {
    const refresh = this.tokens.generateRefreshToken();
    const refreshTokenExpiresAt = new Date(
      now.getTime() + this.tokens.refreshTokenTtlMs,
    );
    const session = await this.sessions.create({
      adminId: admin.id,
      refreshTokenHash: refresh.hash,
      expiresAt: refreshTokenExpiresAt,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    return {
      sessionId: session.id,
      tokens: {
        tokenType: 'Bearer',
        accessToken: await this.tokens.issueAccessToken(admin.id, session.id),
        accessTokenExpiresIn: this.tokens.accessTokenTtlSeconds,
        refreshToken: refresh.token,
        refreshTokenExpiresAt,
        mustChangePassword: admin.mustChangePassword,
      },
    };
  }

  private recordFailedLogin(
    email: string,
    adminId: string | null,
    reason: 'UNKNOWN_EMAIL' | 'INVALID_PASSWORD' | 'ADMIN_DISABLED',
    meta: RequestMeta,
  ): Promise<void> {
    return this.audit.record({
      actorAdminId: null,
      action: PlatformAuditAction.LOGIN_FAILED,
      target: adminId
        ? { type: PlatformAuditTarget.PLATFORM_ADMIN, id: adminId }
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
    'Invalid email or password',
  );
}

function invalidRefreshToken(): AppError {
  return new AppError(
    'UNAUTHORIZED',
    'INVALID_REFRESH_TOKEN',
    'Invalid or expired refresh token',
  );
}
