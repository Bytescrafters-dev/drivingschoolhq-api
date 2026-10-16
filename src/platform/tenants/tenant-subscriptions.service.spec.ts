import { TenantStatus } from '../../generated/prisma/enums.js';
import { META, expectAppError } from '../../../test/support/fakes.js';
import { tenancySetup } from '../../../test/support/tenancy-unit.js';

describe('TenantSubscriptionsService', () => {
  function closedTenant() {
    const ctx = tenancySetup();
    const tenant = ctx.tenants.seed({
      status: TenantStatus.CLOSED,
      closedAt: new Date(),
    });
    ctx.subscriptionRows.seed({ tenantId: tenant.id });
    return { ...ctx, tenant };
  }

  it('rejects subscription changes for a closed tenant', async () => {
    const { tenantSubscriptions, actor, tenant, subscribablePrice } =
      closedTenant();
    await expectAppError(
      tenantSubscriptions.scheduleChange(
        actor,
        tenant.id,
        { planPriceId: subscribablePrice().price.id },
        META,
      ),
      'TENANT_CLOSED',
    );
    await expectAppError(
      tenantSubscriptions.changeGracePeriod(actor, tenant.id, 3, META),
      'TENANT_CLOSED',
    );
  });

  it('never activates a change for a closed tenant', async () => {
    const { tenantSubscriptions, tenant } = closedTenant();
    expect(await tenantSubscriptions.activateDueChange(tenant.id)).toBe(false);
  });

  it('returns TENANT_NOT_FOUND for an unknown tenant', async () => {
    const { tenantSubscriptions } = tenancySetup();
    await expectAppError(
      tenantSubscriptions.listHistory(crypto.randomUUID()),
      'TENANT_NOT_FOUND',
    );
  });

  it('exposes the current billing period', async () => {
    const { tenantSubscriptions, tenants, subscriptionRows } = tenancySetup();
    const tenant = tenants.seed();
    subscriptionRows.seed({
      tenantId: tenant.id,
      startDate: new Date('2026-10-01T00:00:00.000Z'),
    });

    const view = await tenantSubscriptions.current(tenant.id);

    expect(view.currentPeriod).toMatchObject({
      inTrial: false,
      nextRenewalDate: new Date('2026-11-01T00:00:00.000Z'),
    });
  });
});
