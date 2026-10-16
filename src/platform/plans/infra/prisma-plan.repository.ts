import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client.js';
import {
  type BillingPeriod,
  type PlanFeatureCode,
  PlanPriceStatus,
  type PricePlanStatus,
} from '../../../generated/prisma/enums.js';
import { AppError } from '../../../common/errors/app-error.js';
import { TransactionManager } from '../../../prisma/transaction-manager.js';
import type {
  NewPlan,
  Plan,
  PlanDetails,
  PlanDetailsChange,
  PlanLimit,
  PlanListFilter,
  PlanPrice,
  PlanRepository,
} from '../interfaces/plan.repository.js';

const PLAN_SELECT = {
  id: true,
  code: true,
  name: true,
  description: true,
  status: true,
  isPublic: true,
  sortOrder: true,
  archivedAt: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.PricePlanSelect;

const PRICE_SELECT = {
  id: true,
  planId: true,
  billingPeriod: true,
  amount: true,
  status: true,
  archivedAt: true,
  createdAt: true,
} as const satisfies Prisma.PlanPriceSelect;

type PriceRow = Prisma.PlanPriceGetPayload<{ select: typeof PRICE_SELECT }>;

const BILLING_PERIOD_ORDER: Record<BillingPeriod, number> = {
  MONTHLY: 0,
  QUARTERLY: 1,
  ANNUAL: 2,
};

function toPrice(row: PriceRow): PlanPrice {
  return { ...row, amount: row.amount.toFixed(2) };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

@Injectable()
export class PrismaPlanRepository implements PlanRepository {
  constructor(private readonly tx: TransactionManager) {}

  async findById(id: string): Promise<PlanDetails | null> {
    const row = await this.tx.client.pricePlan.findUnique({
      where: { id },
      select: {
        ...PLAN_SELECT,
        prices: {
          where: { status: PlanPriceStatus.ACTIVE },
          select: PRICE_SELECT,
        },
        limits: {
          select: { code: true, value: true },
          orderBy: { code: 'asc' },
        },
        features: { select: { code: true }, orderBy: { code: 'asc' } },
      },
    });
    if (!row) return null;
    const { prices, limits, features, ...plan } = row;
    return {
      ...plan,
      prices: prices
        .map(toPrice)
        .sort(
          (a, b) =>
            BILLING_PERIOD_ORDER[a.billingPeriod] -
            BILLING_PERIOD_ORDER[b.billingPeriod],
        ),
      limits,
      features: features.map((f) => f.code),
    };
  }

  async lockById(id: string): Promise<Plan | null> {
    const locked = await this.tx.client.$queryRaw<{ id: string }[]>`
      SELECT id FROM price_plans WHERE id = ${id}::uuid FOR UPDATE`;
    if (locked.length === 0) return null;
    return this.tx.client.pricePlan.findUnique({
      where: { id },
      select: PLAN_SELECT,
    });
  }

  async lockPriceForSubscription(
    priceId: string,
  ): Promise<{ plan: Plan; price: PlanPrice } | null> {
    const locked = await this.tx.client.$queryRaw<{ id: string }[]>`
      SELECT p.id FROM price_plans p
      JOIN plan_prices pp ON pp."planId" = p.id
      WHERE pp.id = ${priceId}::uuid
      FOR SHARE OF p`;
    if (locked.length === 0) return null;
    const row = await this.tx.client.planPrice.findUnique({
      where: { id: priceId },
      select: { ...PRICE_SELECT, plan: { select: PLAN_SELECT } },
    });
    if (!row) return null;
    const { plan, ...price } = row;
    return { plan, price: toPrice(price) };
  }

  async list(
    filter: PlanListFilter,
    page: { skip: number; take: number },
  ): Promise<{ items: Plan[]; total: number }> {
    const where: Prisma.PricePlanWhereInput = {
      status: filter.status,
      isPublic: filter.isPublic,
      ...(filter.search
        ? {
            OR: [
              { code: { contains: filter.search, mode: 'insensitive' } },
              { name: { contains: filter.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.tx.client.pricePlan.findMany({
        where,
        select: PLAN_SELECT,
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        skip: page.skip,
        take: page.take,
      }),
      this.tx.client.pricePlan.count({ where }),
    ]);
    return { items, total };
  }

  async create(plan: NewPlan): Promise<Plan> {
    try {
      return await this.tx.client.pricePlan.create({
        data: plan,
        select: PLAN_SELECT,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError(
          'CONFLICT',
          'PLAN_CODE_TAKEN',
          'A plan with this code already exists',
        );
      }
      throw error;
    }
  }

  updateDetails(id: string, change: PlanDetailsChange): Promise<Plan> {
    return this.tx.client.pricePlan.update({
      where: { id },
      data: change,
      select: PLAN_SELECT,
    });
  }

  setStatus(
    id: string,
    status: PricePlanStatus,
    archivedAt: Date | null,
  ): Promise<Plan> {
    return this.tx.client.pricePlan.update({
      where: { id },
      data: { status, archivedAt },
      select: PLAN_SELECT,
    });
  }

  async delete(id: string): Promise<void> {
    // Limits and features cascade; prices are RESTRICT so they go first.
    await this.tx.client.planPrice.deleteMany({ where: { planId: id } });
    await this.tx.client.pricePlan.delete({
      where: { id },
      select: { id: true },
    });
  }

  async listPrices(
    planId: string,
    options: { includeArchived: boolean },
  ): Promise<PlanPrice[]> {
    const rows = await this.tx.client.planPrice.findMany({
      where: {
        planId,
        ...(options.includeArchived ? {} : { status: PlanPriceStatus.ACTIVE }),
      },
      select: PRICE_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    });
    return rows.map(toPrice);
  }

  async findPrice(planId: string, priceId: string): Promise<PlanPrice | null> {
    const row = await this.tx.client.planPrice.findFirst({
      where: { id: priceId, planId },
      select: PRICE_SELECT,
    });
    return row ? toPrice(row) : null;
  }

  async findActivePrice(
    planId: string,
    billingPeriod: BillingPeriod,
  ): Promise<PlanPrice | null> {
    const row = await this.tx.client.planPrice.findFirst({
      where: { planId, billingPeriod, status: PlanPriceStatus.ACTIVE },
      select: PRICE_SELECT,
    });
    return row ? toPrice(row) : null;
  }

  async createPrice(
    planId: string,
    billingPeriod: BillingPeriod,
    amount: string,
  ): Promise<PlanPrice> {
    try {
      const row = await this.tx.client.planPrice.create({
        data: { planId, billingPeriod, amount },
        select: PRICE_SELECT,
      });
      return toPrice(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError(
          'CONFLICT',
          'PLAN_PRICE_CONFLICT',
          'An active price already exists for this billing period',
        );
      }
      throw error;
    }
  }

  async archivePrice(priceId: string, at: Date): Promise<PlanPrice> {
    const row = await this.tx.client.planPrice.update({
      where: { id: priceId },
      data: { status: PlanPriceStatus.ARCHIVED, archivedAt: at },
      select: PRICE_SELECT,
    });
    return toPrice(row);
  }

  async replaceLimits(planId: string, limits: PlanLimit[]): Promise<void> {
    await this.tx.client.planLimit.deleteMany({ where: { planId } });
    if (limits.length > 0) {
      await this.tx.client.planLimit.createMany({
        data: limits.map((limit) => ({ planId, ...limit })),
      });
    }
  }

  async replaceFeatures(
    planId: string,
    features: PlanFeatureCode[],
  ): Promise<void> {
    await this.tx.client.planFeature.deleteMany({ where: { planId } });
    if (features.length > 0) {
      await this.tx.client.planFeature.createMany({
        data: features.map((code) => ({ planId, code })),
      });
    }
  }
}
