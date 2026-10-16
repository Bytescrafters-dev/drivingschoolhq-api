import type {
  BillingPeriod,
  District,
  TenantAccessStatus,
  TenantRole,
  TenantStatus,
  TenantSubscriptionStatus,
  TenantUserStatus,
} from '../../../generated/prisma/enums.js';
import { toIsoDate } from '../../../common/time/calendar-date.js';
import type { TenantUser } from '../../../tenant/users/interfaces/tenant-user.repository.js';
import type { PeriodInfo } from '../../subscriptions/common/billing-period.js';
import type { TenantSubscription } from '../../subscriptions/interfaces/tenant-subscription.repository.js';
import type { TenantSubscriptionsView } from '../tenant-subscriptions.service.js';
import type { TenantDetails } from '../tenants.service.js';
import type { Tenant, TenantListItem } from './tenant.repository.js';

export interface TenantResponse {
  id: string;
  dsCode: string;
  name: string;
  displayName: string;
  address: string;
  district: District;
  phone: string;
  status: TenantStatus;
  closedAt: Date | null;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface TenantListItemResponse extends TenantResponse {
  accessStatus: TenantAccessStatus | null;
  currentPlan: { planName: string; billingPeriod: BillingPeriod } | null;
}

export interface TenantSubscriptionResponse {
  id: string;
  planId: string;
  planPriceId: string;
  planCode: string;
  planName: string;
  billingPeriod: BillingPeriod;
  /** LKR decimal strings. */
  listAmount: string;
  agreedAmount: string;
  discountReason: string | null;
  gracePeriodDays: number;
  status: TenantSubscriptionStatus;
  /** "YYYY-MM-DD" calendar dates. */
  startDate: string;
  trialEndDate: string | null;
  endDate: string | null;
  cancelledAt: Date | null;
  cancellationReason: string | null;
  createdById: string;
  createdAt: Date;
}

/** Present on the ACTIVE subscription only. */
export interface TenantSubscriptionPeriodResponse {
  inTrial: boolean;
  /** "YYYY-MM-DD"; null while in trial. */
  currentPeriodStart: string | null;
  /** Exclusive end, "YYYY-MM-DD"; null while in trial. */
  currentPeriodEnd: string | null;
  nextRenewalDate: string;
}

export type ActiveTenantSubscriptionResponse = TenantSubscriptionResponse &
  TenantSubscriptionPeriodResponse;

export interface TenantSubscriptionsViewResponse {
  subscription: ActiveTenantSubscriptionResponse | null;
  scheduledSubscription: TenantSubscriptionResponse | null;
}

export interface TenantOwnerResponse {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  nic: string | null;
  role: TenantRole;
  status: TenantUserStatus;
  mustChangePassword: boolean;
  passwordChangedAt: Date | null;
  lastLoginAt: Date | null;
  disabledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TenantDetailsResponse extends TenantResponse {
  access: { status: TenantAccessStatus; statusChangedAt: Date } | null;
  subscription: ActiveTenantSubscriptionResponse | null;
  scheduledSubscription: TenantSubscriptionResponse | null;
  owner: TenantOwnerResponse | null;
}

export function toTenantResponse(tenant: Tenant): TenantResponse {
  return {
    id: tenant.id,
    dsCode: tenant.dsCode,
    name: tenant.name,
    displayName: tenant.displayName,
    address: tenant.address,
    district: tenant.district,
    phone: tenant.phone,
    status: tenant.status,
    closedAt: tenant.closedAt,
    createdById: tenant.createdById,
    createdAt: tenant.createdAt,
    updatedAt: tenant.updatedAt,
  };
}

export function toTenantListItemResponse(
  item: TenantListItem,
): TenantListItemResponse {
  return {
    ...toTenantResponse(item),
    accessStatus: item.accessStatus,
    currentPlan: item.currentPlan,
  };
}

export function toSubscriptionResponse(
  subscription: TenantSubscription,
): TenantSubscriptionResponse {
  return {
    id: subscription.id,
    planId: subscription.planId,
    planPriceId: subscription.planPriceId,
    planCode: subscription.planCode,
    planName: subscription.planName,
    billingPeriod: subscription.billingPeriod,
    listAmount: subscription.listAmount,
    agreedAmount: subscription.agreedAmount,
    discountReason: subscription.discountReason,
    gracePeriodDays: subscription.gracePeriodDays,
    status: subscription.status,
    startDate: toIsoDate(subscription.startDate),
    trialEndDate: subscription.trialEndDate
      ? toIsoDate(subscription.trialEndDate)
      : null,
    endDate: subscription.endDate ? toIsoDate(subscription.endDate) : null,
    cancelledAt: subscription.cancelledAt,
    cancellationReason: subscription.cancellationReason,
    createdById: subscription.createdById,
    createdAt: subscription.createdAt,
  };
}

const isoOrNull = (date: Date | null) => (date ? toIsoDate(date) : null);

function toActiveSubscriptionResponse(
  subscription: TenantSubscription | null,
  period: PeriodInfo | null,
): ActiveTenantSubscriptionResponse | null {
  if (!subscription || !period) return null;
  return {
    ...toSubscriptionResponse(subscription),
    inTrial: period.inTrial,
    currentPeriodStart: isoOrNull(period.periodStart),
    currentPeriodEnd: isoOrNull(period.periodEnd),
    nextRenewalDate: toIsoDate(period.nextRenewalDate),
  };
}

export function toTenantSubscriptionsViewResponse(
  view: TenantSubscriptionsView,
): TenantSubscriptionsViewResponse {
  return {
    subscription: toActiveSubscriptionResponse(
      view.subscription,
      view.currentPeriod,
    ),
    scheduledSubscription: view.scheduledSubscription
      ? toSubscriptionResponse(view.scheduledSubscription)
      : null,
  };
}

/** Explicit allow-list: credential fields can never leak. */
export function toOwnerResponse(owner: TenantUser): TenantOwnerResponse {
  return {
    id: owner.id,
    email: owner.email,
    fullName: owner.fullName,
    phone: owner.phone,
    nic: owner.nic,
    role: owner.role,
    status: owner.status,
    mustChangePassword: owner.mustChangePassword,
    passwordChangedAt: owner.passwordChangedAt,
    lastLoginAt: owner.lastLoginAt,
    disabledAt: owner.disabledAt,
    createdAt: owner.createdAt,
    updatedAt: owner.updatedAt,
  };
}

export function toTenantDetailsResponse(
  details: TenantDetails,
): TenantDetailsResponse {
  return {
    ...toTenantResponse(details.tenant),
    access: details.access
      ? {
          status: details.access.status,
          statusChangedAt: details.access.statusChangedAt,
        }
      : null,
    subscription: toActiveSubscriptionResponse(
      details.subscription,
      details.currentPeriod,
    ),
    scheduledSubscription: details.scheduledSubscription
      ? toSubscriptionResponse(details.scheduledSubscription)
      : null,
    owner: details.owner ? toOwnerResponse(details.owner) : null,
  };
}
