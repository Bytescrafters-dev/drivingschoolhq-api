import type { PlanLimitCode } from '../../../generated/prisma/enums.js';

export const TENANT_ENTITLEMENTS_REPOSITORY = Symbol(
  'TENANT_ENTITLEMENTS_REPOSITORY',
);

export interface TenantEntitlementsRepository {
  /**
   * The limit of the plan behind the tenant's ACTIVE subscription.
   * `undefined` when there is no active subscription or the plan does not
   * define the limit; `null` when the plan allows an unlimited amount.
   */
  findActiveLimit(
    tenantId: string,
    code: PlanLimitCode,
  ): Promise<number | null | undefined>;
}
