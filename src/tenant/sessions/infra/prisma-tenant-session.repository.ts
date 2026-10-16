import { Injectable } from '@nestjs/common';
import type { TenantSessionRevokedReason } from '../../../generated/prisma/enums.js';
import { TransactionManager } from '../../../prisma/transaction-manager.js';
import type {
  NewTenantSession,
  SessionPrincipal,
  TenantSession,
  TenantSessionRepository,
} from '../interfaces/tenant-session.repository.js';

const SESSION_SELECT = {
  id: true,
  tenantId: true,
  userId: true,
  expiresAt: true,
  revokedAt: true,
  revokedReason: true,
} as const;

@Injectable()
export class PrismaTenantSessionRepository implements TenantSessionRepository {
  constructor(private readonly tx: TransactionManager) {}

  create(session: NewTenantSession): Promise<TenantSession> {
    return this.tx.client.tenantUserSession.create({
      data: session,
      select: SESSION_SELECT,
    });
  }

  async findWithPrincipal(
    sessionId: string,
  ): Promise<{ session: TenantSession; principal: SessionPrincipal } | null> {
    const row = await this.tx.client.tenantUserSession.findUnique({
      where: { id: sessionId },
      select: {
        ...SESSION_SELECT,
        user: {
          select: {
            id: true,
            tenantId: true,
            email: true,
            fullName: true,
            role: true,
            status: true,
            mustChangePassword: true,
          },
        },
        tenant: { select: { id: true, status: true } },
      },
    });
    if (!row) return null;
    const { user, tenant, ...session } = row;
    return { session, principal: { user, tenant } };
  }

  findByRefreshTokenHash(hash: string): Promise<TenantSession | null> {
    return this.tx.client.tenantUserSession.findUnique({
      where: { refreshTokenHash: hash },
      select: SESSION_SELECT,
    });
  }

  async revokeIfActive(
    sessionId: string,
    reason: TenantSessionRevokedReason,
    at: Date,
    replacedById?: string,
  ): Promise<boolean> {
    const result = await this.tx.client.tenantUserSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: {
        revokedAt: at,
        revokedReason: reason,
        replacedById: replacedById ?? null,
      },
    });
    return result.count === 1;
  }

  async revokeAllActiveForUser(
    tenantId: string,
    userId: string,
    reason: TenantSessionRevokedReason,
    at: Date,
    exceptSessionId?: string,
  ): Promise<number> {
    const result = await this.tx.client.tenantUserSession.updateMany({
      where: {
        tenantId,
        userId,
        revokedAt: null,
        ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
      },
      data: { revokedAt: at, revokedReason: reason },
    });
    return result.count;
  }

  async revokeAllActiveForTenant(
    tenantId: string,
    reason: TenantSessionRevokedReason,
    at: Date,
  ): Promise<number> {
    const result = await this.tx.client.tenantUserSession.updateMany({
      where: { tenantId, revokedAt: null },
      data: { revokedAt: at, revokedReason: reason },
    });
    return result.count;
  }
}
