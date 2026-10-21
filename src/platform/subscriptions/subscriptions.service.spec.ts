import {
  PlanPriceStatus,
  PricePlanStatus,
  TenantSubscriptionStatus,
} from '../../generated/prisma/enums.js';
import { META, expectAppError } from '../../../test/support/fakes.js';
import { tenancySetup } from '../../../test/support/tenancy-unit.js';
import { PlatformAuditAction } from '../audit/common/platform-audit-action.js';

describe('SubscriptionsService', () => {
  describe('startSubscription', () => {
    it('starts today (Colombo) with snapshotted list price and default grace period', async () => {
      const { subscriptions, actor, subscribablePrice, audit } = tenancySetup();
      const { plan, price } = subscribablePrice();
      const tenantId = crypto.randomUUID();

      const sub = await subscriptions.startSubscription(
        actor,
        tenantId,
        { planPriceId: price.id },
        META,
      );

      expect(sub).toMatchObject({
        tenantId,
        planId: plan.id,
        planCode: plan.code,
        planName: 'Standard',
        billingPeriod: 'MONTHLY',
        listAmount: '5000.00',
        agreedAmount: '5000.00',
        discountReason: null,
        gracePeriodDays: 7,
        status: TenantSubscriptionStatus.ACTIVE,
        trialEndDate: null,
        createdById: actor.id,
      });
      expect(sub.startDate.toISOString()).toBe('2026-10-07T00:00:00.000Z');
      expect(audit.entries[0]).toMatchObject({
        action: PlatformAuditAction.SUBSCRIPTION_CREATED,
        target: { type: 'TENANT_SUBSCRIPTION', id: sub.id },
        metadata: { startDate: '2026-10-07', trialEndDate: null },
      });
    });

    it('evaluates "today" in Asia/Colombo, not UTC', async () => {
      const { subscriptions, actor, subscribablePrice, clock } = tenancySetup();
      const { price } = subscribablePrice();
      clock.current = new Date('2026-10-07T19:00:00.000Z'); // 00:30 on the 8th in Colombo

      const sub = await subscriptions.startSubscription(
        actor,
        crypto.randomUUID(),
        { planPriceId: price.id, trialEndDate: '2026-10-08' },
        META,
      );

      expect(sub.startDate.toISOString().slice(0, 10)).toBe('2026-10-08');
    });

    it('accepts a trial ending today or later', async () => {
      const { subscriptions, actor, subscribablePrice } = tenancySetup();
      const { price } = subscribablePrice();
      const sub = await subscriptions.startSubscription(
        actor,
        crypto.randomUUID(),
        { planPriceId: price.id, trialEndDate: '2026-11-06' },
        META,
      );
      expect(sub.trialEndDate?.toISOString().slice(0, 10)).toBe('2026-11-06');
    });

    it.each(['2026-10-06', '2026-02-30'])(
      'rejects trial end date %s',
      async (trialEndDate) => {
        const { subscriptions, actor, subscribablePrice } = tenancySetup();
        const { price } = subscribablePrice();
        await expectAppError(
          subscriptions.startSubscription(
            actor,
            crypto.randomUUID(),
            { planPriceId: price.id, trialEndDate },
            META,
          ),
          'INVALID_TRIAL_END_DATE',
        );
      },
    );

    it('records a discount with its reason', async () => {
      const { subscriptions, actor, subscribablePrice } = tenancySetup();
      const { price } = subscribablePrice();
      const sub = await subscriptions.startSubscription(
        actor,
        crypto.randomUUID(),
        {
          planPriceId: price.id,
          agreedAmount: '4000',
          discountReason: ' Launch partner ',
        },
        META,
      );
      expect(sub).toMatchObject({
        listAmount: '5000.00',
        agreedAmount: '4000.00',
        discountReason: 'Launch partner',
      });
    });

    it('drops a discount reason when there is no discount', async () => {
      const { subscriptions, actor, subscribablePrice } = tenancySetup();
      const { price } = subscribablePrice();
      const sub = await subscriptions.startSubscription(
        actor,
        crypto.randomUUID(),
        {
          planPriceId: price.id,
          agreedAmount: '5000',
          discountReason: 'none',
        },
        META,
      );
      expect(sub.discountReason).toBeNull();
    });

    it('requires a reason for a discount', async () => {
      const { subscriptions, actor, subscribablePrice } = tenancySetup();
      const { price } = subscribablePrice();
      await expectAppError(
        subscriptions.startSubscription(
          actor,
          crypto.randomUUID(),
          { planPriceId: price.id, agreedAmount: '4000', discountReason: ' ' },
          META,
        ),
        'DISCOUNT_REASON_REQUIRED',
      );
    });

    it('rejects an agreed amount above the list price', async () => {
      const { subscriptions, actor, subscribablePrice } = tenancySetup();
      const { price } = subscribablePrice();
      await expectAppError(
        subscriptions.startSubscription(
          actor,
          crypto.randomUUID(),
          {
            planPriceId: price.id,
            agreedAmount: '5000.01',
            discountReason: 'x',
          },
          META,
        ),
        'AGREED_AMOUNT_EXCEEDS_LIST_PRICE',
      );
    });

    it.each([-1, 91, 1.5])('rejects grace period %s', async (days) => {
      const { subscriptions, actor, subscribablePrice } = tenancySetup();
      const { price } = subscribablePrice();
      await expectAppError(
        subscriptions.startSubscription(
          actor,
          crypto.randomUUID(),
          { planPriceId: price.id, gracePeriodDays: days },
          META,
        ),
        'INVALID_GRACE_PERIOD',
      );
    });

    it.each([
      [{ planStatus: PricePlanStatus.DRAFT }],
      [{ planStatus: PricePlanStatus.ARCHIVED }],
      [{ priceStatus: PlanPriceStatus.ARCHIVED }],
    ])('refuses a non-subscribable price %j', async (overrides) => {
      const { subscriptions, actor, subscribablePrice } = tenancySetup();
      const { price } = subscribablePrice(overrides);
      await expectAppError(
        subscriptions.startSubscription(
          actor,
          crypto.randomUUID(),
          { planPriceId: price.id },
          META,
        ),
        'PLAN_NOT_SUBSCRIBABLE',
      );
    });

    it('returns PLAN_PRICE_NOT_FOUND for an unknown price', async () => {
      const { subscriptions, actor } = tenancySetup();
      await expectAppError(
        subscriptions.startSubscription(
          actor,
          crypto.randomUUID(),
          { planPriceId: crypto.randomUUID() },
          META,
        ),
        'PLAN_PRICE_NOT_FOUND',
      );
    });
  });

  describe('endAllForTenant', () => {
    it('ends the active subscription today and cancels the scheduled one', async () => {
      const { subscriptions, subscriptionRows, actor, audit, clock } =
        tenancySetup();
      const tenantId = crypto.randomUUID();
      const active = subscriptionRows.seed({ tenantId });
      const scheduled = subscriptionRows.seed({
        tenantId,
        status: TenantSubscriptionStatus.SCHEDULED,
      });

      await subscriptions.endAllForTenant(actor, tenantId, 'Closed', META);

      expect(active).toMatchObject({ status: 'ENDED' });
      expect(active.endDate?.toISOString().slice(0, 10)).toBe('2026-10-07');
      expect(scheduled).toMatchObject({
        status: 'CANCELLED',
        cancelledAt: clock.now(),
        cancelledById: actor.id,
        cancellationReason: 'Closed',
      });
      expect(audit.actions()).toEqual([
        PlatformAuditAction.SUBSCRIPTION_ENDED,
        PlatformAuditAction.SUBSCRIPTION_CANCELLED,
      ]);
    });
  });
});

describe('SubscriptionsService plan changes', () => {
  /** Tenant with an ACTIVE monthly subscription that started 2026-10-01. */
  function withActive(overrides: { trialEndDate?: Date | null } = {}) {
    const ctx = tenancySetup();
    const current = ctx.subscribablePrice();
    const tenantId = crypto.randomUUID();
    const active = ctx.subscriptionRows.seed({
      tenantId,
      planId: current.plan.id,
      planPriceId: current.price.id,
      listAmount: '5000.00',
      agreedAmount: '5000.00',
      gracePeriodDays: 10,
      startDate: new Date('2026-10-01T00:00:00.000Z'),
      trialEndDate: overrides.trialEndDate ?? null,
    });
    return { ...ctx, tenantId, active, current };
  }

  it('schedules a change for the next renewal date, keeping the current grace period', async () => {
    const { subscriptions, actor, subscribablePrice, tenantId, audit } =
      withActive();
    const next = subscribablePrice();

    const result = await subscriptions.scheduleChange(
      actor,
      tenantId,
      { planPriceId: next.price.id },
      META,
    );

    expect(result.scheduled).toMatchObject({
      status: TenantSubscriptionStatus.SCHEDULED,
      planPriceId: next.price.id,
      gracePeriodDays: 10,
      trialEndDate: null,
    });
    // Today is 2026-10-07; the period that started 2026-10-01 renews 2026-11-01.
    expect(result.scheduled!.startDate.toISOString().slice(0, 10)).toBe(
      '2026-11-01',
    );
    expect(audit.actions()).toEqual([
      PlatformAuditAction.SUBSCRIPTION_CHANGE_SCHEDULED,
    ]);
  });

  it('schedules a change during a trial for the day after the trial ends', async () => {
    const { subscriptions, actor, subscribablePrice, tenantId } = withActive({
      trialEndDate: new Date('2026-10-20T00:00:00.000Z'),
    });
    const next = subscribablePrice();

    const result = await subscriptions.scheduleChange(
      actor,
      tenantId,
      { planPriceId: next.price.id },
      META,
    );

    expect(result.scheduled!.startDate.toISOString().slice(0, 10)).toBe(
      '2026-10-21',
    );
  });

  it('replaces an existing scheduled change and audits the cancellation', async () => {
    const { subscriptions, actor, subscribablePrice, tenantId, audit } =
      withActive();
    const first = await subscriptions.scheduleChange(
      actor,
      tenantId,
      { planPriceId: subscribablePrice().price.id },
      META,
    );

    const second = await subscriptions.scheduleChange(
      actor,
      tenantId,
      { planPriceId: subscribablePrice().price.id },
      META,
    );

    expect(first.scheduled).toMatchObject({
      status: TenantSubscriptionStatus.CANCELLED,
      cancellationReason: 'Replaced by a new scheduled change',
    });
    expect(second.scheduled!.id).not.toBe(first.scheduled!.id);
    expect(audit.actions()).toEqual([
      PlatformAuditAction.SUBSCRIPTION_CHANGE_SCHEDULED,
      PlatformAuditAction.SUBSCRIPTION_CANCELLED,
      PlatformAuditAction.SUBSCRIPTION_CHANGE_SCHEDULED,
    ]);
  });

  it('allows renewing on the same price with a new discount', async () => {
    const { subscriptions, actor, tenantId, current } = withActive();
    const result = await subscriptions.scheduleChange(
      actor,
      tenantId,
      {
        planPriceId: current.price.id,
        agreedAmount: '4500',
        discountReason: 'Loyalty',
      },
      META,
    );
    expect(result.scheduled).toMatchObject({
      agreedAmount: '4500.00',
      discountReason: 'Loyalty',
    });
  });

  it('rejects a change identical to the current terms', async () => {
    const { subscriptions, actor, tenantId, current } = withActive();
    await expectAppError(
      subscriptions.scheduleChange(
        actor,
        tenantId,
        { planPriceId: current.price.id },
        META,
      ),
      'SUBSCRIPTION_CHANGE_NO_OP',
    );
  });

  it('requires an active subscription', async () => {
    const { subscriptions, actor, subscribablePrice } = tenancySetup();
    await expectAppError(
      subscriptions.scheduleChange(
        actor,
        crypto.randomUUID(),
        { planPriceId: subscribablePrice().price.id },
        META,
      ),
      'NO_ACTIVE_SUBSCRIPTION',
    );
  });

  it('cancels a scheduled change with a reason', async () => {
    const { subscriptions, actor, subscribablePrice, tenantId } = withActive();
    const { scheduled } = await subscriptions.scheduleChange(
      actor,
      tenantId,
      { planPriceId: subscribablePrice().price.id },
      META,
    );

    const result = await subscriptions.cancelScheduledChange(
      actor,
      tenantId,
      ' Customer changed mind ',
      META,
    );

    expect(result.scheduled).toBeNull();
    expect(scheduled).toMatchObject({
      status: TenantSubscriptionStatus.CANCELLED,
      cancellationReason: 'Customer changed mind',
      cancelledById: actor.id,
    });
  });

  it('reports NO_SCHEDULED_CHANGE when there is nothing to cancel', async () => {
    const { subscriptions, actor, tenantId } = withActive();
    await expectAppError(
      subscriptions.cancelScheduledChange(actor, tenantId, 'x', META),
      'NO_SCHEDULED_CHANGE',
    );
  });

  it('changes the grace period in place and audits from/to', async () => {
    const { subscriptions, actor, tenantId, active, audit } = withActive();

    await subscriptions.changeGracePeriod(actor, tenantId, 14, META);

    expect(active.gracePeriodDays).toBe(14);
    expect(audit.entries[0]).toMatchObject({
      action: PlatformAuditAction.SUBSCRIPTION_GRACE_PERIOD_CHANGED,
      target: { type: 'TENANT_SUBSCRIPTION', id: active.id },
      tenantId,
      metadata: { gracePeriodDays: { from: 10, to: 14 } },
    });
  });

  it('does not audit an unchanged grace period', async () => {
    const { subscriptions, actor, tenantId, audit } = withActive();
    await subscriptions.changeGracePeriod(actor, tenantId, 10, META);
    expect(audit.entries).toHaveLength(0);
  });

  describe('activateDueChange', () => {
    it('does nothing before the start date', async () => {
      const { subscriptions, actor, subscribablePrice, tenantId, active } =
        withActive();
      await subscriptions.scheduleChange(
        actor,
        tenantId,
        { planPriceId: subscribablePrice().price.id },
        META,
      );
      expect(await subscriptions.activateDueChange(tenantId)).toBe(false);
      expect(active.status).toBe(TenantSubscriptionStatus.ACTIVE);
    });

    it('ends the current subscription the day before and activates the scheduled one, as a system action', async () => {
      const {
        subscriptions,
        actor,
        subscribablePrice,
        tenantId,
        active,
        clock,
        audit,
      } = withActive();
      const { scheduled } = await subscriptions.scheduleChange(
        actor,
        tenantId,
        { planPriceId: subscribablePrice().price.id },
        META,
      );
      audit.entries.length = 0;
      clock.current = new Date('2026-11-01T00:10:00+05:30');

      expect(await subscriptions.activateDueChange(tenantId)).toBe(true);
      expect(await subscriptions.activateDueChange(tenantId)).toBe(false);

      expect(active.status).toBe(TenantSubscriptionStatus.ENDED);
      expect(active.endDate!.toISOString().slice(0, 10)).toBe('2026-10-31');
      expect(scheduled!.status).toBe(TenantSubscriptionStatus.ACTIVE);
      expect(audit.entries.map((e) => [e.action, e.actorAdminId])).toEqual([
        [PlatformAuditAction.SUBSCRIPTION_ENDED, null],
        [PlatformAuditAction.SUBSCRIPTION_ACTIVATED, null],
      ]);
    });
  });
});
