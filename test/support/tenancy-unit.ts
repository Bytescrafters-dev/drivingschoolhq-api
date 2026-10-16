import {
  BillingPeriod,
  PlanPriceStatus,
  PlatformRole,
  PricePlanStatus,
} from '../../src/generated/prisma/enums.js';
import { PlansService } from '../../src/platform/plans/plans.service.js';
import { SubscriptionsService } from '../../src/platform/subscriptions/subscriptions.service.js';
import { TenantOwnerAdminService } from '../../src/platform/tenants/tenant-owner-admin.service.js';
import { TenantSubscriptionsService } from '../../src/platform/tenants/tenant-subscriptions.service.js';
import { TenantsService } from '../../src/platform/tenants/tenants.service.js';
import { TenantOwnersService } from '../../src/tenant/users/tenant-owners.service.js';
import {
  FakeAuditService,
  FakePasswordHasher,
  FixedClock,
  InMemoryAdminRepository,
  actorFrom,
  passthroughTx,
} from './fakes.js';
import { InMemoryPlanRepository } from './plan-fakes.js';
import {
  FakeTenantSessionsService,
  InMemorySubscriptionRepository,
  InMemoryTenantRepository,
  InMemoryTenantUserRepository,
} from './tenancy-fakes.js';

/** Wires TenantsService/SubscriptionsService with in-memory collaborators. */
export function tenancySetup() {
  const plans = new InMemoryPlanRepository();
  const tenants = new InMemoryTenantRepository();
  const subscriptionRows = new InMemorySubscriptionRepository();
  const users = new InMemoryTenantUserRepository();
  const audit = new FakeAuditService();
  // 2026-10-07T10:00Z → 2026-10-07 in Asia/Colombo.
  const clock = new FixedClock();
  const plansService = new PlansService(
    plans,
    audit.asService(),
    passthroughTx,
    clock,
  );
  const subscriptions = new SubscriptionsService(
    subscriptionRows,
    plansService,
    audit.asService(),
    passthroughTx,
    clock,
  );
  const tenantSessions = new FakeTenantSessionsService();
  const owners = new TenantOwnersService(users, tenantSessions.asService());
  const ownerAdmin = new TenantOwnerAdminService(
    tenants,
    owners,
    audit.asService(),
    new FakePasswordHasher().asHasher(),
    passthroughTx,
    clock,
  );
  const service = new TenantsService(
    tenants,
    subscriptions,
    owners,
    tenantSessions.asService(),
    audit.asService(),
    new FakePasswordHasher().asHasher(),
    passthroughTx,
    clock,
  );
  const tenantSubscriptions = new TenantSubscriptionsService(
    tenants,
    subscriptions,
    passthroughTx,
  );
  const actor = actorFrom(
    new InMemoryAdminRepository().seed({
      role: PlatformRole.OPERATIONS_ADMIN,
    }),
  );

  /** An ACTIVE plan with an ACTIVE monthly price of 5000.00. */
  function subscribablePrice(
    overrides: {
      planStatus?: PricePlanStatus;
      priceStatus?: PlanPriceStatus;
    } = {},
  ) {
    const plan = plans.seedPlan({
      code: `P${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
      name: 'Standard',
      status: overrides.planStatus ?? PricePlanStatus.ACTIVE,
    });
    const price = {
      id: crypto.randomUUID(),
      planId: plan.id,
      billingPeriod: BillingPeriod.MONTHLY,
      amount: '5000.00',
      status: overrides.priceStatus ?? PlanPriceStatus.ACTIVE,
      archivedAt: null,
      createdAt: new Date(),
    };
    plans.prices.push(price);
    return { plan, price };
  }

  return {
    plans,
    tenants,
    subscriptionRows,
    users,
    tenantSessions,
    audit,
    clock,
    subscriptions,
    tenantSubscriptions,
    ownerAdmin,
    service,
    actor,
    subscribablePrice,
  };
}
