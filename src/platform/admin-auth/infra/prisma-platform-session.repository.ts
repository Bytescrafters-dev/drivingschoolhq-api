import { Injectable } from '@nestjs/common';
import type { PlatformSessionRevokedReason } from '../../../generated/prisma/enums.js';
import { TransactionManager } from '../../../prisma/transaction-manager.js';
import type {
  NewPlatformSession,
  PlatformSession,
  PlatformSessionRepository,
  SessionAdmin,
} from '../interfaces/platform-session.repository.js';

const SESSION_SELECT = {
  id: true,
  adminId: true,
  expiresAt: true,
  revokedAt: true,
  revokedReason: true,
} as const;

@Injectable()
export class PrismaPlatformSessionRepository implements PlatformSessionRepository {
  constructor(private readonly tx: TransactionManager) {}

  create(session: NewPlatformSession): Promise<PlatformSession> {
    return this.tx.client.platformAdminSession.create({
      data: session,
      select: SESSION_SELECT,
    });
  }

  async findWithAdmin(
    sessionId: string,
  ): Promise<{ session: PlatformSession; admin: SessionAdmin } | null> {
    const row = await this.tx.client.platformAdminSession.findUnique({
      where: { id: sessionId },
      select: {
        ...SESSION_SELECT,
        admin: {
          select: {
            id: true,
            email: true,
            fullName: true,
            role: true,
            status: true,
            mustChangePassword: true,
          },
        },
      },
    });
    if (!row) return null;
    const { admin, ...session } = row;
    return { session, admin };
  }

  findByRefreshTokenHash(hash: string): Promise<PlatformSession | null> {
    return this.tx.client.platformAdminSession.findUnique({
      where: { refreshTokenHash: hash },
      select: SESSION_SELECT,
    });
  }

  async revokeIfActive(
    sessionId: string,
    reason: PlatformSessionRevokedReason,
    at: Date,
    replacedById?: string,
  ): Promise<boolean> {
    const { count } = await this.tx.client.platformAdminSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: at, revokedReason: reason, replacedById },
    });
    return count === 1;
  }

  async revokeAllActiveForAdmin(
    adminId: string,
    reason: PlatformSessionRevokedReason,
    at: Date,
    exceptSessionId?: string,
  ): Promise<number> {
    const { count } = await this.tx.client.platformAdminSession.updateMany({
      where: {
        adminId,
        revokedAt: null,
        ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
      },
      data: { revokedAt: at, revokedReason: reason },
    });
    return count;
  }
}
