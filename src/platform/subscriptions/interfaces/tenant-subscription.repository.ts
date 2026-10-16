import type {
  BillingPeriod,
  TenantSubscriptionStatus,
} from '../../../generated/prisma/enums.js';

export const TENANT_SUBSCRIPTION_REPOSITORY = Symbol(
  'TENANT_SUBSCRIPTION_REPOSITORY',
);

export interface TenantSubscription {
  id: string;
  tenantId: string;
  planId: string;
  planPriceId: string;
  planCode: string;
  planName: string;
  billingPeriod: BillingPeriod;
  /** LKR, canonical 2-decimal strings. */
  listAmount: string;
  agreedAmount: string;
  discountReason: string | null;
  gracePeriodDays: number;
  status: TenantSubscriptionStatus;
  /** Calendar dates (UTC midnight). */
  startDate: Date;
  trialEndDate: Date | null;
  endDate: Date | null;
  cancelledAt: Date | null;
  cancelledById: string | null;
  cancellationReason: string | null;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Snapshot of agreed terms shared by new ACTIVE and SCHEDULED rows. */
export interface NewActiveSubscription {
  tenantId: string;
  planId: string;
  planPriceId: string;
  planCode: string;
  planName: string;
  billingPeriod: BillingPeriod;
  listAmount: string;
  agreedAmount: string;
  discountReason: string | null;
  gracePeriodDays: number;
  startDate: Date;
  trialEndDate: Date | null;
  createdById: string;
}

export type NewScheduledSubscription = Omit<
  NewActiveSubscription,
  'trialEndDate'
>;

export interface CurrentSubscriptions {
  active: TenantSubscription | null;
  scheduled: TenantSubscription | null;
}

export interface TenantSubscriptionRepository {
  /** Throws AppError SUBSCRIPTION_ALREADY_ACTIVE if the tenant already has one. */
  createActive(
    subscription: NewActiveSubscription,
  ): Promise<TenantSubscription>;
  /** Throws AppError SUBSCRIPTION_CHANGE_ALREADY_SCHEDULED if one exists. */
  createScheduled(
    subscription: NewScheduledSubscription,
  ): Promise<TenantSubscription>;
  findCurrent(tenantId: string): Promise<CurrentSubscriptions>;
  /**
   * Locks the tenant's ACTIVE and SCHEDULED rows (FOR UPDATE) and returns
   * them. Callers must already hold the tenant row lock (lock order:
   * tenant → subscriptions).
   */
  lockCurrent(tenantId: string): Promise<CurrentSubscriptions>;
  /** Newest first. */
  listForTenant(tenantId: string): Promise<TenantSubscription[]>;
  /** Tenant ids with a SCHEDULED subscription starting on or before `today`. */
  findTenantIdsWithDueChanges(today: Date, limit: number): Promise<string[]>;
  /** SCHEDULED → ACTIVE. */
  activate(id: string): Promise<TenantSubscription>;
  updateGracePeriod(id: string, days: number): Promise<TenantSubscription>;
  /** ACTIVE → ENDED with the given end date. */
  end(id: string, endDate: Date): Promise<TenantSubscription>;
  /** SCHEDULED/ACTIVE → CANCELLED. */
  cancel(
    id: string,
    cancellation: { at: Date; byId: string; reason: string },
  ): Promise<TenantSubscription>;
}
