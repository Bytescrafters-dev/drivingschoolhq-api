import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import { TransactionManager } from '../../../prisma/transaction-manager.js';
import type {
  AuditCursor,
  NewPlatformAuditEntry,
  PlatformAuditEntry,
  PlatformAuditFilter,
  PlatformAuditRepository,
} from '../interfaces/platform-audit.repository.js';

@Injectable()
export class PrismaPlatformAuditRepository implements PlatformAuditRepository {
  constructor(private readonly tx: TransactionManager) {}

  async append(entry: NewPlatformAuditEntry): Promise<void> {
    await this.tx.client.platformAuditLog.create({
      data: {
        actorAdminId: entry.actorAdminId,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        metadata: (entry.metadata ?? undefined) as
          Prisma.InputJsonValue | undefined,
        ipAddress: entry.ipAddress,
        userAgent: entry.userAgent,
      },
    });
  }

  listNewestFirst(
    filter: PlatformAuditFilter,
    after: AuditCursor | null,
    limit: number,
  ): Promise<PlatformAuditEntry[]> {
    const where: Prisma.PlatformAuditLogWhereInput = {
      actorAdminId: filter.actorAdminId,
      action: filter.action,
      targetType: filter.targetType,
      targetId: filter.targetId,
      createdAt:
        filter.from || filter.to
          ? { gte: filter.from, lte: filter.to }
          : undefined,
    };
    if (after) {
      where.OR = [
        { createdAt: { lt: after.createdAt } },
        { createdAt: after.createdAt, id: { lt: after.id } },
      ];
    }
    return this.tx.client.platformAuditLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
    });
  }
}
