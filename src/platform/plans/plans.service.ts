import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from '../../common/clock/clock.js';
import { AppError } from '../../common/errors/app-error.js';
import type { RequestMeta } from '../../common/http/request-meta.js';
import {
  type BillingPeriod,
  type PlanFeatureCode,
  PlanLimitCode,
  PlanPriceStatus,
  PricePlanStatus,
} from '../../generated/prisma/enums.js';
import { TransactionManager } from '../../prisma/transaction-manager.js';
import type { AuthenticatedPlatformAdmin } from '../admin-auth/interfaces/authenticated-platform-admin.js';
import {
  PlatformAuditAction,
  PlatformAuditTarget,
} from '../audit/common/platform-audit-action.js';
import type { AuditMetadata } from '../audit/interfaces/platform-audit.repository.js';
import { PlatformAuditService } from '../audit/platform-audit.service.js';
import { normalizeLkrAmount } from './common/money.js';
import {
  PLAN_REPOSITORY,
  type Plan,
  type PlanDetails,
  type PlanDetailsChange,
  type PlanLimit,
  type PlanListFilter,
  type PlanPrice,
  type PlanRepository,
} from './interfaces/plan.repository.js';

export interface PlanPriceInput {
  billingPeriod: BillingPeriod;
  amount: string;
}

export interface CreatePlanInput {
  code: string;
  name: string;
  description?: string | null;
  isPublic?: boolean;
  sortOrder?: number;
  prices?: PlanPriceInput[];
  limits?: PlanLimit[];
  features?: PlanFeatureCode[];
}

const ALL_LIMIT_CODES = Object.values(PlanLimitCode);

/**
 * Use cases for the SaaS plan catalogue. Invariants:
 * - plans start as DRAFT; only DRAFT plans may be deleted (they were never
 *   subscribable, so nothing references them);
 * - a plan can only become ACTIVE with at least one active price and every
 *   limit code defined;
 * - an ACTIVE plan always keeps at least one active price;
 * - prices are immutable: setting a price archives the previous one;
 * - limits and features apply to existing subscribers immediately;
 * - every mutation locks the plan row and is audited in the same transaction.
 */
@Injectable()
export class PlansService {
  constructor(
    @Inject(PLAN_REPOSITORY) private readonly plans: PlanRepository,
    private readonly audit: PlatformAuditService,
    private readonly tx: TransactionManager,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  list(filter: PlanListFilter, page: { page: number; pageSize: number }) {
    return this.plans.list(filter, {
      skip: (page.page - 1) * page.pageSize,
      take: page.pageSize,
    });
  }

  async get(id: string): Promise<PlanDetails> {
    const plan = await this.plans.findById(id);
    if (!plan) throw planNotFound();
    return plan;
  }

  /**
   * Resolves a plan price a tenant may subscribe to: the price and its plan
   * must both be ACTIVE (private plans are allowed). Share-locks the plan so
   * it cannot be archived concurrently; call inside the caller's transaction.
   */
  async getSubscribablePrice(
    priceId: string,
  ): Promise<{ plan: Plan; price: PlanPrice }> {
    const found = await this.plans.lockPriceForSubscription(priceId);
    if (!found) {
      throw new AppError(
        'NOT_FOUND',
        'PLAN_PRICE_NOT_FOUND',
        'Plan price not found',
      );
    }
    if (
      found.plan.status !== PricePlanStatus.ACTIVE ||
      found.price.status !== PlanPriceStatus.ACTIVE
    ) {
      throw new AppError(
        'CONFLICT',
        'PLAN_NOT_SUBSCRIBABLE',
        'Only active prices of active plans can be subscribed to',
      );
    }
    return found;
  }

  async listPrices(id: string, includeArchived: boolean): Promise<PlanPrice[]> {
    await this.get(id);
    return this.plans.listPrices(id, { includeArchived });
  }

  async createPlan(
    actor: AuthenticatedPlatformAdmin,
    input: CreatePlanInput,
    meta: RequestMeta,
  ): Promise<PlanDetails> {
    const prices = (input.prices ?? []).map((price) => ({
      billingPeriod: price.billingPeriod,
      amount: normalizeLkrAmount(price.amount),
    }));
    assertUniqueBillingPeriods(prices);
    if (input.limits) assertCompleteLimits(input.limits);
    const features = unique(input.features ?? []);

    return this.tx.run(async () => {
      const plan = await this.plans.create({
        code: normalizePlanCode(input.code),
        name: input.name.trim(),
        description: normalizeDescription(input.description),
        isPublic: input.isPublic ?? true,
        sortOrder: input.sortOrder ?? 0,
        createdById: actor.id,
      });
      for (const price of prices) {
        await this.plans.createPrice(
          plan.id,
          price.billingPeriod,
          price.amount,
        );
      }
      if (input.limits) await this.plans.replaceLimits(plan.id, input.limits);
      if (features.length > 0) {
        await this.plans.replaceFeatures(plan.id, features);
      }
      await this.audited(
        actor,
        plan.id,
        PlatformAuditAction.PLAN_CREATED,
        meta,
        {
          code: plan.code,
          name: plan.name,
          isPublic: plan.isPublic,
          prices,
          limits: input.limits ?? null,
          features,
        },
      );
      return this.get(plan.id);
    });
  }

  async updatePlan(
    actor: AuthenticatedPlatformAdmin,
    id: string,
    input: PlanDetailsChange,
    meta: RequestMeta,
  ): Promise<PlanDetails> {
    return this.tx.run(async () => {
      const current = await this.lock(id);
      const next: PlanDetailsChange = {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.description !== undefined
          ? { description: normalizeDescription(input.description) }
          : {}),
        ...(input.isPublic !== undefined ? { isPublic: input.isPublic } : {}),
        ...(input.sortOrder !== undefined
          ? { sortOrder: input.sortOrder }
          : {}),
      };
      const changes = diff(current, next);
      if (Object.keys(changes).length === 0) return this.get(id);

      await this.plans.updateDetails(id, next);
      await this.audited(
        actor,
        id,
        PlatformAuditAction.PLAN_UPDATED,
        meta,
        changes,
      );
      return this.get(id);
    });
  }

  async activate(
    actor: AuthenticatedPlatformAdmin,
    id: string,
    meta: RequestMeta,
  ): Promise<PlanDetails> {
    return this.tx.run(async () => {
      const current = await this.lock(id);
      if (current.status === PricePlanStatus.ACTIVE) {
        throw invalidState('Plan is already active');
      }
      const details = await this.get(id);
      const blockers = activationBlockers(details);
      if (blockers.length > 0) {
        throw new AppError(
          'CONFLICT',
          'PLAN_NOT_ACTIVATABLE',
          `Plan cannot be activated: ${blockers.join('; ')}`,
        );
      }
      await this.plans.setStatus(id, PricePlanStatus.ACTIVE, null);
      await this.audited(actor, id, PlatformAuditAction.PLAN_ACTIVATED, meta, {
        status: { from: current.status, to: PricePlanStatus.ACTIVE },
      });
      return this.get(id);
    });
  }

  async archive(
    actor: AuthenticatedPlatformAdmin,
    id: string,
    meta: RequestMeta,
  ): Promise<PlanDetails> {
    return this.tx.run(async () => {
      const current = await this.lock(id);
      if (current.status === PricePlanStatus.ARCHIVED) {
        throw invalidState('Plan is already archived');
      }
      await this.plans.setStatus(
        id,
        PricePlanStatus.ARCHIVED,
        this.clock.now(),
      );
      await this.audited(actor, id, PlatformAuditAction.PLAN_ARCHIVED, meta, {
        status: { from: current.status, to: PricePlanStatus.ARCHIVED },
      });
      return this.get(id);
    });
  }

  async deletePlan(
    actor: AuthenticatedPlatformAdmin,
    id: string,
    meta: RequestMeta,
  ): Promise<void> {
    await this.tx.run(async () => {
      const current = await this.lock(id);
      if (current.status !== PricePlanStatus.DRAFT) {
        throw invalidState('Only draft plans can be deleted');
      }
      await this.plans.delete(id);
      await this.audited(actor, id, PlatformAuditAction.PLAN_DELETED, meta, {
        code: current.code,
        name: current.name,
      });
    });
  }

  async setPrice(
    actor: AuthenticatedPlatformAdmin,
    id: string,
    billingPeriod: BillingPeriod,
    amount: string,
    meta: RequestMeta,
  ): Promise<PlanDetails> {
    const nextAmount = normalizeLkrAmount(amount);
    return this.tx.run(async () => {
      await this.lock(id);
      const previous = await this.plans.findActivePrice(id, billingPeriod);
      if (previous?.amount === nextAmount) return this.get(id);

      if (previous)
        await this.plans.archivePrice(previous.id, this.clock.now());
      const created = await this.plans.createPrice(
        id,
        billingPeriod,
        nextAmount,
      );
      await this.audited(actor, id, PlatformAuditAction.PLAN_PRICE_SET, meta, {
        billingPeriod,
        amount: { from: previous?.amount ?? null, to: nextAmount },
        priceId: created.id,
        previousPriceId: previous?.id ?? null,
      });
      return this.get(id);
    });
  }

  async archivePrice(
    actor: AuthenticatedPlatformAdmin,
    id: string,
    priceId: string,
    meta: RequestMeta,
  ): Promise<PlanDetails> {
    return this.tx.run(async () => {
      const plan = await this.lock(id);
      const price = await this.plans.findPrice(id, priceId);
      if (!price) {
        throw new AppError(
          'NOT_FOUND',
          'PLAN_PRICE_NOT_FOUND',
          'Plan price not found',
        );
      }
      if (price.status === PlanPriceStatus.ARCHIVED) {
        throw new AppError(
          'CONFLICT',
          'PLAN_PRICE_ALREADY_ARCHIVED',
          'Plan price is already archived',
        );
      }
      if (plan.status === PricePlanStatus.ACTIVE) {
        const active = await this.plans.listPrices(id, {
          includeArchived: false,
        });
        if (active.length <= 1) {
          throw new AppError(
            'CONFLICT',
            'PLAN_LAST_ACTIVE_PRICE',
            'An active plan must keep at least one active price',
          );
        }
      }
      await this.plans.archivePrice(priceId, this.clock.now());
      await this.audited(
        actor,
        id,
        PlatformAuditAction.PLAN_PRICE_ARCHIVED,
        meta,
        {
          priceId,
          billingPeriod: price.billingPeriod,
          amount: price.amount,
        },
      );
      return this.get(id);
    });
  }

  async setLimits(
    actor: AuthenticatedPlatformAdmin,
    id: string,
    limits: PlanLimit[],
    meta: RequestMeta,
  ): Promise<PlanDetails> {
    assertCompleteLimits(limits);
    const next = sortLimits(limits);
    return this.tx.run(async () => {
      await this.lock(id);
      const previous = sortLimits((await this.get(id)).limits);
      if (sameLimits(previous, next)) return this.get(id);

      await this.plans.replaceLimits(id, next);
      await this.audited(
        actor,
        id,
        PlatformAuditAction.PLAN_LIMITS_UPDATED,
        meta,
        { limits: { from: previous, to: next } },
      );
      return this.get(id);
    });
  }

  async setFeatures(
    actor: AuthenticatedPlatformAdmin,
    id: string,
    features: PlanFeatureCode[],
    meta: RequestMeta,
  ): Promise<PlanDetails> {
    const next = unique(features).sort();
    return this.tx.run(async () => {
      await this.lock(id);
      const previous = [...(await this.get(id)).features].sort();
      if (previous.join() === next.join()) return this.get(id);

      await this.plans.replaceFeatures(id, next);
      await this.audited(
        actor,
        id,
        PlatformAuditAction.PLAN_FEATURES_UPDATED,
        meta,
        { features: { from: previous, to: next } },
      );
      return this.get(id);
    });
  }

  private async lock(id: string): Promise<Plan> {
    const plan = await this.plans.lockById(id);
    if (!plan) throw planNotFound();
    return plan;
  }

  private audited(
    actor: AuthenticatedPlatformAdmin,
    planId: string,
    action: PlatformAuditAction,
    meta: RequestMeta,
    metadata?: AuditMetadata,
  ): Promise<void> {
    return this.audit.record({
      actorAdminId: actor.id,
      action,
      target: { type: PlatformAuditTarget.PRICE_PLAN, id: planId },
      metadata,
      meta,
    });
  }
}

/** Reasons a plan cannot be activated; empty when it can. */
export function activationBlockers(plan: PlanDetails): string[] {
  const blockers: string[] = [];
  if (plan.prices.length === 0) blockers.push('no active price');
  const defined = new Set(plan.limits.map((limit) => limit.code));
  const missing = ALL_LIMIT_CODES.filter((code) => !defined.has(code));
  if (missing.length > 0)
    blockers.push(`missing limits: ${missing.join(', ')}`);
  return blockers;
}

function assertCompleteLimits(limits: PlanLimit[]): void {
  const codes = limits.map((limit) => limit.code);
  const duplicated = codes.filter((code, i) => codes.indexOf(code) !== i);
  const missing = ALL_LIMIT_CODES.filter((code) => !codes.includes(code));
  if (duplicated.length > 0 || missing.length > 0) {
    const problems = [
      ...(missing.length > 0 ? [`missing: ${missing.join(', ')}`] : []),
      ...(duplicated.length > 0
        ? [`duplicated: ${unique(duplicated).join(', ')}`]
        : []),
    ];
    throw new AppError(
      'BAD_REQUEST',
      'PLAN_LIMITS_INVALID',
      `Every limit must be given exactly once (${problems.join('; ')})`,
    );
  }
}

function assertUniqueBillingPeriods(prices: PlanPriceInput[]): void {
  const periods = prices.map((price) => price.billingPeriod);
  if (new Set(periods).size !== periods.length) {
    throw new AppError(
      'BAD_REQUEST',
      'PLAN_PRICE_DUPLICATE_PERIOD',
      'Each billing period can only be priced once',
    );
  }
}

function normalizePlanCode(code: string): string {
  return code.trim().toUpperCase();
}

function normalizeDescription(
  description: string | null | undefined,
): string | null {
  const trimmed = description?.trim();
  return trimmed ? trimmed : null;
}

function diff(current: Plan, next: PlanDetailsChange): AuditMetadata {
  const changes: AuditMetadata = {};
  for (const key of Object.keys(next) as (keyof PlanDetailsChange)[]) {
    if (current[key] !== next[key]) {
      changes[key] = { from: current[key], to: next[key] };
    }
  }
  return changes;
}

function sortLimits(limits: PlanLimit[]): PlanLimit[] {
  return [...limits]
    .map((limit) => ({ code: limit.code, value: limit.value }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

function sameLimits(a: PlanLimit[], b: PlanLimit[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (limit, i) => limit.code === b[i]!.code && limit.value === b[i]!.value,
    )
  );
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function planNotFound(): AppError {
  return new AppError('NOT_FOUND', 'PLAN_NOT_FOUND', 'Plan not found');
}

function invalidState(message: string): AppError {
  return new AppError('CONFLICT', 'INVALID_PLAN_STATE', message);
}
