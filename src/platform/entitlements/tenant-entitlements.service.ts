import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error.js';
import type { PlanLimitCode } from '../../generated/prisma/enums.js';
import {
  TENANT_ENTITLEMENTS_REPOSITORY,
  type TenantEntitlementsRepository,
} from './interfaces/tenant-entitlements.repository.js';

/**
 * What a tenant's plan allows. Limits come from the plan of the ACTIVE
 * subscription, so catalogue changes apply immediately. Business modules ask
 * this service; they never look at plan names.
 */
@Injectable()
export class TenantEntitlementsService {
  constructor(
    @Inject(TENANT_ENTITLEMENTS_REPOSITORY)
    private readonly entitlements: TenantEntitlementsRepository,
  ) {}

  /**
   * The numeric limit; null = unlimited. Fails closed (0) when the tenant has
   * no active subscription or the plan does not define the limit.
   */
  async limit(tenantId: string, code: PlanLimitCode): Promise<number | null> {
    const value = await this.entitlements.findActiveLimit(tenantId, code);
    return value === undefined ? 0 : value;
  }

  /**
   * Throws PLAN_LIMIT_REACHED unless one more item fits next to `current`.
   * Callers must hold a lock that keeps `current` stable (the tenant row).
   */
  async assertCanAdd(
    tenantId: string,
    code: PlanLimitCode,
    current: number,
  ): Promise<void> {
    const limit = await this.limit(tenantId, code);
    if (limit !== null && current >= limit) {
      throw new AppError(
        'CONFLICT',
        'PLAN_LIMIT_REACHED',
        `Your plan allows ${limit} (${code}); upgrade the plan to add more`,
      );
    }
  }
}
