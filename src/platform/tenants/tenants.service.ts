import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from '../../common/clock/clock.js';
import { AppError } from '../../common/errors/app-error.js';
import type { RequestMeta } from '../../common/http/request-meta.js';
import { PasswordHasher } from '../../common/security/password-hasher.js';
import { normalizeSriLankanPhone } from '../../common/text/sri-lanka.js';
import {
  type District,
  TenantAccessStatus,
  TenantSessionRevokedReason,
  TenantStatus,
} from '../../generated/prisma/enums.js';
import { TransactionManager } from '../../prisma/transaction-manager.js';
import { TenantSessionsService } from '../../tenant/sessions/tenant-sessions.service.js';
import type { TenantUser } from '../../tenant/users/interfaces/tenant-user.repository.js';
import { TenantOwnersService } from '../../tenant/users/tenant-owners.service.js';
import type { AuthenticatedPlatformAdmin } from '../admin-auth/interfaces/authenticated-platform-admin.js';
import {
  PlatformAuditAction,
  PlatformAuditTarget,
} from '../audit/common/platform-audit-action.js';
import type { AuditMetadata } from '../audit/interfaces/platform-audit.repository.js';
import { PlatformAuditService } from '../audit/platform-audit.service.js';
import {
  currentPeriod,
  type PeriodInfo,
} from '../subscriptions/common/billing-period.js';
import type { TenantSubscription } from '../subscriptions/interfaces/tenant-subscription.repository.js';
import {
  type SubscriptionTermsInput,
  SubscriptionsService,
} from '../subscriptions/subscriptions.service.js';
import {
  TENANT_REPOSITORY,
  type Tenant,
  type TenantAccess,
  type TenantListFilter,
  type TenantProfileChange,
  type TenantRepository,
} from './interfaces/tenant.repository.js';

export interface TenantProfileInput {
  dsCode: string;
  name: string;
  displayName: string;
  address: string;
  district: District;
  phone: string;
}

export interface TenantOwnerInput {
  fullName: string;
  email: string;
  phone: string;
  nic: string;
  temporaryPassword: string;
}

export interface CreateTenantInput {
  tenant: TenantProfileInput;
  subscription: SubscriptionTermsInput;
  owner: TenantOwnerInput;
}

export interface TenantDetails {
  tenant: Tenant;
  access: TenantAccess | null;
  subscription: TenantSubscription | null;
  scheduledSubscription: TenantSubscription | null;
  /** Billing period of the ACTIVE subscription, evaluated today. */
  currentPeriod: PeriodInfo | null;
  owner: TenantUser | null;
}

/**
 * Platform use cases for driving-school tenants. Invariants:
 * - a tenant is always created together with its ACTIVE subscription, ACTIVE
 *   access record and its single OWNER, atomically;
 * - closing ends/cancels subscriptions and signs every tenant user out, but
 *   never changes users or data;
 *   reopening starts a new subscription and restores access;
 * - CLOSED tenants cannot be edited until reopened;
 * - every change locks the tenant row and is audited in the same transaction.
 */
@Injectable()
export class TenantsService {
  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepository,
    private readonly subscriptions: SubscriptionsService,
    private readonly owners: TenantOwnersService,
    private readonly sessions: TenantSessionsService,
    private readonly audit: PlatformAuditService,
    private readonly passwords: PasswordHasher,
    private readonly tx: TransactionManager,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  list(filter: TenantListFilter, page: { page: number; pageSize: number }) {
    return this.tenants.list(filter, {
      skip: (page.page - 1) * page.pageSize,
      take: page.pageSize,
    });
  }

  async get(id: string): Promise<TenantDetails> {
    const tenant = await this.tenants.findById(id);
    if (!tenant) throw tenantNotFound();
    const [access, current, owner] = await Promise.all([
      this.tenants.findAccess(id),
      this.subscriptions.findCurrent(id),
      this.owners.findOwner(id),
    ]);
    return {
      tenant,
      access,
      subscription: current.active,
      scheduledSubscription: current.scheduled,
      currentPeriod: current.active
        ? currentPeriod(current.active, this.subscriptions.today())
        : null,
      owner,
    };
  }

  async createTenant(
    actor: AuthenticatedPlatformAdmin,
    input: CreateTenantInput,
    meta: RequestMeta,
  ): Promise<TenantDetails> {
    const profile = normalizeProfile(input.tenant);
    const passwordHash = await this.passwords.hash(
      input.owner.temporaryPassword,
    );

    const tenantId = await this.tx.run(async () => {
      const tenant = await this.tenants.create({
        ...profile,
        createdById: actor.id,
      });
      await this.tenants.createAccess(tenant.id, this.clock.now());
      await this.audited(
        actor,
        PlatformAuditTarget.TENANT,
        tenant.id,
        PlatformAuditAction.TENANT_CREATED,
        meta,
        {
          dsCode: tenant.dsCode,
          name: tenant.name,
          displayName: tenant.displayName,
          district: tenant.district,
        },
      );
      await this.subscriptions.startSubscription(
        actor,
        tenant.id,
        input.subscription,
        meta,
      );
      const owner = await this.owners.provisionOwner({
        tenantId: tenant.id,
        email: input.owner.email,
        fullName: input.owner.fullName,
        phone: input.owner.phone,
        nic: input.owner.nic,
        passwordHash,
        createdByPlatformAdminId: actor.id,
      });
      // Identity details stay out of the audit log; email identifies the owner.
      await this.audited(
        actor,
        PlatformAuditTarget.TENANT_USER,
        owner.id,
        PlatformAuditAction.TENANT_OWNER_CREATED,
        meta,
        { tenantId: tenant.id, email: owner.email },
      );
      return tenant.id;
    });
    return this.get(tenantId);
  }

  async updateProfile(
    actor: AuthenticatedPlatformAdmin,
    id: string,
    input: Partial<TenantProfileInput>,
    meta: RequestMeta,
  ): Promise<TenantDetails> {
    const next = normalizeProfileChange(input);
    await this.tx.run(async () => {
      const current = await this.lock(id);
      if (current.status === TenantStatus.CLOSED) {
        throw new AppError(
          'CONFLICT',
          'TENANT_CLOSED',
          'A closed tenant must be reopened before it can be edited',
        );
      }
      const changes = diff(current, next);
      if (Object.keys(changes).length === 0) return;
      await this.tenants.updateProfile(id, next);
      await this.audited(
        actor,
        PlatformAuditTarget.TENANT,
        id,
        PlatformAuditAction.TENANT_UPDATED,
        meta,
        changes,
      );
    });
    return this.get(id);
  }

  async close(
    actor: AuthenticatedPlatformAdmin,
    id: string,
    reason: string,
    meta: RequestMeta,
  ): Promise<TenantDetails> {
    const closeReason = requireReason(reason);
    await this.tx.run(async () => {
      const current = await this.lock(id);
      if (current.status === TenantStatus.CLOSED) {
        throw new AppError(
          'CONFLICT',
          'TENANT_ALREADY_CLOSED',
          'Tenant is already closed',
        );
      }
      await this.tenants.setStatus(id, TenantStatus.CLOSED, this.clock.now());
      await this.subscriptions.endAllForTenant(actor, id, closeReason, meta);
      await this.sessions.revokeAllForTenant(
        id,
        TenantSessionRevokedReason.TENANT_CLOSED,
      );
      await this.audited(
        actor,
        PlatformAuditTarget.TENANT,
        id,
        PlatformAuditAction.TENANT_CLOSED,
        meta,
        { reason: closeReason },
      );
    });
    return this.get(id);
  }

  async reopen(
    actor: AuthenticatedPlatformAdmin,
    id: string,
    terms: SubscriptionTermsInput,
    meta: RequestMeta,
  ): Promise<TenantDetails> {
    await this.tx.run(async () => {
      const current = await this.lock(id);
      if (current.status !== TenantStatus.CLOSED) {
        throw new AppError(
          'CONFLICT',
          'TENANT_NOT_CLOSED',
          'Only closed tenants can be reopened',
        );
      }
      const now = this.clock.now();
      await this.tenants.setStatus(id, TenantStatus.ACTIVE, null);
      const access = await this.tenants.findAccess(id);
      if (!access) {
        await this.tenants.createAccess(id, now);
      } else if (access.status !== TenantAccessStatus.ACTIVE) {
        await this.tenants.setAccessStatus(id, TenantAccessStatus.ACTIVE, now);
      }
      await this.audited(
        actor,
        PlatformAuditTarget.TENANT,
        id,
        PlatformAuditAction.TENANT_REOPENED,
        meta,
        { accessStatus: { from: access?.status ?? null, to: 'ACTIVE' } },
      );
      await this.subscriptions.startSubscription(actor, id, terms, meta);
    });
    return this.get(id);
  }

  private async lock(id: string): Promise<Tenant> {
    const tenant = await this.tenants.lockById(id);
    if (!tenant) throw tenantNotFound();
    return tenant;
  }

  private audited(
    actor: AuthenticatedPlatformAdmin,
    targetType: PlatformAuditTarget,
    targetId: string,
    action: PlatformAuditAction,
    meta: RequestMeta,
    metadata: AuditMetadata,
  ): Promise<void> {
    return this.audit.record({
      actorAdminId: actor.id,
      action,
      target: { type: targetType, id: targetId },
      metadata,
      meta,
    });
  }
}

function normalizeProfile(input: TenantProfileInput): TenantProfileInput {
  return normalizeProfileChange(input) as TenantProfileInput;
}

function normalizeProfileChange(
  input: Partial<TenantProfileInput>,
): TenantProfileChange {
  const change: TenantProfileChange = {};
  if (input.dsCode !== undefined) {
    const dsCode = input.dsCode.trim().toUpperCase();
    if (!dsCode) {
      throw new AppError(
        'BAD_REQUEST',
        'INVALID_DS_CODE',
        'DS code is required',
      );
    }
    change.dsCode = dsCode;
  }
  if (input.name !== undefined) change.name = input.name.trim();
  if (input.displayName !== undefined) {
    change.displayName = input.displayName.trim();
  }
  if (input.address !== undefined) change.address = input.address.trim();
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

function diff(current: Tenant, next: TenantProfileChange): AuditMetadata {
  const changes: AuditMetadata = {};
  for (const key of Object.keys(next) as (keyof TenantProfileChange)[]) {
    if (current[key] !== next[key]) {
      changes[key] = { from: current[key], to: next[key] };
    }
  }
  return changes;
}

function requireReason(reason: string): string {
  const trimmed = reason.trim();
  if (!trimmed) {
    throw new AppError(
      'BAD_REQUEST',
      'REASON_REQUIRED',
      'A reason is required',
    );
  }
  return trimmed;
}

function tenantNotFound(): AppError {
  return new AppError('NOT_FOUND', 'TENANT_NOT_FOUND', 'Tenant not found');
}
