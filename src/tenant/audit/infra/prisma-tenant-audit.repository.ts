import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import { TransactionManager } from '../../../prisma/transaction-manager.js';
import type {
  NewTenantAuditEntry,
  TenantAuditRepository,
} from '../interfaces/tenant-audit.repository.js';

@Injectable()
export class PrismaTenantAuditRepository implements TenantAuditRepository {
  constructor(private readonly tx: TransactionManager) {}

  async append(entry: NewTenantAuditEntry): Promise<void> {
    await this.tx.client.tenantAuditLog.create({
      data: {
        ...entry,
        metadata: (entry.metadata ?? undefined) as
          Prisma.InputJsonValue | undefined,
      },
    });
  }
}
