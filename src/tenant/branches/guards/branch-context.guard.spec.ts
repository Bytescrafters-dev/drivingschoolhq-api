import type { ExecutionContext } from '@nestjs/common';
import {
  BranchStatus,
  TenantRole,
  TenantUserBranchAccess,
} from '../../../generated/prisma/enums.js';
import { InMemoryBranchRepository } from '../../../../test/support/branch-fakes.js';
import { expectAppError } from '../../../../test/support/fakes.js';
import type { AuthenticatedTenantUser } from '../../auth/interfaces/authenticated-tenant-user.js';
import { BranchAccessService } from '../branch-access.service.js';
import type { BranchScopedRequest } from '../interfaces/working-branch.js';
import { BranchContextGuard } from './branch-context.guard.js';

function setup() {
  const branches = new InMemoryBranchRepository();
  const guard = new BranchContextGuard(new BranchAccessService(branches));
  const tenantId = crypto.randomUUID();
  const main = branches.seed({ tenantId, name: 'Main Branch' });
  const kandy = branches.seed({ tenantId, name: 'Kandy' });
  const closed = branches.seed({
    tenantId,
    name: 'Old',
    status: BranchStatus.CLOSED,
    closedAt: new Date(),
  });
  const foreign = branches.seed({ tenantId: crypto.randomUUID() });

  function user(
    branchAccess: TenantUserBranchAccess,
    assigned: string[] = [],
  ): AuthenticatedTenantUser {
    const id = crypto.randomUUID();
    branches.assign(tenantId, id, ...assigned);
    return {
      id,
      tenantId,
      email: 'u@school.lk',
      fullName: 'U',
      role: TenantRole.FRONT_DESK,
      sessionId: crypto.randomUUID(),
      mustChangePassword: false,
      branchAccess,
      defaultBranchId: assigned[0] ?? main.id,
    };
  }

  async function run(
    tenantUser: AuthenticatedTenantUser | undefined,
    header?: string | string[],
  ) {
    const request = {
      headers: header === undefined ? {} : { 'x-branch-id': header },
      tenantUser,
    } as unknown as BranchScopedRequest;
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    await guard.canActivate(context);
    return request.branch;
  }

  return { main, kandy, closed, foreign, user, run, tenantId };
}

describe('BranchContextGuard', () => {
  it('resolves an accessible active branch for ALL and SELECTED users', async () => {
    const { main, kandy, user, run, tenantId } = setup();
    expect(await run(user(TenantUserBranchAccess.ALL), kandy.id)).toEqual({
      id: kandy.id,
      tenantId,
      name: 'Kandy',
    });
    expect(
      await run(user(TenantUserBranchAccess.SELECTED, [main.id]), main.id),
    ).toMatchObject({ id: main.id });
  });

  it('requires the header', async () => {
    const { user, run } = setup();
    await expectAppError(
      run(user(TenantUserBranchAccess.ALL)),
      'BRANCH_REQUIRED',
    );
    await expectAppError(
      run(user(TenantUserBranchAccess.ALL), '  '),
      'BRANCH_REQUIRED',
    );
  });

  it('gives the same answer for unassigned, closed, foreign, unknown and malformed branches', async () => {
    const { main, kandy, closed, foreign, user, run } = setup();
    const selected = user(TenantUserBranchAccess.SELECTED, [main.id]);
    const all = user(TenantUserBranchAccess.ALL);
    for (const [who, branchId] of [
      [selected, kandy.id],
      [all, closed.id],
      [all, foreign.id],
      [all, crypto.randomUUID()],
      [all, 'not-a-uuid'],
    ] as const) {
      await expectAppError(run(who, branchId), 'BRANCH_ACCESS_DENIED');
    }
    await expectAppError(run(all, [main.id, kandy.id]), 'BRANCH_REQUIRED');
  });

  it('requires authentication first', async () => {
    const { main, run } = setup();
    await expectAppError(run(undefined, main.id), 'AUTHENTICATION_REQUIRED');
  });
});
