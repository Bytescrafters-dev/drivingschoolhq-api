import type {
  BillingPeriod,
  PlanFeatureCode,
  PlanPriceStatus,
  PricePlanStatus,
} from '../../../generated/prisma/enums.js';
import type {
  Plan,
  PlanDetails,
  PlanLimit,
  PlanPrice,
} from './plan.repository.js';

export interface PlanResponse {
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

export interface PlanPriceResponse {
  id: string;
  billingPeriod: BillingPeriod;
  /** LKR as a decimal string, e.g. "5000.00". */
  amount: string;
  status: PlanPriceStatus;
  archivedAt: Date | null;
  createdAt: Date;
}

export interface PlanDetailsResponse extends PlanResponse {
  prices: PlanPriceResponse[];
  limits: PlanLimit[];
  features: PlanFeatureCode[];
}

export function toPlanResponse(plan: Plan): PlanResponse {
  return {
    id: plan.id,
    code: plan.code,
    name: plan.name,
    description: plan.description,
    status: plan.status,
    isPublic: plan.isPublic,
    sortOrder: plan.sortOrder,
    archivedAt: plan.archivedAt,
    createdById: plan.createdById,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
  };
}

export function toPlanPriceResponse(price: PlanPrice): PlanPriceResponse {
  return {
    id: price.id,
    billingPeriod: price.billingPeriod,
    amount: price.amount,
    status: price.status,
    archivedAt: price.archivedAt,
    createdAt: price.createdAt,
  };
}

export function toPlanDetailsResponse(plan: PlanDetails): PlanDetailsResponse {
  return {
    ...toPlanResponse(plan),
    prices: plan.prices.map(toPlanPriceResponse),
    limits: plan.limits.map((limit) => ({
      code: limit.code,
      value: limit.value,
    })),
    features: [...plan.features],
  };
}
