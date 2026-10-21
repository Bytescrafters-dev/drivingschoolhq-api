import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from '../../common/clock/clock.js';
import { AppError } from '../../common/errors/app-error.js';
import type { RequestMeta } from '../../common/http/request-meta.js';
import { PasswordHasher } from '../../common/security/password-hasher.js';
import { TenantStatus } from '../../generated/prisma/enums.js';
import { TransactionManager } from '../../prisma/transaction-manager.js';
import type {
  TenantOwnerProfileChange,
  TenantUser,
} from '../../tenant/users/interfaces/tenant-user.repository.js';
import {
  type TenantOwnerProfileInput,
  TenantOwnersService,
  normalizeOwnerProfile,
} from '../../tenant/users/tenant-owners.service.js';
import type { AuthenticatedPlatformAdmin } from '../admin-auth/interfaces/authenticated-platform-admin.js';
import {
  PlatformAuditAction,
  PlatformAuditTarget,
} from '../audit/common/platform-audit-action.js';
import type { AuditMetadata } from '../audit/interfaces/platform-audit.repository.js';
import { PlatformAuditService } from '../audit/platform-audit.service.js';
import {
  TENANT_REPOSITORY,
  type TenantRepository,
} from './interfaces/tenant.repository.js';

/** Identity values that must never be written to the audit log. */
const REDACTED_FIELDS = new Set<keyof TenantOwnerProfileChange>(['nic']);

/**
 * Platform admin management of a tenant's OWNER. Each operation runs in one
 * transaction: lock tenant (reject CLOSED) → lock owner → change → audit.
 */
@Injectable()
export class TenantOwnerAdminService {
  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepository,
    private readonly owners: TenantOwnersService,
    private readonly audit: PlatformAuditService,
    private readonly passwords: PasswordHasher,
    private readonly tx: TransactionManager,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async get(tenantId: string): Promise<TenantUser> {
    if (!(await this.tenants.findById(tenantId))) throw tenantNotFound();
    const owner = await this.owners.findOwner(tenantId);
    if (!owner) {
      throw new AppError(
        'NOT_FOUND',
        'TENANT_OWNER_NOT_FOUND',
        'Tenant owner not found',
      );
    }
    return owner;
  }

  async updateProfile(
    actor: AuthenticatedPlatformAdmin,
    tenantId: string,
    input: TenantOwnerProfileInput,
    meta: RequestMeta,
  ): Promise<TenantUser> {
    const next = normalizeOwnerProfile(input);
    return this.withOwner(tenantId, async (owner) => {
      const changes = diff(owner, next);
      if (Object.keys(changes).length === 0) return owner;
      const updated = await this.owners.updateProfile(owner, next);
      await this.audited(
        actor,
        owner,
        PlatformAuditAction.TENANT_OWNER_UPDATED,
        meta,
        changes,
      );
      return updated;
    });
  }

  async resetPassword(
    actor: AuthenticatedPlatformAdmin,
    tenantId: string,
    temporaryPassword: string,
    meta: RequestMeta,
  ): Promise<TenantUser> {
    const passwordHash = await this.passwords.hash(temporaryPassword);
    return this.withOwner(tenantId, async (owner) => {
      const updated = await this.owners.resetPassword(owner, passwordHash);
      await this.audited(
        actor,
        owner,
        PlatformAuditAction.TENANT_OWNER_PASSWORD_RESET,
        meta,
      );
      return updated;
    });
  }

  async disable(
    actor: AuthenticatedPlatformAdmin,
    tenantId: string,
    meta: RequestMeta,
  ): Promise<TenantUser> {
    return this.withOwner(tenantId, async (owner) => {
      const updated = await this.owners.disable(owner, this.clock.now());
      await this.audited(
        actor,
        owner,
        PlatformAuditAction.TENANT_OWNER_DISABLED,
        meta,
      );
      return updated;
    });
  }

  async enable(
    actor: AuthenticatedPlatformAdmin,
    tenantId: string,
    meta: RequestMeta,
  ): Promise<TenantUser> {
    return this.withOwner(tenantId, async (owner) => {
      const updated = await this.owners.enable(owner);
      await this.audited(
        actor,
        owner,
        PlatformAuditAction.TENANT_OWNER_ENABLED,
        meta,
      );
      return updated;
    });
  }

  private withOwner<T>(
    tenantId: string,
    work: (owner: TenantUser) => Promise<T>,
  ): Promise<T> {
    return this.tx.run(async () => {
      const tenant = await this.tenants.lockById(tenantId);
      if (!tenant) throw tenantNotFound();
      if (tenant.status === TenantStatus.CLOSED) {
        throw new AppError(
          'CONFLICT',
          'TENANT_CLOSED',
          'A closed tenant must be reopened before its owner can be changed',
        );
      }
      return work(await this.owners.lockOwner(tenantId));
    });
  }

  private audited(
    actor: AuthenticatedPlatformAdmin,
    owner: TenantUser,
    action: PlatformAuditAction,
    meta: RequestMeta,
    changes: AuditMetadata = {},
  ): Promise<void> {
    return this.audit.record({
      actorAdminId: actor.id,
      action,
      target: { type: PlatformAuditTarget.TENANT_USER, id: owner.id },
      tenantId: owner.tenantId,
      metadata: changes,
      meta,
    });
  }
}

function diff(
  owner: TenantUser,
  next: TenantOwnerProfileChange,
): AuditMetadata {
  const changes: AuditMetadata = {};
  for (const key of Object.keys(next) as (keyof TenantOwnerProfileChange)[]) {
    if (owner[key] === next[key]) continue;
    changes[key] = REDACTED_FIELDS.has(key)
      ? 'changed'
      : { from: owner[key], to: next[key] };
  }
  return changes;
}

function tenantNotFound(): AppError {
  return new AppError('NOT_FOUND', 'TENANT_NOT_FOUND', 'Tenant not found');
}
