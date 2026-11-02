import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error.js';
import type { RequestMeta } from '../../common/http/request-meta.js';
import { TenantRole } from '../../generated/prisma/enums.js';
import { TransactionManager } from '../../prisma/transaction-manager.js';
import {
  TenantAuditAction,
  TenantAuditTarget,
} from '../audit/common/tenant-audit-action.js';
import { TenantAuditService } from '../audit/tenant-audit.service.js';
import type { AuthenticatedTenantUser } from '../auth/interfaces/authenticated-tenant-user.js';
import {
  TENANT_USER_REPOSITORY,
  type OwnProfileChange,
  type TenantUser,
  type TenantUserRepository,
} from '../users/interfaces/tenant-user.repository.js';

/**
 * A signed-in user's own profile (any role, including the OWNER). Only the
 * name and phone are self-service: the email is the login identifier and the
 * NIC an identity document, so managers (or the platform, for the owner)
 * change those. Passwords change through tenant auth.
 */
@Injectable()
export class MyProfileService {
  constructor(
    @Inject(TENANT_USER_REPOSITORY)
    private readonly users: TenantUserRepository,
    private readonly audit: TenantAuditService,
    private readonly tx: TransactionManager,
  ) {}

  async update(
    actor: AuthenticatedTenantUser,
    input: OwnProfileChange,
    meta: RequestMeta,
  ): Promise<TenantUser> {
    const next: OwnProfileChange = {};
    if (input.fullName !== undefined) {
      const fullName = input.fullName.trim();
      if (!fullName) {
        throw new AppError(
          'BAD_REQUEST',
          'BAD_REQUEST',
          'fullName is required',
        );
      }
      next.fullName = fullName;
    }
    if (input.phone !== undefined) {
      if (input.phone === null && actor.role === TenantRole.OWNER) {
        throw new AppError(
          'BAD_REQUEST',
          'PHONE_REQUIRED',
          'The school owner must keep a phone number',
        );
      }
      next.phone = input.phone;
    }

    return this.tx.run(async () => {
      const current = await this.users.findById(actor.tenantId, actor.id);
      if (!current) {
        throw new AppError(
          'UNAUTHORIZED',
          'SESSION_INVALID',
          'Session is no longer valid',
        );
      }
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      for (const key of ['fullName', 'phone'] as const) {
        if (next[key] !== undefined && next[key] !== current[key]) {
          changes[key] = { from: current[key], to: next[key] };
        }
      }
      if (Object.keys(changes).length === 0) return current;
      const updated = await this.users.updateOwnProfile(
        actor.tenantId,
        actor.id,
        next,
      );
      await this.audit.record({
        tenantId: actor.tenantId,
        actorTenantUserId: actor.id,
        action: TenantAuditAction.PROFILE_UPDATED,
        target: { type: TenantAuditTarget.TENANT_USER, id: actor.id },
        metadata: changes,
        meta,
      });
      return updated;
    });
  }
}
