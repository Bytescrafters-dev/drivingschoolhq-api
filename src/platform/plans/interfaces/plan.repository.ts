import type {
  BillingPeriod,
  PlanFeatureCode,
  PlanLimitCode,
  PlanPriceStatus,
  PricePlanStatus,
} from '../../../generated/prisma/enums.js';

export const PLAN_REPOSITORY = Symbol('PLAN_REPOSITORY');

export interface Plan {
  id: string;
  code: string;
  name: string;
  description: string | null;
  status: PricePlanStatus;
  isPublic: boolean;
  sortOrder: number;
  archivedAt: Date | null;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface PlanPrice {
  id: string;
  planId: string;
  billingPeriod: BillingPeriod;
  /** LKR, canonical 2-decimal string (e.g. "5000.00"). */
  amount: string;
  status: PlanPriceStatus;
  archivedAt: Date | null;
  createdAt: Date;
}

export interface PlanLimit {
  code: PlanLimitCode;
  /** null = unlimited. */
  value: number | null;
}

/** A plan with its ACTIVE prices, limits and features. */
export interface PlanDetails extends Plan {
  prices: PlanPrice[];
  limits: PlanLimit[];
  features: PlanFeatureCode[];
}

export interface NewPlan {
  code: string;
  name: string;
  description: string | null;
  isPublic: boolean;
  sortOrder: number;
  createdById: string;
}

export interface PlanDetailsChange {
  name?: string;
  description?: string | null;
  isPublic?: boolean;
  sortOrder?: number;
}

export interface PlanListFilter {
  status?: PricePlanStatus;
  isPublic?: boolean;
  /** Case-insensitive match on code or name. */
  search?: string;
}

export interface PlanRepository {
  findById(id: string): Promise<PlanDetails | null>;
  /**
   * Locks the plan row (SELECT ... FOR UPDATE) and returns it. Must be called
   * inside a transaction; serializes every mutation of one plan.
   */
  lockById(id: string): Promise<Plan | null>;
  /**
   * Share-locks (SELECT ... FOR SHARE) the plan owning the price and returns
   * both. Must be called inside a transaction: the plan and its prices cannot
   * be archived until the caller commits.
   */
  lockPriceForSubscription(
    priceId: string,
  ): Promise<{ plan: Plan; price: PlanPrice } | null>;
  list(
    filter: PlanListFilter,
    page: { skip: number; take: number },
  ): Promise<{ items: Plan[]; total: number }>;
  /** Throws AppError PLAN_CODE_TAKEN when the code is already used. */
  create(plan: NewPlan): Promise<Plan>;
  updateDetails(id: string, change: PlanDetailsChange): Promise<Plan>;
  setStatus(
    id: string,
    status: PricePlanStatus,
    archivedAt: Date | null,
  ): Promise<Plan>;
  /** Deletes the plan with its prices, limits and features. */
  delete(id: string): Promise<void>;

  listPrices(
    planId: string,
    options: { includeArchived: boolean },
  ): Promise<PlanPrice[]>;
  findPrice(planId: string, priceId: string): Promise<PlanPrice | null>;
  findActivePrice(
    planId: string,
    billingPeriod: BillingPeriod,
  ): Promise<PlanPrice | null>;
  /** Throws AppError PLAN_PRICE_CONFLICT if an ACTIVE price already exists for the period. */
  createPrice(
    planId: string,
    billingPeriod: BillingPeriod,
    amount: string,
  ): Promise<PlanPrice>;
  archivePrice(priceId: string, at: Date): Promise<PlanPrice>;

  /** Replaces the full set of limits of the plan. */
  replaceLimits(planId: string, limits: PlanLimit[]): Promise<void>;
  /** Replaces the full set of features of the plan. */
  replaceFeatures(planId: string, features: PlanFeatureCode[]): Promise<void>;
}
