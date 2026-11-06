import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from '../../common/clock/clock.js';
import { AppError } from '../../common/errors/app-error.js';
import type { RequestMeta } from '../../common/http/request-meta.js';
import { normalizeSriLankanPhone } from '../../common/text/sri-lanka.js';
import {
  BranchStatus,
  type District,
  PlanLimitCode,
  TenantSessionRevokedReason,
  TenantUserBranchAccess,
} from '../../generated/prisma/enums.js';
import { TenantEntitlementsService } from '../../platform/entitlements/tenant-entitlements.service.js';
import { TransactionManager } from '../../prisma/transaction-manager.js';
import {
  TenantAuditAction,
  TenantAuditTarget,
} from '../audit/common/tenant-audit-action.js';
import { TenantAuditService } from '../audit/tenant-audit.service.js';
import type { AuthenticatedTenantUser } from '../auth/interfaces/authenticated-tenant-user.js';
import {
  TENANT_CONTEXT_REPOSITORY,
  type TenantContextRepository,
} from '../context/interfaces/tenant-context.repository.js';
import { TenantSessionsService } from '../sessions/tenant-sessions.service.js';
import { BranchAccessService, viewerOf } from './branch-access.service.js';
import {
  BRANCH_REPOSITORY,
  type Branch,
  type BranchDetails,
  type BranchDetailsChange,
  type BranchRepository,
  type ExclusiveBranchUser,
} from './interfaces/branch.repository.js';
import {
  BranchProfileReader,
  type BranchProfileSummary,
} from './profile/branch-profile-reader.service.js';

export interface BranchListItem {
  branch: Branch;
  isDefault: boolean;
  profile: BranchProfileSummary;
}

export interface BranchDetailsView {
  branch: Branch;
  profile: BranchProfileSummary;
}

export interface ClosedBranch {
  branch: Branch;
  /**
   * Active SELECTED staff whose only ACTIVE branch this was. They are signed
   * out and cannot sign in until a branch of theirs is reopened or they are
   * given another one.
   */
  lockedOutStaff: ExclusiveBranchUser[];
}

/**
 * Branch use cases inside a school. Invariants:
 * - a tenant always keeps at least one ACTIVE branch;
 * - ACTIVE branches never exceed the plan's MAX_BRANCHES when created or
 *   reopened (a downgrade never closes existing branches);
 * - users only see and manage branches they can access; a SELECTED creator is
 *   assigned to the branch they create;
 * - closing a branch signs out staff for whom it was the only ACTIVE branch
 *   (they cannot sign in until it reopens); defaults pointing at a closed
 *   branch move to another accessible branch.
 * Create/close/reopen lock the tenant row (lock order: tenant → branch → users);
 * every change is audited in the same transaction.
 */
@Injectable()
export class BranchesService {
  constructor(
    @Inject(BRANCH_REPOSITORY) private readonly branches: BranchRepository,
    @Inject(TENANT_CONTEXT_REPOSITORY)
    private readonly tenants: TenantContextRepository,
    private readonly access: BranchAccessService,
    private readonly entitlements: TenantEntitlementsService,
    private readonly audit: TenantAuditService,
    private readonly tx: TransactionManager,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly sessions: TenantSessionsService,
    private readonly profiles: BranchProfileReader,
  ) {}

  async list(
    actor: AuthenticatedTenantUser,
    includeClosed: boolean,
  ): Promise<BranchListItem[]> {
    const [branches, mine] = await Promise.all([
      this.branches.listAccessible(viewerOf(actor), { includeClosed }),
      this.access.myBranches(actor),
    ]);
    const profiles = await this.profiles.summaries(actor.tenantId, branches);
    return branches.map((branch) => ({
      branch,
      isDefault: branch.id === mine.defaultBranchId,
      profile: profiles.get(branch.id)!,
    }));
  }

  /** The branch with its profile summary (grade, licence, readiness). */
  async details(
    actor: AuthenticatedTenantUser,
    branchId: string,
  ): Promise<BranchDetailsView> {
    const branch = await this.get(actor, branchId);
    const profiles = await this.profiles.summaries(actor.tenantId, [branch]);
    return { branch, profile: profiles.get(branch.id)! };
  }

  async get(actor: AuthenticatedTenantUser, branchId: string): Promise<Branch> {
    const branch = await this.branches.findAccessible(
      viewerOf(actor),
      branchId,
    );
    if (!branch) throw branchNotFound();
    return branch;
  }

  async create(
    actor: AuthenticatedTenantUser,
    input: BranchDetails,
    meta: RequestMeta,
  ): Promise<Branch> {
    const details = normalizeDetails(input) as BranchDetails;
    return this.tx.run(async () => {
      await this.lockTenant(actor.tenantId);
      await this.entitlements.assertCanAdd(
        actor.tenantId,
        PlanLimitCode.MAX_BRANCHES,
        await this.branches.countActive(actor.tenantId),
      );
      const branch = await this.branches.create({
        ...details,
        tenantId: actor.tenantId,
        createdByTenantUserId: actor.id,
      });
      if (actor.branchAccess === TenantUserBranchAccess.SELECTED) {
        await this.branches.assignUser(actor.tenantId, actor.id, branch.id);
      }
      await this.audited(
        actor,
        branch,
        TenantAuditAction.BRANCH_CREATED,
        meta,
        {
          ...details,
          assignedCreator:
            actor.branchAccess === TenantUserBranchAccess.SELECTED,
        },
      );
      return branch;
    });
  }

  async update(
    actor: AuthenticatedTenantUser,
    branchId: string,
    input: Partial<BranchDetails>,
    meta: RequestMeta,
  ): Promise<Branch> {
    const next = normalizeDetails(input);
    return this.tx.run(async () => {
      const current = await this.lockAccessible(actor, branchId);
      if (current.status === BranchStatus.CLOSED) {
        throw new AppError(
          'CONFLICT',
          'BRANCH_CLOSED',
          'A closed branch must be reopened before it can be edited',
        );
      }
      const changes = diff(current, next);
      if (Object.keys(changes).length === 0) return current;
      const updated = await this.branches.updateDetails(
        actor.tenantId,
        branchId,
        next,
      );
      await this.audited(
        actor,
        updated,
        TenantAuditAction.BRANCH_UPDATED,
        meta,
        changes,
      );
      return updated;
    });
  }

  async close(
    actor: AuthenticatedTenantUser,
    branchId: string,
    meta: RequestMeta,
  ): Promise<ClosedBranch> {
    return this.tx.run(async () => {
      await this.lockTenant(actor.tenantId);
      const current = await this.lockAccessible(actor, branchId);
      if (current.status === BranchStatus.CLOSED) {
        throw new AppError(
          'CONFLICT',
          'BRANCH_ALREADY_CLOSED',
          'The branch is already closed',
        );
      }
      if ((await this.branches.countActive(actor.tenantId)) <= 1) {
        throw new AppError(
          'CONFLICT',
          'LAST_ACTIVE_BRANCH',
          'A school must keep at least one active branch',
        );
      }
      // Who loses their last ACTIVE branch (computed before the status flips).
      const lockedOutStaff = await this.branches.findExclusiveUsers(
        actor.tenantId,
        branchId,
      );
      const closed = await this.branches.setStatus(
        actor.tenantId,
        branchId,
        BranchStatus.CLOSED,
        this.clock.now(),
      );
      const reassignedDefaults = await this.branches.reassignDefaults(
        actor.tenantId,
        branchId,
      );
      for (const user of lockedOutStaff) {
        await this.sessions.revokeAllForUser(
          actor.tenantId,
          user.id,
          TenantSessionRevokedReason.NO_ACTIVE_BRANCH,
        );
      }
      await this.audited(actor, closed, TenantAuditAction.BRANCH_CLOSED, meta, {
        reassignedDefaults,
        lockedOutUserIds: lockedOutStaff.map((user) => user.id),
      });
      return { branch: closed, lockedOutStaff };
    });
  }

  async reopen(
    actor: AuthenticatedTenantUser,
    branchId: string,
    meta: RequestMeta,
  ): Promise<Branch> {
    return this.tx.run(async () => {
      await this.lockTenant(actor.tenantId);
      const current = await this.lockAccessible(actor, branchId);
      if (current.status === BranchStatus.ACTIVE) {
        throw new AppError(
          'CONFLICT',
          'BRANCH_NOT_CLOSED',
          'Only closed branches can be reopened',
        );
      }
      await this.entitlements.assertCanAdd(
        actor.tenantId,
        PlanLimitCode.MAX_BRANCHES,
        await this.branches.countActive(actor.tenantId),
      );
      const reopened = await this.branches.setStatus(
        actor.tenantId,
        branchId,
        BranchStatus.ACTIVE,
        null,
      );
      await this.audited(
        actor,
        reopened,
        TenantAuditAction.BRANCH_REOPENED,
        meta,
      );
      return reopened;
    });
  }

  /** Sets the branch the user starts in after login. */
  async setMyDefault(
    actor: AuthenticatedTenantUser,
    branchId: string,
    meta: RequestMeta,
  ): Promise<Branch> {
    return this.tx.run(async () => {
      const branch = await this.get(actor, branchId);
      if (branch.status === BranchStatus.CLOSED) {
        throw new AppError(
          'CONFLICT',
          'BRANCH_CLOSED',
          'A closed branch cannot be the default branch',
        );
      }
      if (actor.defaultBranchId === branchId) return branch;
      await this.branches.setUserDefault(actor.tenantId, actor.id, branchId);
      await this.audit.record({
        tenantId: actor.tenantId,
        actorTenantUserId: actor.id,
        action: TenantAuditAction.DEFAULT_BRANCH_CHANGED,
        target: { type: TenantAuditTarget.TENANT_USER, id: actor.id },
        branchId,
        metadata: {
          defaultBranchId: { from: actor.defaultBranchId, to: branchId },
        },
        meta,
      });
      return branch;
    });
  }

  private async lockTenant(tenantId: string): Promise<void> {
    if (!(await this.tenants.lockById(tenantId))) {
      throw new AppError(
        'UNAUTHORIZED',
        'SESSION_INVALID',
        'Session is no longer valid',
      );
    }
  }

  private async lockAccessible(
    actor: AuthenticatedTenantUser,
    branchId: string,
  ): Promise<Branch> {
    const branch = await this.branches.lockAccessible(
      viewerOf(actor),
      branchId,
    );
    if (!branch) throw branchNotFound();
    return branch;
  }

  private audited(
    actor: AuthenticatedTenantUser,
    branch: Branch,
    action: TenantAuditAction,
    meta: RequestMeta,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    return this.audit.record({
      tenantId: actor.tenantId,
      actorTenantUserId: actor.id,
      action,
      target: { type: TenantAuditTarget.BRANCH, id: branch.id },
      branchId: branch.id,
      metadata,
      meta,
    });
  }
}

function normalizeDetails(input: Partial<BranchDetails>): BranchDetailsChange {
  const change: BranchDetailsChange = {};
  if (input.name !== undefined) change.name = requireText(input.name, 'name');
  if (input.address !== undefined) {
    change.address = requireText(input.address, 'address');
  }
  if (input.district !== undefined) change.district = input.district;
  if (input.phone !== undefined) {
    const phone = normalizeSriLankanPhone(input.phone);
    if (!phone) {
      throw new AppError(
        'BAD_REQUEST',
        'INVALID_PHONE',
        'Invalid phone number',
      );
    }
    change.phone = phone;
  }
  return change;
}

function requireText(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new AppError('BAD_REQUEST', 'BAD_REQUEST', `${field} is required`);
  }
  return trimmed;
}

function diff(
  current: Branch,
  next: BranchDetailsChange,
): Record<string, { from: string | District; to: string | District }> {
  const changes: Record<
    string,
    { from: string | District; to: string | District }
  > = {};
  for (const key of Object.keys(next) as (keyof BranchDetailsChange)[]) {
    if (current[key] !== next[key]) {
      changes[key] = { from: current[key], to: next[key]! };
    }
  }
  return changes;
}

function branchNotFound(): AppError {
  return new AppError('NOT_FOUND', 'BRANCH_NOT_FOUND', 'Branch not found');
}
