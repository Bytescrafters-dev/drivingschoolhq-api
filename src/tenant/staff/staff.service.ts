import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from '../../common/clock/clock.js';
import { AppError } from '../../common/errors/app-error.js';
import type { RequestMeta } from '../../common/http/request-meta.js';
import { PasswordHasher } from '../../common/security/password-hasher.js';
import { normalizeEmail } from '../../common/text/email.js';
import {
  normalizeNic,
  normalizeSriLankanPhone,
} from '../../common/text/sri-lanka.js';
import {
  BranchStatus,
  PlanLimitCode,
  TenantSessionRevokedReason,
  TenantUserBranchAccess,
  TenantUserStatus,
  type TenantRole,
} from '../../generated/prisma/enums.js';
import { TenantEntitlementsService } from '../../platform/entitlements/tenant-entitlements.service.js';
import { TransactionManager } from '../../prisma/transaction-manager.js';
import {
  TenantAuditAction,
  TenantAuditTarget,
} from '../audit/common/tenant-audit-action.js';
import { TenantAuditService } from '../audit/tenant-audit.service.js';
import type { AuthenticatedTenantUser } from '../auth/interfaces/authenticated-tenant-user.js';
import { viewerOf } from '../branches/branch-access.service.js';
import {
  BRANCH_REPOSITORY,
  type Branch,
  type BranchRepository,
} from '../branches/interfaces/branch.repository.js';
import {
  TENANT_CONTEXT_REPOSITORY,
  type TenantContextRepository,
} from '../context/interfaces/tenant-context.repository.js';
import { TenantSessionsService } from '../sessions/tenant-sessions.service.js';
import {
  STAFF_REPOSITORY,
  type StaffAccess,
  type StaffListFilter,
  type StaffMember,
  type StaffProfileChange,
  type StaffRepository,
} from './interfaces/staff.repository.js';
import { loadStaffActor, principalOf, type StaffActor } from './staff-actor.js';
import {
  assignableRoles,
  canAssignRole,
  manageDenial,
} from './staff-policy.js';

/** A staff member as seen by a particular actor. */
export interface StaffView {
  member: StaffMember;
  /** Whether this actor may change them (role, access, profile, status). */
  canManage: boolean;
}

export interface StaffOptions {
  roles: TenantRole[];
  canGrantAll: boolean;
  /** ACTIVE branches the actor may grant, oldest first. */
  branches: Branch[];
}

export interface StaffAccessInput {
  branchAccess: TenantUserBranchAccess;
  branchIds?: string[];
  defaultBranchId: string;
}

export interface CreateStaffInput extends StaffAccessInput {
  fullName: string;
  email: string;
  phone?: string | null;
  nic?: string | null;
  role: TenantRole;
  temporaryPassword: string;
}

export interface StaffProfileInput {
  fullName?: string;
  email?: string;
  phone?: string | null;
  nic?: string | null;
}

type ActorContext = StaffActor;

/**
 * Staff management inside a school (TenantUser with a non-owner role).
 * Rules live in `staff-policy.ts`; this service applies them to persisted
 * state. Invariants:
 * - ACTIVE users (owner included) never exceed MAX_STAFF_USERS when a user is
 *   created or re-enabled; disabling frees a seat; downgrades disable nobody;
 * - granted roles are below the actor's, granted access within the actor's;
 * - a SELECTED user always gets at least one ACTIVE branch and a default
 *   inside their selection;
 * - disabling, resetting the password or changing the login email ends the
 *   user's sessions. Role and access changes apply on the next request (the
 *   auth guard reloads them), so sessions stay.
 * Every write locks the tenant row first (lock order tenant → branch → users),
 * which serialises seat counting and keeps branch closes consistent.
 */
@Injectable()
export class StaffService {
  constructor(
    @Inject(STAFF_REPOSITORY) private readonly staff: StaffRepository,
    @Inject(BRANCH_REPOSITORY) private readonly branches: BranchRepository,
    @Inject(TENANT_CONTEXT_REPOSITORY)
    private readonly tenants: TenantContextRepository,
    private readonly entitlements: TenantEntitlementsService,
    private readonly sessions: TenantSessionsService,
    private readonly passwords: PasswordHasher,
    private readonly audit: TenantAuditService,
    private readonly tx: TransactionManager,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async options(actor: AuthenticatedTenantUser): Promise<StaffOptions> {
    return {
      roles: assignableRoles(actor.role),
      canGrantAll: actor.branchAccess === TenantUserBranchAccess.ALL,
      branches: await this.branches.listAccessible(viewerOf(actor), {
        includeClosed: false,
      }),
    };
  }

  async list(
    actor: AuthenticatedTenantUser,
    filter: StaffListFilter,
    page: { page: number; pageSize: number },
  ): Promise<{ items: StaffView[]; total: number }> {
    const context = await this.actorContext(actor);
    const { items, total } = await this.staff.listVisible(
      context.viewer,
      filter,
      page,
    );
    return {
      items: items.map((member) => this.view(context, member)),
      total,
    };
  }

  async get(actor: AuthenticatedTenantUser, id: string): Promise<StaffView> {
    const context = await this.actorContext(actor);
    const member = await this.staff.findVisible(context.viewer, id);
    if (!member) throw staffNotFound();
    return this.view(context, member);
  }

  async create(
    actor: AuthenticatedTenantUser,
    input: CreateStaffInput,
    meta: RequestMeta,
  ): Promise<StaffView> {
    const profile = normalizeProfile(input);
    // Hashing is slow: never inside the transaction.
    const passwordHash = await this.passwords.hash(input.temporaryPassword);
    return this.tx.run(async () => {
      await this.lockTenant(actor.tenantId);
      const context = await this.actorContext(actor);
      assertAssignable(actor.role, input.role);
      const access = await this.resolveAccess(actor, context, input);
      await this.entitlements.assertCanAdd(
        actor.tenantId,
        PlanLimitCode.MAX_STAFF_USERS,
        await this.staff.countActive(actor.tenantId),
      );
      const member = await this.staff.create({
        tenantId: actor.tenantId,
        email: profile.email!,
        fullName: profile.fullName!,
        phone: profile.phone ?? null,
        nic: profile.nic ?? null,
        role: input.role,
        passwordHash,
        createdByTenantUserId: actor.id,
        ...access,
      });
      await this.audited(actor, member, TenantAuditAction.STAFF_CREATED, meta, {
        email: member.email,
        role: member.role,
        ...accessSummary(access),
      });
      return this.view(context, member);
    });
  }

  async updateProfile(
    actor: AuthenticatedTenantUser,
    id: string,
    input: StaffProfileInput,
    meta: RequestMeta,
  ): Promise<StaffView> {
    const next = normalizeProfile(input);
    return this.tx.run(async () => {
      const { context, target } = await this.lockManageable(actor, id);
      const changes = diffProfile(target, next);
      if (Object.keys(changes).length === 0) return this.view(context, target);
      const updated = await this.staff.updateProfile(actor.tenantId, id, next);
      if (changes.email) {
        // The login identifier changed: existing sessions must sign in again.
        await this.sessions.revokeAllForUser(
          actor.tenantId,
          id,
          TenantSessionRevokedReason.EMAIL_CHANGED,
        );
      }
      await this.audited(
        actor,
        updated,
        TenantAuditAction.STAFF_UPDATED,
        meta,
        changes,
      );
      return this.view(context, updated);
    });
  }

  async changeRole(
    actor: AuthenticatedTenantUser,
    id: string,
    role: TenantRole,
    meta: RequestMeta,
  ): Promise<StaffView> {
    return this.tx.run(async () => {
      const { context, target } = await this.lockManageable(actor, id);
      assertAssignable(actor.role, role);
      if (target.role === role) return this.view(context, target);
      const updated = await this.staff.setRole(actor.tenantId, id, role);
      await this.audited(
        actor,
        updated,
        TenantAuditAction.STAFF_ROLE_CHANGED,
        meta,
        { role: { from: target.role, to: role } },
      );
      return this.view(context, updated);
    });
  }

  async setAccess(
    actor: AuthenticatedTenantUser,
    id: string,
    input: StaffAccessInput,
    meta: RequestMeta,
  ): Promise<StaffView> {
    return this.tx.run(async () => {
      const { context, target } = await this.lockManageable(actor, id);
      const access = await this.resolveAccess(actor, context, input);
      const updated = await this.staff.replaceAccess(
        actor.tenantId,
        id,
        access,
      );
      const before = accessSummary({
        branchAccess: target.branchAccess,
        branchIds: activeBranchIds(target),
        defaultBranchId: target.defaultBranchId,
      });
      const after = accessSummary(access);
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        await this.audited(
          actor,
          updated,
          TenantAuditAction.STAFF_BRANCHES_CHANGED,
          meta,
          { from: before, to: after },
        );
      }
      return this.view(context, updated);
    });
  }

  async resetPassword(
    actor: AuthenticatedTenantUser,
    id: string,
    temporaryPassword: string,
    meta: RequestMeta,
  ): Promise<StaffView> {
    const passwordHash = await this.passwords.hash(temporaryPassword);
    return this.tx.run(async () => {
      const { context } = await this.lockManageable(actor, id);
      const updated = await this.staff.setPassword(
        actor.tenantId,
        id,
        passwordHash,
      );
      await this.sessions.revokeAllForUser(
        actor.tenantId,
        id,
        TenantSessionRevokedReason.PASSWORD_RESET,
      );
      await this.audited(
        actor,
        updated,
        TenantAuditAction.STAFF_PASSWORD_RESET,
        meta,
      );
      return this.view(context, updated);
    });
  }

  async disable(
    actor: AuthenticatedTenantUser,
    id: string,
    meta: RequestMeta,
  ): Promise<StaffView> {
    return this.tx.run(async () => {
      const { context, target } = await this.lockManageable(actor, id);
      if (target.status === TenantUserStatus.DISABLED) {
        throw new AppError(
          'CONFLICT',
          'STAFF_ALREADY_DISABLED',
          'This staff member is already disabled',
        );
      }
      const updated = await this.staff.setStatus(
        actor.tenantId,
        id,
        TenantUserStatus.DISABLED,
        this.clock.now(),
      );
      await this.sessions.revokeAllForUser(
        actor.tenantId,
        id,
        TenantSessionRevokedReason.USER_DISABLED,
      );
      await this.audited(
        actor,
        updated,
        TenantAuditAction.STAFF_DISABLED,
        meta,
      );
      return this.view(context, updated);
    });
  }

  async enable(
    actor: AuthenticatedTenantUser,
    id: string,
    meta: RequestMeta,
  ): Promise<StaffView> {
    return this.tx.run(async () => {
      const { context, target } = await this.lockManageable(actor, id);
      if (target.status === TenantUserStatus.ACTIVE) {
        throw new AppError(
          'CONFLICT',
          'STAFF_ALREADY_ACTIVE',
          'This staff member is already active',
        );
      }
      await this.entitlements.assertCanAdd(
        actor.tenantId,
        PlanLimitCode.MAX_STAFF_USERS,
        await this.staff.countActive(actor.tenantId),
      );
      const updated = await this.staff.setStatus(
        actor.tenantId,
        id,
        TenantUserStatus.ACTIVE,
        null,
      );
      await this.audited(actor, updated, TenantAuditAction.STAFF_ENABLED, meta);
      return this.view(context, updated);
    });
  }

  // --- helpers ---

  /** The actor's own access, read fresh (assignments of any status). */
  private actorContext(actor: AuthenticatedTenantUser): Promise<ActorContext> {
    return loadStaffActor(this.branches, actor);
  }

  private view(context: ActorContext, member: StaffMember): StaffView {
    return {
      member,
      canManage: manageDenial(context.principal, principalOf(member)) === null,
    };
  }

  /** Locks the tenant, then the target; throws unless the actor may manage it. */
  private async lockManageable(
    actor: AuthenticatedTenantUser,
    id: string,
  ): Promise<{ context: ActorContext; target: StaffMember }> {
    await this.lockTenant(actor.tenantId);
    const context = await this.actorContext(actor);
    const target = await this.staff.lockVisible(context.viewer, id);
    if (!target) throw staffNotFound();
    const denial = manageDenial(context.principal, principalOf(target));
    if (denial === 'SELF') {
      throw new AppError(
        'FORBIDDEN',
        'CANNOT_MANAGE_SELF',
        'You cannot change your own role, branches or status',
      );
    }
    if (denial) {
      throw new AppError(
        'FORBIDDEN',
        'STAFF_MANAGEMENT_DENIED',
        denial === 'ROLE'
          ? 'You can only manage staff with a role below yours'
          : 'You can only manage staff whose branches you also have',
      );
    }
    return { context, target };
  }

  /** Validates requested access against the tenant's ACTIVE branches and the actor. */
  private async resolveAccess(
    actor: AuthenticatedTenantUser,
    context: ActorContext,
    input: StaffAccessInput,
  ): Promise<StaffAccess> {
    const active = new Set(
      (
        await this.branches.listForTenant(actor.tenantId, {
          includeClosed: false,
        })
      ).map((branch) => branch.id),
    );
    const branchIds = [...new Set(input.branchIds ?? [])];

    if (input.branchAccess === TenantUserBranchAccess.ALL) {
      if (context.principal.scope.branchAccess !== TenantUserBranchAccess.ALL) {
        throw notGrantable(
          'Only users with access to all branches can grant it',
        );
      }
      if (branchIds.length > 0) {
        throw selectionInvalid(
          'branchIds must be empty when granting access to all branches',
        );
      }
      if (!active.has(input.defaultBranchId)) {
        throw selectionInvalid('The default branch must be an active branch');
      }
      return {
        branchAccess: input.branchAccess,
        branchIds,
        defaultBranchId: input.defaultBranchId,
      };
    }

    if (branchIds.length === 0) {
      throw selectionInvalid('Select at least one branch');
    }
    if (branchIds.some((id) => !active.has(id))) {
      throw selectionInvalid('Every selected branch must be an active branch');
    }
    const actorScope = context.principal.scope;
    if (
      actorScope.branchAccess !== TenantUserBranchAccess.ALL &&
      branchIds.some((id) => !actorScope.branchIds.includes(id))
    ) {
      throw notGrantable('You can only grant branches you have access to');
    }
    if (!branchIds.includes(input.defaultBranchId)) {
      throw selectionInvalid(
        'The default branch must be one of the selected branches',
      );
    }
    return {
      branchAccess: input.branchAccess,
      branchIds,
      defaultBranchId: input.defaultBranchId,
    };
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

  private audited(
    actor: AuthenticatedTenantUser,
    member: StaffMember,
    action: TenantAuditAction,
    meta: RequestMeta,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    return this.audit.record({
      tenantId: actor.tenantId,
      actorTenantUserId: actor.id,
      action,
      target: { type: TenantAuditTarget.TENANT_USER, id: member.id },
      metadata,
      meta,
    });
  }
}

/** Whether a member can currently sign in as far as branches go. */
export function hasActiveBranch(member: StaffMember): boolean {
  return (
    member.branchAccess === TenantUserBranchAccess.ALL ||
    member.branches.some((branch) => branch.status === BranchStatus.ACTIVE)
  );
}

function activeBranchIds(member: StaffMember): string[] {
  return member.branches
    .filter((branch) => branch.status === BranchStatus.ACTIVE)
    .map((branch) => branch.id);
}

function accessSummary(access: StaffAccess) {
  return {
    branchAccess: access.branchAccess,
    branchIds: [...access.branchIds].sort(),
    defaultBranchId: access.defaultBranchId,
  };
}

function assertAssignable(actorRole: TenantRole, role: TenantRole): void {
  if (!canAssignRole(actorRole, role)) {
    throw new AppError(
      'FORBIDDEN',
      'ROLE_NOT_ASSIGNABLE',
      'You can only assign roles below your own',
    );
  }
}

/** Trims/normalises given fields; invalid phone or NIC → BAD_REQUEST. */
function normalizeProfile(input: StaffProfileInput): StaffProfileChange {
  const change: StaffProfileChange = {};
  if (input.fullName !== undefined) {
    const fullName = input.fullName.trim();
    if (!fullName) {
      throw new AppError('BAD_REQUEST', 'BAD_REQUEST', 'fullName is required');
    }
    change.fullName = fullName;
  }
  if (input.email !== undefined) change.email = normalizeEmail(input.email);
  if (input.phone !== undefined) {
    if (input.phone === null) {
      change.phone = null;
    } else {
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
  }
  if (input.nic !== undefined) {
    if (input.nic === null) {
      change.nic = null;
    } else {
      const nic = normalizeNic(input.nic);
      if (!nic) {
        throw new AppError('BAD_REQUEST', 'INVALID_NIC', 'Invalid NIC number');
      }
      change.nic = nic;
    }
  }
  return change;
}

function diffProfile(
  current: StaffMember,
  next: StaffProfileChange,
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of ['fullName', 'email', 'phone', 'nic'] as const) {
    if (next[key] !== undefined && next[key] !== current[key]) {
      changes[key] = { from: current[key], to: next[key] };
    }
  }
  return changes;
}

function staffNotFound(): AppError {
  return new AppError('NOT_FOUND', 'STAFF_NOT_FOUND', 'Staff member not found');
}

function notGrantable(message: string): AppError {
  return new AppError('FORBIDDEN', 'BRANCH_ACCESS_NOT_GRANTABLE', message);
}

function selectionInvalid(message: string): AppError {
  return new AppError('BAD_REQUEST', 'BRANCH_SELECTION_INVALID', message);
}
