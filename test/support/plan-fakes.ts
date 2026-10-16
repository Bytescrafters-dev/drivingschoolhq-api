import { randomUUID } from 'node:crypto';
import { AppError } from '../../src/common/errors/app-error.js';
import {
  type BillingPeriod,
  type PlanFeatureCode,
  PlanPriceStatus,
  PricePlanStatus,
} from '../../src/generated/prisma/enums.js';
import type {
  NewPlan,
  Plan,
  PlanDetails,
  PlanDetailsChange,
  PlanLimit,
  PlanPrice,
  PlanRepository,
} from '../../src/platform/plans/interfaces/plan.repository.js';

/** In-memory PlanRepository mirroring the database constraints that matter. */
export class InMemoryPlanRepository implements PlanRepository {
  readonly plans = new Map<string, Plan>();
  readonly prices: PlanPrice[] = [];
  readonly limits = new Map<string, PlanLimit[]>();
  readonly features = new Map<string, PlanFeatureCode[]>();

  seedPlan(overrides: Partial<Plan> = {}): Plan {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const plan: Plan = {
      id: randomUUID(),
      code: `PLAN_${randomUUID().slice(0, 6).toUpperCase()}`,
      name: 'Seeded Plan',
      description: null,
      status: PricePlanStatus.DRAFT,
      isPublic: true,
      sortOrder: 0,
      archivedAt: null,
      createdById: randomUUID(),
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
    this.plans.set(plan.id, plan);
    return plan;
  }

  activePrices(planId: string): PlanPrice[] {
    return this.prices.filter(
      (p) => p.planId === planId && p.status === PlanPriceStatus.ACTIVE,
    );
  }

  async findById(id: string): Promise<PlanDetails | null> {
    const plan = this.plans.get(id);
    if (!plan) return null;
    return {
      ...plan,
      prices: this.activePrices(id),
      limits: [...(this.limits.get(id) ?? [])],
      features: [...(this.features.get(id) ?? [])],
    };
  }
  async lockById(id: string) {
    return this.plans.get(id) ?? null;
  }
  async lockPriceForSubscription(priceId: string) {
    const price = this.prices.find((p) => p.id === priceId);
    const plan = price && this.plans.get(price.planId);
    return price && plan ? { plan, price } : null;
  }
  async list() {
    const items = [...this.plans.values()];
    return { items, total: items.length };
  }
  async create(input: NewPlan) {
    if ([...this.plans.values()].some((p) => p.code === input.code)) {
      throw new AppError('CONFLICT', 'PLAN_CODE_TAKEN', 'taken');
    }
    return this.seedPlan(input);
  }
  private patch(id: string, changes: Partial<Plan>): Plan {
    const plan = { ...this.plans.get(id)!, ...changes };
    this.plans.set(id, plan);
    return plan;
  }
  async updateDetails(id: string, change: PlanDetailsChange) {
    return this.patch(id, change);
  }
  async setStatus(
    id: string,
    status: PricePlanStatus,
    archivedAt: Date | null,
  ) {
    return this.patch(id, { status, archivedAt });
  }
  async delete(id: string) {
    this.plans.delete(id);
    this.limits.delete(id);
    this.features.delete(id);
    for (let i = this.prices.length - 1; i >= 0; i--) {
      if (this.prices[i]!.planId === id) this.prices.splice(i, 1);
    }
  }
  async listPrices(planId: string, options: { includeArchived: boolean }) {
    return this.prices.filter(
      (p) =>
        p.planId === planId &&
        (options.includeArchived || p.status === PlanPriceStatus.ACTIVE),
    );
  }
  async findPrice(planId: string, priceId: string) {
    return (
      this.prices.find((p) => p.planId === planId && p.id === priceId) ?? null
    );
  }
  async findActivePrice(planId: string, billingPeriod: BillingPeriod) {
    return (
      this.activePrices(planId).find(
        (p) => p.billingPeriod === billingPeriod,
      ) ?? null
    );
  }
  async createPrice(
    planId: string,
    billingPeriod: BillingPeriod,
    amount: string,
  ) {
    if (await this.findActivePrice(planId, billingPeriod)) {
      throw new AppError('CONFLICT', 'PLAN_PRICE_CONFLICT', 'conflict');
    }
    const price: PlanPrice = {
      id: randomUUID(),
      planId,
      billingPeriod,
      amount,
      status: PlanPriceStatus.ACTIVE,
      archivedAt: null,
      createdAt: new Date(),
    };
    this.prices.push(price);
    return price;
  }
  async archivePrice(priceId: string, at: Date) {
    const price = this.prices.find((p) => p.id === priceId)!;
    Object.assign(price, { status: PlanPriceStatus.ARCHIVED, archivedAt: at });
    return price;
  }
  async replaceLimits(planId: string, limits: PlanLimit[]) {
    this.limits.set(
      planId,
      limits.map((l) => ({ ...l })),
    );
  }
  async replaceFeatures(planId: string, features: PlanFeatureCode[]) {
    this.features.set(planId, [...features]);
  }
}
