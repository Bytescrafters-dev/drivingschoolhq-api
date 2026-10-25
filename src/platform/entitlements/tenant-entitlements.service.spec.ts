import { PlanLimitCode } from '../../generated/prisma/enums.js';
import { expectAppError } from '../../../test/support/fakes.js';
import type { TenantEntitlementsRepository } from './interfaces/tenant-entitlements.repository.js';
import { TenantEntitlementsService } from './tenant-entitlements.service.js';

function serviceWith(value: number | null | undefined) {
  const repo: TenantEntitlementsRepository = {
    findActiveLimit: () => Promise.resolve(value),
  };
  return new TenantEntitlementsService(repo);
}

describe('TenantEntitlementsService', () => {
  const tenantId = crypto.randomUUID();
  const code = PlanLimitCode.MAX_BRANCHES;

  it('allows adding while below the limit', async () => {
    await serviceWith(3).assertCanAdd(tenantId, code, 2);
  });

  it('rejects adding at the limit', async () => {
    await expectAppError(
      serviceWith(3).assertCanAdd(tenantId, code, 3),
      'PLAN_LIMIT_REACHED',
    );
  });

  it('treats null as unlimited', async () => {
    expect(await serviceWith(null).limit(tenantId, code)).toBeNull();
    await serviceWith(null).assertCanAdd(tenantId, code, 10_000);
  });

  it('fails closed without an active subscription or limit', async () => {
    expect(await serviceWith(undefined).limit(tenantId, code)).toBe(0);
    await expectAppError(
      serviceWith(undefined).assertCanAdd(tenantId, code, 0),
      'PLAN_LIMIT_REACHED',
    );
  });
});
