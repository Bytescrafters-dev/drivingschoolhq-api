import {
  BillingPeriod,
  PlanFeatureCode,
  PlanLimitCode,
  PlanPriceStatus,
  PlatformRole,
  PricePlanStatus,
} from '../../generated/prisma/enums.js';
import {
  FakeAuditService,
  FixedClock,
  InMemoryAdminRepository,
  META,
  actorFrom,
  expectAppError,
  passthroughTx,
} from '../../../test/support/fakes.js';
import { InMemoryPlanRepository } from '../../../test/support/plan-fakes.js';
import { PlatformAuditAction } from '../audit/common/platform-audit-action.js';
import { normalizeLkrAmount } from './common/money.js';
import type { PlanLimit } from './interfaces/plan.repository.js';
import { PlansService } from './plans.service.js';

const FULL_LIMITS: PlanLimit[] = [
  { code: PlanLimitCode.MAX_STAFF_USERS, value: 5 },
  { code: PlanLimitCode.MAX_BRANCHES, value: 1 },
  { code: PlanLimitCode.MAX_INSTRUCTORS, value: 3 },
  { code: PlanLimitCode.MAX_VEHICLES, value: null },
];

function setup() {
  const plans = new InMemoryPlanRepository();
  const audit = new FakeAuditService();
  const clock = new FixedClock();
  const service = new PlansService(
    plans,
    audit.asService(),
    passthroughTx,
    clock,
  );
  const actor = actorFrom(
    new InMemoryAdminRepository().seed({ role: PlatformRole.BILLING_ADMIN }),
  );
  return { plans, audit, clock, service, actor };
}

/** A DRAFT plan that satisfies every activation rule. */
function seedActivatable(plans: InMemoryPlanRepository) {
  const plan = plans.seedPlan();
  plans.prices.push({
    id: crypto.randomUUID(),
    planId: plan.id,
    billingPeriod: BillingPeriod.MONTHLY,
    amount: '5000.00',
    status: PlanPriceStatus.ACTIVE,
    archivedAt: null,
    createdAt: new Date(),
  });
  plans.limits.set(plan.id, FULL_LIMITS);
  return plan;
}

describe('normalizeLkrAmount', () => {
  it.each([
    ['5000', '5000.00'],
    ['12.5', '12.50'],
    ['0005000.10', '5000.10'],
    ['0', '0.00'],
  ])('normalises %s to %s', (input, expected) => {
    expect(normalizeLkrAmount(input)).toBe(expected);
  });

  it.each(['-1', '1.234', 'abc', '', '12345678901'])(
    'rejects %s',
    async (input) => {
      await expectAppError(
        Promise.resolve().then(() => normalizeLkrAmount(input)),
        'INVALID_AMOUNT',
      );
    },
  );
});

describe('PlansService', () => {
  describe('createPlan', () => {
    it('creates a DRAFT plan with normalised code, prices, limits and features, and audits it', async () => {
      const { service, audit, actor } = setup();

      const plan = await service.createPlan(
        actor,
        {
          code: ' starter ',
          name: ' Starter ',
          description: '   ',
          prices: [
            { billingPeriod: BillingPeriod.MONTHLY, amount: '5000' },
            { billingPeriod: BillingPeriod.ANNUAL, amount: '50000.5' },
          ],
          limits: FULL_LIMITS,
          features: [PlanFeatureCode.SMS_NOTIFICATIONS],
        },
        META,
      );

      expect(plan).toMatchObject({
        code: 'STARTER',
        name: 'Starter',
        description: null,
        status: PricePlanStatus.DRAFT,
        isPublic: true,
        createdById: actor.id,
        features: [PlanFeatureCode.SMS_NOTIFICATIONS],
      });
      expect(plan.prices.map((p) => [p.billingPeriod, p.amount])).toEqual([
        [BillingPeriod.MONTHLY, '5000.00'],
        [BillingPeriod.ANNUAL, '50000.50'],
      ]);
      expect(plan.limits).toHaveLength(4);
      expect(audit.actions()).toEqual([PlatformAuditAction.PLAN_CREATED]);
      expect(audit.entries[0]!.target).toEqual({
        type: 'PRICE_PLAN',
        id: plan.id,
      });
    });

    it('rejects the same billing period twice', async () => {
      const { service, actor } = setup();
      await expectAppError(
        service.createPlan(
          actor,
          {
            code: 'X',
            name: 'X',
            prices: [
              { billingPeriod: BillingPeriod.MONTHLY, amount: '1' },
              { billingPeriod: BillingPeriod.MONTHLY, amount: '2' },
            ],
          },
          META,
        ),
        'PLAN_PRICE_DUPLICATE_PERIOD',
      );
    });

    it('rejects an incomplete limit set', async () => {
      const { service, plans, actor } = setup();
      const err = await expectAppError(
        service.createPlan(
          actor,
          { code: 'X', name: 'X', limits: FULL_LIMITS.slice(1) },
          META,
        ),
        'PLAN_LIMITS_INVALID',
      );
      expect(err.message).toContain('MAX_STAFF_USERS');
      expect(plans.plans.size).toBe(0);
    });
  });

  describe('updatePlan', () => {
    it('updates details and audits only the changed fields', async () => {
      const { service, plans, audit, actor } = setup();
      const plan = plans.seedPlan({ name: 'Old', sortOrder: 1 });

      const updated = await service.updatePlan(
        actor,
        plan.id,
        { name: ' New ', sortOrder: 1, description: 'Desc' },
        META,
      );

      expect(updated).toMatchObject({ name: 'New', description: 'Desc' });
      expect(audit.entries[0]!.metadata).toEqual({
        name: { from: 'Old', to: 'New' },
        description: { from: null, to: 'Desc' },
      });
    });

    it('does not audit a no-op update', async () => {
      const { service, plans, audit, actor } = setup();
      const plan = plans.seedPlan({ name: 'Same' });
      await service.updatePlan(actor, plan.id, { name: 'Same' }, META);
      expect(audit.entries).toHaveLength(0);
    });

    it('returns PLAN_NOT_FOUND for an unknown plan', async () => {
      const { service, actor } = setup();
      await expectAppError(
        service.updatePlan(actor, crypto.randomUUID(), { name: 'x' }, META),
        'PLAN_NOT_FOUND',
      );
    });
  });

  describe('activate', () => {
    it('activates a DRAFT plan with a price and all limits', async () => {
      const { service, plans, audit, actor } = setup();
      const plan = seedActivatable(plans);

      const activated = await service.activate(actor, plan.id, META);

      expect(activated.status).toBe(PricePlanStatus.ACTIVE);
      expect(audit.entries[0]).toMatchObject({
        action: PlatformAuditAction.PLAN_ACTIVATED,
        metadata: { status: { from: 'DRAFT', to: 'ACTIVE' } },
      });
    });

    it('restores an ARCHIVED plan and clears archivedAt', async () => {
      const { service, plans, actor } = setup();
      const plan = seedActivatable(plans);
      plans.plans.set(plan.id, {
        ...plan,
        status: PricePlanStatus.ARCHIVED,
        archivedAt: new Date(),
      });

      const restored = await service.activate(actor, plan.id, META);

      expect(restored).toMatchObject({
        status: PricePlanStatus.ACTIVE,
        archivedAt: null,
      });
    });

    it('lists every blocker when the plan is incomplete', async () => {
      const { service, plans, actor } = setup();
      const plan = plans.seedPlan();
      plans.limits.set(plan.id, FULL_LIMITS.slice(0, 2));

      const err = await expectAppError(
        service.activate(actor, plan.id, META),
        'PLAN_NOT_ACTIVATABLE',
      );
      expect(err.message).toContain('no active price');
      expect(err.message).toContain('MAX_INSTRUCTORS, MAX_VEHICLES');
      expect(plans.plans.get(plan.id)!.status).toBe(PricePlanStatus.DRAFT);
    });

    it('rejects activating an ACTIVE plan', async () => {
      const { service, plans, actor } = setup();
      const plan = plans.seedPlan({ status: PricePlanStatus.ACTIVE });
      await expectAppError(
        service.activate(actor, plan.id, META),
        'INVALID_PLAN_STATE',
      );
    });
  });

  describe('archive', () => {
    it('archives a plan and stamps archivedAt', async () => {
      const { service, plans, clock, actor } = setup();
      const plan = plans.seedPlan({ status: PricePlanStatus.ACTIVE });

      const archived = await service.archive(actor, plan.id, META);

      expect(archived).toMatchObject({
        status: PricePlanStatus.ARCHIVED,
        archivedAt: clock.now(),
      });
    });

    it('rejects archiving an ARCHIVED plan', async () => {
      const { service, plans, actor } = setup();
      const plan = plans.seedPlan({
        status: PricePlanStatus.ARCHIVED,
        archivedAt: new Date(),
      });
      await expectAppError(
        service.archive(actor, plan.id, META),
        'INVALID_PLAN_STATE',
      );
    });
  });

  describe('deletePlan', () => {
    it('deletes a DRAFT plan with its prices, limits and features', async () => {
      const { service, plans, audit, actor } = setup();
      const plan = seedActivatable(plans);

      await service.deletePlan(actor, plan.id, META);

      expect(plans.plans.has(plan.id)).toBe(false);
      expect(plans.prices.filter((p) => p.planId === plan.id)).toHaveLength(0);
      expect(audit.entries[0]).toMatchObject({
        action: PlatformAuditAction.PLAN_DELETED,
        metadata: { code: plan.code },
      });
    });

    it.each([PricePlanStatus.ACTIVE, PricePlanStatus.ARCHIVED])(
      'refuses to delete a %s plan',
      async (status) => {
        const { service, plans, actor } = setup();
        const plan = plans.seedPlan({ status });
        await expectAppError(
          service.deletePlan(actor, plan.id, META),
          'INVALID_PLAN_STATE',
        );
        expect(plans.plans.has(plan.id)).toBe(true);
      },
    );
  });

  describe('setPrice', () => {
    it('archives the previous price and creates a new one, keeping history', async () => {
      const { service, plans, audit, clock, actor } = setup();
      const plan = seedActivatable(plans);
      const previous = plans.activePrices(plan.id)[0]!;

      const updated = await service.setPrice(
        actor,
        plan.id,
        BillingPeriod.MONTHLY,
        '6000',
        META,
      );

      expect(updated.prices).toEqual([
        expect.objectContaining({ amount: '6000.00' }),
      ]);
      expect(previous).toMatchObject({
        status: PlanPriceStatus.ARCHIVED,
        archivedAt: clock.now(),
      });
      expect(audit.entries[0]).toMatchObject({
        action: PlatformAuditAction.PLAN_PRICE_SET,
        metadata: {
          billingPeriod: 'MONTHLY',
          amount: { from: '5000.00', to: '6000.00' },
          previousPriceId: previous.id,
        },
      });
    });

    it('creates the first price for a period', async () => {
      const { service, plans, actor } = setup();
      const plan = plans.seedPlan();
      const updated = await service.setPrice(
        actor,
        plan.id,
        BillingPeriod.QUARTERLY,
        '14000.00',
        META,
      );
      expect(updated.prices).toEqual([
        expect.objectContaining({
          billingPeriod: BillingPeriod.QUARTERLY,
          amount: '14000.00',
        }),
      ]);
    });

    it('is a no-op when the amount is unchanged', async () => {
      const { service, plans, audit, actor } = setup();
      const plan = seedActivatable(plans);
      await service.setPrice(
        actor,
        plan.id,
        BillingPeriod.MONTHLY,
        '5000',
        META,
      );
      expect(plans.prices).toHaveLength(1);
      expect(audit.entries).toHaveLength(0);
    });
  });

  describe('archivePrice', () => {
    it('refuses to archive the last active price of an ACTIVE plan', async () => {
      const { service, plans, actor } = setup();
      const plan = seedActivatable(plans);
      plans.plans.set(plan.id, { ...plan, status: PricePlanStatus.ACTIVE });
      const price = plans.activePrices(plan.id)[0]!;

      await expectAppError(
        service.archivePrice(actor, plan.id, price.id, META),
        'PLAN_LAST_ACTIVE_PRICE',
      );
      expect(price.status).toBe(PlanPriceStatus.ACTIVE);
    });

    it('archives the last price of a DRAFT plan', async () => {
      const { service, plans, audit, actor } = setup();
      const plan = seedActivatable(plans);
      const price = plans.activePrices(plan.id)[0]!;

      const updated = await service.archivePrice(
        actor,
        plan.id,
        price.id,
        META,
      );

      expect(updated.prices).toEqual([]);
      expect(audit.actions()).toEqual([
        PlatformAuditAction.PLAN_PRICE_ARCHIVED,
      ]);
    });

    it('does not find a price through another plan', async () => {
      const { service, plans, actor } = setup();
      const plan = seedActivatable(plans);
      const other = plans.seedPlan();
      const price = plans.activePrices(plan.id)[0]!;

      await expectAppError(
        service.archivePrice(actor, other.id, price.id, META),
        'PLAN_PRICE_NOT_FOUND',
      );
    });

    it('rejects archiving an already archived price', async () => {
      const { service, plans, actor } = setup();
      const plan = seedActivatable(plans);
      const price = plans.activePrices(plan.id)[0]!;
      price.status = PlanPriceStatus.ARCHIVED;

      await expectAppError(
        service.archivePrice(actor, plan.id, price.id, META),
        'PLAN_PRICE_ALREADY_ARCHIVED',
      );
    });
  });

  describe('setLimits', () => {
    it('replaces limits and audits from/to', async () => {
      const { service, plans, audit, actor } = setup();
      const plan = seedActivatable(plans);
      const next = FULL_LIMITS.map((l) =>
        l.code === PlanLimitCode.MAX_BRANCHES ? { ...l, value: 3 } : l,
      );

      const updated = await service.setLimits(actor, plan.id, next, META);

      expect(
        updated.limits.find((l) => l.code === PlanLimitCode.MAX_BRANCHES),
      ).toEqual({ code: PlanLimitCode.MAX_BRANCHES, value: 3 });
      expect(audit.actions()).toEqual([
        PlatformAuditAction.PLAN_LIMITS_UPDATED,
      ]);
    });

    it('rejects duplicated codes', async () => {
      const { service, plans, actor } = setup();
      const plan = plans.seedPlan();
      await expectAppError(
        service.setLimits(
          actor,
          plan.id,
          [...FULL_LIMITS, { code: PlanLimitCode.MAX_VEHICLES, value: 2 }],
          META,
        ),
        'PLAN_LIMITS_INVALID',
      );
    });

    it('does not audit identical limits given in a different order', async () => {
      const { service, plans, audit, actor } = setup();
      const plan = seedActivatable(plans);
      await service.setLimits(actor, plan.id, [...FULL_LIMITS].reverse(), META);
      expect(audit.entries).toHaveLength(0);
    });
  });

  describe('setFeatures', () => {
    it('replaces features and audits from/to', async () => {
      const { service, plans, audit, actor } = setup();
      const plan = plans.seedPlan();
      plans.features.set(plan.id, [PlanFeatureCode.API_ACCESS]);

      const updated = await service.setFeatures(
        actor,
        plan.id,
        [PlanFeatureCode.MULTI_BRANCH, PlanFeatureCode.SMS_NOTIFICATIONS],
        META,
      );

      expect(updated.features).toEqual([
        PlanFeatureCode.MULTI_BRANCH,
        PlanFeatureCode.SMS_NOTIFICATIONS,
      ]);
      expect(audit.entries[0]!.metadata).toEqual({
        features: {
          from: [PlanFeatureCode.API_ACCESS],
          to: [PlanFeatureCode.MULTI_BRANCH, PlanFeatureCode.SMS_NOTIFICATIONS],
        },
      });
    });
  });
});
