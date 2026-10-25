import { Injectable } from '@nestjs/common';
import {
  type PlanLimitCode,
  TenantSubscriptionStatus,
} from '../../../generated/prisma/enums.js';
import { TransactionManager } from '../../../prisma/transaction-manager.js';
import type { TenantEntitlementsRepository } from '../interfaces/tenant-entitlements.repository.js';

@Injectable()
export class PrismaTenantEntitlementsRepository implements TenantEntitlementsRepository {
  constructor(private readonly tx: TransactionManager) {}

  async findActiveLimit(
    tenantId: string,
    code: PlanLimitCode,
  ): Promise<number | null | undefined> {
    const limit = await this.tx.client.planLimit.findFirst({
      where: {
        code,
        plan: {
          subscriptions: {
            some: { tenantId, status: TenantSubscriptionStatus.ACTIVE },
          },
        },
      },
      select: { value: true },
    });
    return limit ? limit.value : undefined;
  }
}
