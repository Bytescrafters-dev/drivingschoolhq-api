import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error.js';
import type { RequestMeta } from '../../common/http/request-meta.js';
import { TenantStatus } from '../../generated/prisma/enums.js';
import { TransactionManager } from '../../prisma/transaction-manager.js';
import type { AuthenticatedPlatformAdmin } from '../admin-auth/interfaces/authenticated-platform-admin.js';
import {
  currentPeriod,
  type PeriodInfo,
} from '../subscriptions/common/billing-period.js';
import type {
  CurrentSubscriptions,
  TenantSubscription,
} from '../subscriptions/interfaces/tenant-subscription.repository.js';
import {
  type ScheduledChangeInput,
  SubscriptionsService,
} from '../subscriptions/subscriptions.service.js';
import {
  TENANT_REPOSITORY,
  type Tenant,
  type TenantRepository,
} from './interfaces/tenant.repository.js';

export interface TenantSubscriptionsView {
  subscription: TenantSubscription | null;
  scheduledSubscription: TenantSubscription | null;
  currentPeriod: PeriodInfo | null;
}

/**
 * Tenant-scoped subscription operations. Locks the tenant row first (lock
 * order: tenant → subscriptions, shared with close/reopen and the renewal
 * job), rejects CLOSED tenants, then delegates to SubscriptionsService.
 */
@Injectable()
export class TenantSubscriptionsService {
  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepository,
    private readonly subscriptions: SubscriptionsService,
    private readonly tx: TransactionManager,
  ) {}

  async listHistory(tenantId: string): Promise<TenantSubscription[]> {
    if (!(await this.tenants.findById(tenantId))) throw tenantNotFound();
    return this.subscriptions.listHistory(tenantId);
  }

  async current(tenantId: string): Promise<TenantSubscriptionsView> {
    if (!(await this.tenants.findById(tenantId))) throw tenantNotFound();
    return this.view(await this.subscriptions.findCurrent(tenantId));
  }

  async scheduleChange(
    actor: AuthenticatedPlatformAdmin,
    tenantId: string,
    terms: ScheduledChangeInput,
    meta: RequestMeta,
  ): Promise<TenantSubscriptionsView> {
    const current = await this.tx.run(async () => {
      await this.lockOpenTenant(tenantId);
      return this.subscriptions.scheduleChange(actor, tenantId, terms, meta);
    });
    return this.view(current);
  }

  async cancelScheduledChange(
    actor: AuthenticatedPlatformAdmin,
    tenantId: string,
    reason: string,
    meta: RequestMeta,
  ): Promise<TenantSubscriptionsView> {
    const current = await this.tx.run(async () => {
      await this.lockOpenTenant(tenantId);
      return this.subscriptions.cancelScheduledChange(
        actor,
        tenantId,
        reason,
        meta,
      );
    });
    return this.view(current);
  }

  async changeGracePeriod(
    actor: AuthenticatedPlatformAdmin,
    tenantId: string,
    days: number,
    meta: RequestMeta,
  ): Promise<TenantSubscriptionsView> {
    const current = await this.tx.run(async () => {
      await this.lockOpenTenant(tenantId);
      return this.subscriptions.changeGracePeriod(actor, tenantId, days, meta);
    });
    return this.view(current);
  }

  /**
   * Activates the tenant's due scheduled change (renewal job). Skips tenants
   * that are missing or CLOSED. Returns whether a change was activated.
   */
  activateDueChange(tenantId: string): Promise<boolean> {
    return this.tx.run(async () => {
      const tenant = await this.tenants.lockById(tenantId);
      if (!tenant || tenant.status === TenantStatus.CLOSED) return false;
      return this.subscriptions.activateDueChange(tenantId);
    });
  }

  private view(current: CurrentSubscriptions): TenantSubscriptionsView {
    return {
      subscription: current.active,
      scheduledSubscription: current.scheduled,
      currentPeriod: current.active
        ? currentPeriod(current.active, this.subscriptions.today())
        : null,
    };
  }

  private async lockOpenTenant(tenantId: string): Promise<Tenant> {
    const tenant = await this.tenants.lockById(tenantId);
    if (!tenant) throw tenantNotFound();
    if (tenant.status === TenantStatus.CLOSED) {
      throw new AppError(
        'CONFLICT',
        'TENANT_CLOSED',
        'A closed tenant must be reopened before its subscription can change',
      );
    }
    return tenant;
  }
}

function tenantNotFound(): AppError {
  return new AppError('NOT_FOUND', 'TENANT_NOT_FOUND', 'Tenant not found');
}
