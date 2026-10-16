import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from '../../common/clock/clock.js';
import { AppError } from '../../common/errors/app-error.js';
import type { RequestMeta } from '../../common/http/request-meta.js';
import {
  businessToday,
  parseIsoDate,
  toIsoDate,
} from '../../common/time/calendar-date.js';
import { TransactionManager } from '../../prisma/transaction-manager.js';
import type { AuthenticatedPlatformAdmin } from '../admin-auth/interfaces/authenticated-platform-admin.js';
import {
  PlatformAuditAction,
  PlatformAuditTarget,
} from '../audit/common/platform-audit-action.js';
import type { AuditMetadata } from '../audit/interfaces/platform-audit.repository.js';
import { PlatformAuditService } from '../audit/platform-audit.service.js';
import { normalizeLkrAmount } from '../plans/common/money.js';
import { PlansService } from '../plans/plans.service.js';
import { addDays, currentPeriod } from './common/billing-period.js';
import {
  TENANT_SUBSCRIPTION_REPOSITORY,
  type CurrentSubscriptions,
  type NewScheduledSubscription,
  type TenantSubscription,
  type TenantSubscriptionRepository,
} from './interfaces/tenant-subscription.repository.js';

export const DEFAULT_GRACE_PERIOD_DAYS = 7;
export const MAX_GRACE_PERIOD_DAYS = 90;

/** Audit request meta for changes made by the system (scheduled jobs). */
export const SYSTEM_META: RequestMeta = {
  ipAddress: null,
  userAgent: 'system:subscription-renewal',
};

/** Commercial terms an admin chooses when starting a subscription. */
export interface SubscriptionTermsInput {
  planPriceId: string;
  /** "YYYY-MM-DD"; omitted/null = no trial. */
  trialEndDate?: string | null;
  /** LKR decimal string; defaults to the plan's list price. */
  agreedAmount?: string;
  /** Required when agreedAmount differs from the list price. */
  discountReason?: string | null;
  gracePeriodDays?: number;
}

/** Terms for a plan change taking effect at the next renewal (no trial). */
export type ScheduledChangeInput = Omit<SubscriptionTermsInput, 'trialEndDate'>;

/**
 * Tenant subscription use cases. Invariants:
 * - a new subscription starts today (Asia/Colombo); no backdating;
 * - plan changes are SCHEDULED for the next renewal date (trial end when in
 *   trial) and activated by the renewal job; no proration;
 * - only ACTIVE prices of ACTIVE plans can be subscribed to;
 * - commercial terms are snapshotted; a discount needs a reason and can never
 *   exceed the list price;
 * - history is preserved: rows are ended/cancelled, never rewritten.
 * Mutations join the caller's transaction. Callers must hold the tenant row
 * lock (lock order: tenant → subscriptions); see TenantSubscriptionsService.
 */
@Injectable()
export class SubscriptionsService {
  constructor(
    @Inject(TENANT_SUBSCRIPTION_REPOSITORY)
    private readonly subscriptions: TenantSubscriptionRepository,
    private readonly plans: PlansService,
    private readonly audit: PlatformAuditService,
    private readonly tx: TransactionManager,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  today(): Date {
    return businessToday(this.clock.now());
  }

  findCurrent(tenantId: string): Promise<CurrentSubscriptions> {
    return this.subscriptions.findCurrent(tenantId);
  }

  listHistory(tenantId: string): Promise<TenantSubscription[]> {
    return this.subscriptions.listForTenant(tenantId);
  }

  /** Starts the tenant's ACTIVE subscription today with the given terms. */
  async startSubscription(
    actor: AuthenticatedPlatformAdmin,
    tenantId: string,
    terms: SubscriptionTermsInput,
    meta: RequestMeta,
  ): Promise<TenantSubscription> {
    const today = this.today();
    const trialEndDate = parseTrialEndDate(terms.trialEndDate, today);
    const gracePeriodDays = validGracePeriod(
      terms.gracePeriodDays ?? DEFAULT_GRACE_PERIOD_DAYS,
    );

    return this.tx.run(async () => {
      const snapshot = await this.snapshotTerms(
        tenantId,
        terms,
        gracePeriodDays,
        actor,
      );
      const subscription = await this.subscriptions.createActive({
        ...snapshot,
        startDate: today,
        trialEndDate,
      });
      await this.audited(
        actor.id,
        subscription.id,
        PlatformAuditAction.SUBSCRIPTION_CREATED,
        meta,
        {
          ...auditTerms(subscription),
          trialEndDate: trialEndDate ? toIsoDate(trialEndDate) : null,
        },
      );
      return subscription;
    });
  }

  /**
   * Schedules a plan/price change for the next renewal date. Replaces an
   * already scheduled change (the old one is cancelled and audited).
   */
  async scheduleChange(
    actor: AuthenticatedPlatformAdmin,
    tenantId: string,
    terms: ScheduledChangeInput,
    meta: RequestMeta,
  ): Promise<CurrentSubscriptions> {
    return this.tx.run(async () => {
      const { active, scheduled } =
        await this.subscriptions.lockCurrent(tenantId);
      if (!active) throw noActiveSubscription();

      const gracePeriodDays = validGracePeriod(
        terms.gracePeriodDays ?? active.gracePeriodDays,
      );
      const snapshot = await this.snapshotTerms(
        tenantId,
        terms,
        gracePeriodDays,
        actor,
      );
      if (sameTerms(active, snapshot)) {
        throw new AppError(
          'CONFLICT',
          'SUBSCRIPTION_CHANGE_NO_OP',
          'The new terms are identical to the current subscription',
        );
      }
      const startDate = currentPeriod(active, this.today()).nextRenewalDate;

      if (scheduled) {
        await this.cancelRow(
          actor,
          scheduled,
          'Replaced by a new scheduled change',
          meta,
        );
      }
      const created = await this.subscriptions.createScheduled({
        ...snapshot,
        startDate,
      });
      await this.audited(
        actor.id,
        created.id,
        PlatformAuditAction.SUBSCRIPTION_CHANGE_SCHEDULED,
        meta,
        {
          ...auditTerms(created),
          replacesSubscriptionId: active.id,
          replacedScheduledId: scheduled?.id ?? null,
        },
      );
      return { active, scheduled: created };
    });
  }

  async cancelScheduledChange(
    actor: AuthenticatedPlatformAdmin,
    tenantId: string,
    reason: string,
    meta: RequestMeta,
  ): Promise<CurrentSubscriptions> {
    const cancellationReason = requireReason(reason);
    return this.tx.run(async () => {
      const { active, scheduled } =
        await this.subscriptions.lockCurrent(tenantId);
      if (!scheduled) {
        throw new AppError(
          'NOT_FOUND',
          'NO_SCHEDULED_CHANGE',
          'The tenant has no scheduled subscription change',
        );
      }
      await this.cancelRow(actor, scheduled, cancellationReason, meta);
      return { active, scheduled: null };
    });
  }

  async changeGracePeriod(
    actor: AuthenticatedPlatformAdmin,
    tenantId: string,
    days: number,
    meta: RequestMeta,
  ): Promise<CurrentSubscriptions> {
    const gracePeriodDays = validGracePeriod(days);
    return this.tx.run(async () => {
      const { active, scheduled } =
        await this.subscriptions.lockCurrent(tenantId);
      if (!active) throw noActiveSubscription();
      if (active.gracePeriodDays === gracePeriodDays) {
        return { active, scheduled };
      }
      const previous = active.gracePeriodDays;
      const updated = await this.subscriptions.updateGracePeriod(
        active.id,
        gracePeriodDays,
      );
      await this.audited(
        actor.id,
        active.id,
        PlatformAuditAction.SUBSCRIPTION_GRACE_PERIOD_CHANGED,
        meta,
        {
          tenantId,
          gracePeriodDays: {
            from: previous,
            to: gracePeriodDays,
          },
        },
      );
      return { active: updated, scheduled };
    });
  }

  /**
   * Ends the ACTIVE subscription today and cancels any SCHEDULED change.
   * Used when a tenant is closed.
   */
  async endAllForTenant(
    actor: AuthenticatedPlatformAdmin,
    tenantId: string,
    reason: string,
    meta: RequestMeta,
  ): Promise<void> {
    await this.tx.run(async () => {
      const { active, scheduled } =
        await this.subscriptions.lockCurrent(tenantId);
      if (active) {
        const today = this.today();
        const endDate = today < active.startDate ? active.startDate : today;
        await this.subscriptions.end(active.id, endDate);
        await this.audited(
          actor.id,
          active.id,
          PlatformAuditAction.SUBSCRIPTION_ENDED,
          meta,
          { tenantId, endDate: toIsoDate(endDate), reason },
        );
      }
      if (scheduled) await this.cancelRow(actor, scheduled, reason, meta);
    });
  }

  /** Tenant ids whose scheduled change is due (for the renewal job). */
  findTenantIdsWithDueChanges(limit: number): Promise<string[]> {
    return this.subscriptions.findTenantIdsWithDueChanges(this.today(), limit);
  }

  /**
   * Activates the tenant's scheduled change if it is due: the ACTIVE row ends
   * the day before, the SCHEDULED row becomes ACTIVE. Idempotent. Audited as
   * a system action. Returns whether a change was activated.
   */
  async activateDueChange(tenantId: string): Promise<boolean> {
    return this.tx.run(async () => {
      const { active, scheduled } =
        await this.subscriptions.lockCurrent(tenantId);
      if (!scheduled || scheduled.startDate > this.today()) return false;

      if (active) {
        const dayBefore = addDays(scheduled.startDate, -1);
        const endDate =
          dayBefore < active.startDate ? active.startDate : dayBefore;
        await this.subscriptions.end(active.id, endDate);
        await this.audited(
          null,
          active.id,
          PlatformAuditAction.SUBSCRIPTION_ENDED,
          SYSTEM_META,
          {
            tenantId,
            endDate: toIsoDate(endDate),
            reason: 'Replaced by scheduled change',
          },
        );
      }
      await this.subscriptions.activate(scheduled.id);
      await this.audited(
        null,
        scheduled.id,
        PlatformAuditAction.SUBSCRIPTION_ACTIVATED,
        SYSTEM_META,
        { tenantId, previousSubscriptionId: active?.id ?? null },
      );
      return true;
    });
  }

  /** Resolves the plan price (share-locked) and snapshots agreed terms. */
  private async snapshotTerms(
    tenantId: string,
    terms: ScheduledChangeInput,
    gracePeriodDays: number,
    actor: AuthenticatedPlatformAdmin,
  ): Promise<Omit<NewScheduledSubscription, 'startDate'>> {
    const { plan, price } = await this.plans.getSubscribablePrice(
      terms.planPriceId,
    );
    const listAmount = price.amount;
    const agreedAmount =
      terms.agreedAmount !== undefined
        ? normalizeLkrAmount(terms.agreedAmount)
        : listAmount;
    return {
      tenantId,
      planId: plan.id,
      planPriceId: price.id,
      planCode: plan.code,
      planName: plan.name,
      billingPeriod: price.billingPeriod,
      listAmount,
      agreedAmount,
      discountReason: resolveDiscountReason(
        listAmount,
        agreedAmount,
        terms.discountReason,
      ),
      gracePeriodDays,
      createdById: actor.id,
    };
  }

  private async cancelRow(
    actor: AuthenticatedPlatformAdmin,
    subscription: TenantSubscription,
    reason: string,
    meta: RequestMeta,
  ): Promise<void> {
    await this.subscriptions.cancel(subscription.id, {
      at: this.clock.now(),
      byId: actor.id,
      reason,
    });
    await this.audited(
      actor.id,
      subscription.id,
      PlatformAuditAction.SUBSCRIPTION_CANCELLED,
      meta,
      { tenantId: subscription.tenantId, reason },
    );
  }

  private audited(
    actorAdminId: string | null,
    subscriptionId: string,
    action: PlatformAuditAction,
    meta: RequestMeta,
    metadata: AuditMetadata,
  ): Promise<void> {
    return this.audit.record({
      actorAdminId,
      action,
      target: {
        type: PlatformAuditTarget.TENANT_SUBSCRIPTION,
        id: subscriptionId,
      },
      metadata,
      meta,
    });
  }
}

function auditTerms(subscription: TenantSubscription): AuditMetadata {
  return {
    tenantId: subscription.tenantId,
    planCode: subscription.planCode,
    billingPeriod: subscription.billingPeriod,
    listAmount: subscription.listAmount,
    agreedAmount: subscription.agreedAmount,
    discountReason: subscription.discountReason,
    gracePeriodDays: subscription.gracePeriodDays,
    startDate: toIsoDate(subscription.startDate),
  };
}

function sameTerms(
  active: TenantSubscription,
  next: Omit<NewScheduledSubscription, 'startDate'>,
): boolean {
  return (
    active.planPriceId === next.planPriceId &&
    active.agreedAmount === next.agreedAmount &&
    active.gracePeriodDays === next.gracePeriodDays
  );
}

function parseTrialEndDate(
  value: string | null | undefined,
  today: Date,
): Date | null {
  if (value === undefined || value === null) return null;
  let date: Date;
  try {
    date = parseIsoDate(value);
  } catch {
    throw invalidTrialEndDate('Trial end date must be a valid YYYY-MM-DD date');
  }
  if (date < today) {
    throw invalidTrialEndDate('Trial end date cannot be in the past');
  }
  return date;
}

function invalidTrialEndDate(message: string): AppError {
  return new AppError('BAD_REQUEST', 'INVALID_TRIAL_END_DATE', message);
}

function validGracePeriod(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > MAX_GRACE_PERIOD_DAYS) {
    throw new AppError(
      'BAD_REQUEST',
      'INVALID_GRACE_PERIOD',
      `Grace period must be between 0 and ${MAX_GRACE_PERIOD_DAYS} days`,
    );
  }
  return value;
}

function resolveDiscountReason(
  listAmount: string,
  agreedAmount: string,
  reason: string | null | undefined,
): string | null {
  if (agreedAmount === listAmount) return null;
  if (Number(agreedAmount) > Number(listAmount)) {
    throw new AppError(
      'BAD_REQUEST',
      'AGREED_AMOUNT_EXCEEDS_LIST_PRICE',
      'The agreed amount cannot exceed the plan list price',
    );
  }
  const trimmed = reason?.trim();
  if (!trimmed) {
    throw new AppError(
      'BAD_REQUEST',
      'DISCOUNT_REASON_REQUIRED',
      'A discount reason is required when the agreed amount differs from the list price',
    );
  }
  return trimmed;
}

function requireReason(reason: string): string {
  const trimmed = reason.trim();
  if (!trimmed) {
    throw new AppError(
      'BAD_REQUEST',
      'REASON_REQUIRED',
      'A reason is required',
    );
  }
  return trimmed;
}

function noActiveSubscription(): AppError {
  return new AppError(
    'CONFLICT',
    'NO_ACTIVE_SUBSCRIPTION',
    'The tenant has no active subscription',
  );
}
