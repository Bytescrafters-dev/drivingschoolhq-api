import type {
  TenantRole,
  TenantSessionRevokedReason,
  TenantStatus,
  TenantUserStatus,
} from '../../../generated/prisma/enums.js';

export const TENANT_SESSION_REPOSITORY = Symbol('TENANT_SESSION_REPOSITORY');

export interface TenantSession {
  id: string;
  tenantId: string;
  userId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  revokedReason: TenantSessionRevokedReason | null;
}

/** What the auth guard needs about the session's user and tenant. */
export interface SessionPrincipal {
  user: {
    id: string;
    tenantId: string;
    email: string;
    fullName: string;
    role: TenantRole;
    status: TenantUserStatus;
    mustChangePassword: boolean;
  };
  tenant: { id: string; status: TenantStatus };
}

export interface NewTenantSession {
  tenantId: string;
  userId: string;
  refreshTokenHash: string;
  expiresAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface TenantSessionRepository {
  create(session: NewTenantSession): Promise<TenantSession>;
  findWithPrincipal(
    sessionId: string,
  ): Promise<{ session: TenantSession; principal: SessionPrincipal } | null>;
  findByRefreshTokenHash(hash: string): Promise<TenantSession | null>;
  /** Revokes only if still active. Returns false when already revoked. */
  revokeIfActive(
    sessionId: string,
    reason: TenantSessionRevokedReason,
    at: Date,
    replacedById?: string,
  ): Promise<boolean>;
  revokeAllActiveForUser(
    tenantId: string,
    userId: string,
    reason: TenantSessionRevokedReason,
    at: Date,
    exceptSessionId?: string,
  ): Promise<number>;
  revokeAllActiveForTenant(
    tenantId: string,
    reason: TenantSessionRevokedReason,
    at: Date,
  ): Promise<number>;
}
