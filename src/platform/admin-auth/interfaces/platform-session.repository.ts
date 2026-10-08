import type {
  PlatformAdminStatus,
  PlatformRole,
  PlatformSessionRevokedReason,
} from '../../../generated/prisma/enums.js';

export const PLATFORM_SESSION_REPOSITORY = Symbol(
  'PLATFORM_SESSION_REPOSITORY',
);

export interface PlatformSession {
  id: string;
  adminId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  revokedReason: PlatformSessionRevokedReason | null;
}

export interface SessionAdmin {
  id: string;
  email: string;
  fullName: string;
  role: PlatformRole;
  status: PlatformAdminStatus;
  mustChangePassword: boolean;
}

export interface NewPlatformSession {
  adminId: string;
  refreshTokenHash: string;
  expiresAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface PlatformSessionRepository {
  create(session: NewPlatformSession): Promise<PlatformSession>;
  findWithAdmin(
    sessionId: string,
  ): Promise<{ session: PlatformSession; admin: SessionAdmin } | null>;
  findByRefreshTokenHash(hash: string): Promise<PlatformSession | null>;
  /** Revokes only if still active. Returns false when it was already revoked. */
  revokeIfActive(
    sessionId: string,
    reason: PlatformSessionRevokedReason,
    at: Date,
    replacedById?: string,
  ): Promise<boolean>;
  revokeAllActiveForAdmin(
    adminId: string,
    reason: PlatformSessionRevokedReason,
    at: Date,
    exceptSessionId?: string,
  ): Promise<number>;
}
