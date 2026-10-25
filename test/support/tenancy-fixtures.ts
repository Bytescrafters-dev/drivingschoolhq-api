import { randomDigits } from './random.js';
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import {
  BillingPeriod,
  BranchStatus,
  District,
  PricePlanStatus,
  TenantRole,
  TenantSubscriptionStatus,
  TenantUserBranchAccess,
} from '../../src/generated/prisma/enums.js';

function suffix(): string {
  return randomUUID().slice(0, 8).toUpperCase();
}

export async function createPricePlan(
  prisma: PrismaClient,
  createdById: string,
  overrides: { code?: string; status?: PricePlanStatus } = {},
) {
  return prisma.pricePlan.create({
    data: {
      code: overrides.code ?? `PLAN_${suffix()}`,
      name: 'Fixture Plan',
      status: overrides.status ?? PricePlanStatus.ACTIVE,
      createdById,
    },
  });
}

export async function createPlanPrice(
  prisma: PrismaClient,
  planId: string,
  overrides: { billingPeriod?: BillingPeriod; amount?: string } = {},
) {
  return prisma.planPrice.create({
    data: {
      planId,
      billingPeriod: overrides.billingPeriod ?? BillingPeriod.MONTHLY,
      amount: overrides.amount ?? '5000.00',
    },
  });
}

export async function createTenant(
  prisma: PrismaClient,
  createdById: string,
  overrides: { dsCode?: string } = {},
) {
  return prisma.tenant.create({
    data: {
      dsCode: overrides.dsCode ?? `DS${randomDigits()}`,
      name: 'Fixture Driving School (Pvt) Ltd',
      displayName: 'Fixture Driving School',
      address: '12 Galle Road, Colombo 03',
      district: District.COLOMBO,
      phone: '+94771234567',
      createdById,
    },
  });
}

export async function createSubscription(
  prisma: PrismaClient,
  args: {
    tenantId: string;
    planId: string;
    planPriceId: string;
    createdById: string;
    status?: TenantSubscriptionStatus;
    listAmount?: string;
    agreedAmount?: string;
    discountReason?: string | null;
  },
) {
  return prisma.tenantSubscription.create({
    data: {
      tenantId: args.tenantId,
      planId: args.planId,
      planPriceId: args.planPriceId,
      planCode: 'FIXTURE',
      planName: 'Fixture Plan',
      billingPeriod: BillingPeriod.MONTHLY,
      listAmount: args.listAmount ?? '5000.00',
      agreedAmount: args.agreedAmount ?? args.listAmount ?? '5000.00',
      discountReason: args.discountReason ?? null,
      gracePeriodDays: 7,
      status: args.status ?? TenantSubscriptionStatus.ACTIVE,
      startDate: new Date('2026-10-01'),
      createdById: args.createdById,
    },
  });
}

/** Creates a branch; the creator defaults to the tenant's creating admin. */
export async function createBranch(
  prisma: PrismaClient,
  args: {
    tenantId: string;
    name?: string;
    status?: BranchStatus;
    createdByPlatformAdminId?: string;
  },
) {
  const createdBy =
    args.createdByPlatformAdminId ??
    (
      await prisma.tenant.findUniqueOrThrow({
        where: { id: args.tenantId },
        select: { createdById: true },
      })
    ).createdById;
  const status = args.status ?? BranchStatus.ACTIVE;
  return prisma.branch.create({
    data: {
      tenantId: args.tenantId,
      name: args.name ?? `Branch ${randomUUID().slice(0, 6)}`,
      address: '1 Main Street',
      district: District.COLOMBO,
      phone: '+94771234567',
      status,
      closedAt: status === BranchStatus.CLOSED ? new Date() : null,
      createdByPlatformAdminId: createdBy,
    },
  });
}

/** The tenant's oldest branch, creating a "Main Branch" if it has none. */
export async function mainBranchOf(prisma: PrismaClient, tenantId: string) {
  const existing = await prisma.branch.findFirst({
    where: { tenantId },
    orderBy: { createdAt: 'asc' },
  });
  return existing ?? createBranch(prisma, { tenantId, name: 'Main Branch' });
}

/**
 * Creates a tenant user. Defaults: the tenant's Main Branch as default
 * branch; OWNER gets ALL access, others SELECTED and assigned to the default.
 */
export async function createTenantUser(
  prisma: PrismaClient,
  args: {
    tenantId: string;
    role?: TenantRole;
    branchAccess?: TenantUserBranchAccess;
    defaultBranchId?: string;
    email?: string;
    nic?: string | null;
    phone?: string | null;
    createdByPlatformAdminId?: string | null;
    createdByTenantUserId?: string | null;
  },
) {
  const role = args.role ?? TenantRole.FRONT_DESK;
  const isOwner = role === TenantRole.OWNER;
  const branchAccess =
    args.branchAccess ??
    (isOwner ? TenantUserBranchAccess.ALL : TenantUserBranchAccess.SELECTED);
  const defaultBranchId =
    args.defaultBranchId ?? (await mainBranchOf(prisma, args.tenantId)).id;
  return prisma.tenantUser.create({
    data: {
      branchAccess,
      defaultBranchId,
      ...(branchAccess === TenantUserBranchAccess.SELECTED
        ? {
            branchAssignments: {
              create: { branchId: defaultBranchId },
            },
          }
        : {}),
      tenantId: args.tenantId,
      email: args.email ?? `${randomUUID().slice(0, 8)}@school.lk`,
      fullName: 'Fixture Tenant User',
      phone:
        args.phone !== undefined ? args.phone : isOwner ? '+94771234567' : null,
      nic: args.nic !== undefined ? args.nic : isOwner ? '199012345678' : null,
      passwordHash: 'not-a-real-hash',
      role,
      createdByPlatformAdminId: args.createdByPlatformAdminId ?? null,
      createdByTenantUserId: args.createdByTenantUserId ?? null,
    },
  });
}
