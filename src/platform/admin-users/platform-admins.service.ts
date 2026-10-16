import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from '../../common/clock/clock.js';
import { AppError } from '../../common/errors/app-error.js';
import type { RequestMeta } from '../../common/http/request-meta.js';
import {
  PlatformAdminStatus,
  PlatformRole,
  PlatformSessionRevokedReason,
} from '../../generated/prisma/enums.js';
import { TransactionManager } from '../../prisma/transaction-manager.js';
import type { AuthenticatedPlatformAdmin } from '../admin-auth/interfaces/authenticated-platform-admin.js';
import { PasswordHasher } from '../../common/security/password-hasher.js';
import {
  PLATFORM_SESSION_REPOSITORY,
  type PlatformSessionRepository,
} from '../admin-auth/interfaces/platform-session.repository.js';
import {
  PlatformAuditAction,
  PlatformAuditTarget,
} from '../audit/common/platform-audit-action.js';
import { PlatformAuditService } from '../audit/platform-audit.service.js';
import type { AuditMetadata } from '../audit/interfaces/platform-audit.repository.js';
import { normalizeEmail } from '../../common/text/email.js';
import {
  PLATFORM_ADMIN_USER_REPOSITORY,
  type PlatformAdmin,
  type PlatformAdminListFilter,
  type PlatformAdminUserRepository,
} from './interfaces/platform-admin-user.repository.js';

export interface CreatePlatformAdminInput {
  email: string;
  fullName: string;
  role: PlatformRole;
  temporaryPassword: string;
}

/**
 * Use cases for managing platform admins. Invariants:
 * - an admin cannot change their own role, disable themselves or reset their own password here;
 * - at least one ACTIVE SUPER_ADMIN always remains;
 * - role change, disable and password reset revoke the target's sessions;
 * - every change is audited in the same transaction.
 */
@Injectable()
export class PlatformAdminsService {
  constructor(
    @Inject(PLATFORM_ADMIN_USER_REPOSITORY)
    private readonly admins: PlatformAdminUserRepository,
    @Inject(PLATFORM_SESSION_REPOSITORY)
    private readonly sessions: PlatformSessionRepository,
    private readonly audit: PlatformAuditService,
    private readonly passwords: PasswordHasher,
    private readonly tx: TransactionManager,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  list(
    filter: PlatformAdminListFilter,
    page: { page: number; pageSize: number },
  ) {
    return this.admins.list(filter, {
      skip: (page.page - 1) * page.pageSize,
      take: page.pageSize,
    });
  }

  async get(id: string): Promise<PlatformAdmin> {
    const admin = await this.admins.findById(id);
    if (!admin) throw notFound();
    return admin;
  }

  async createAdmin(
    actor: AuthenticatedPlatformAdmin,
    input: CreatePlatformAdminInput,
    meta: RequestMeta,
  ): Promise<PlatformAdmin> {
    const passwordHash = await this.passwords.hash(input.temporaryPassword);
    return this.tx.run(async () => {
      const admin = await this.admins.create({
        email: normalizeEmail(input.email),
        fullName: input.fullName.trim(),
        role: input.role,
        passwordHash,
        createdById: actor.id,
      });
      await this.audited(
        actor,
        admin.id,
        PlatformAuditAction.ADMIN_CREATED,
        meta,
        {
          email: admin.email,
          fullName: admin.fullName,
          role: admin.role,
        },
      );
      return admin;
    });
  }

  async updateFullName(
    actor: AuthenticatedPlatformAdmin,
    id: string,
    fullName: string,
    meta: RequestMeta,
  ): Promise<PlatformAdmin> {
    const next = fullName.trim();
    return this.tx.run(async () => {
      const target = await this.get(id);
      if (target.fullName === next) return target;
      const updated = await this.admins.updateFullName(id, next);
      await this.audited(actor, id, PlatformAuditAction.ADMIN_UPDATED, meta, {
        fullName: { from: target.fullName, to: next },
      });
      return updated;
    });
  }

  async changeRole(
    actor: AuthenticatedPlatformAdmin,
    id: string,
    role: PlatformRole,
    meta: RequestMeta,
  ): Promise<PlatformAdmin> {
    this.assertNotSelf(actor, id);
    return this.tx.run(async () => {
      const target = await this.get(id);
      if (target.role === role) return target;
      if (isActiveSuperAdmin(target)) {
        await this.assertAnotherActiveSuperAdminRemains(actor, id);
      }
      const updated = await this.admins.changeRole(id, role);
      await this.sessions.revokeAllActiveForAdmin(
        id,
        PlatformSessionRevokedReason.ROLE_CHANGED,
        this.clock.now(),
      );
      await this.audited(
        actor,
        id,
        PlatformAuditAction.ADMIN_ROLE_CHANGED,
        meta,
        {
          role: { from: target.role, to: role },
        },
      );
      return updated;
    });
  }

  async disable(
    actor: AuthenticatedPlatformAdmin,
    id: string,
    meta: RequestMeta,
  ): Promise<PlatformAdmin> {
    this.assertNotSelf(actor, id);
    return this.tx.run(async () => {
      const target = await this.get(id);
      if (target.status === PlatformAdminStatus.DISABLED) {
        throw new AppError(
          'CONFLICT',
          'PLATFORM_ADMIN_ALREADY_DISABLED',
          'Platform admin is already disabled',
        );
      }
      if (isActiveSuperAdmin(target)) {
        await this.assertAnotherActiveSuperAdminRemains(actor, id);
      }
      const now = this.clock.now();
      const updated = await this.admins.disable(id, now);
      await this.sessions.revokeAllActiveForAdmin(
        id,
        PlatformSessionRevokedReason.ADMIN_DISABLED,
        now,
      );
      await this.audited(actor, id, PlatformAuditAction.ADMIN_DISABLED, meta);
      return updated;
    });
  }

  async enable(
    actor: AuthenticatedPlatformAdmin,
    id: string,
    meta: RequestMeta,
  ): Promise<PlatformAdmin> {
    return this.tx.run(async () => {
      const target = await this.get(id);
      if (target.status === PlatformAdminStatus.ACTIVE) {
        throw new AppError(
          'CONFLICT',
          'PLATFORM_ADMIN_ALREADY_ACTIVE',
          'Platform admin is already active',
        );
      }
      const updated = await this.admins.enable(id);
      await this.audited(actor, id, PlatformAuditAction.ADMIN_ENABLED, meta);
      return updated;
    });
  }

  async resetPassword(
    actor: AuthenticatedPlatformAdmin,
    id: string,
    temporaryPassword: string,
    meta: RequestMeta,
  ): Promise<PlatformAdmin> {
    this.assertNotSelf(actor, id);
    const passwordHash = await this.passwords.hash(temporaryPassword);
    return this.tx.run(async () => {
      await this.get(id);
      const updated = await this.admins.setPassword(id, {
        passwordHash,
        mustChangePassword: true,
      });
      await this.sessions.revokeAllActiveForAdmin(
        id,
        PlatformSessionRevokedReason.PASSWORD_RESET,
        this.clock.now(),
      );
      await this.audited(
        actor,
        id,
        PlatformAuditAction.ADMIN_PASSWORD_RESET,
        meta,
      );
      return updated;
    });
  }

  private assertNotSelf(
    actor: AuthenticatedPlatformAdmin,
    targetId: string,
  ): void {
    if (actor.id === targetId) {
      throw new AppError(
        'FORBIDDEN',
        'CANNOT_MODIFY_OWN_ACCOUNT',
        'You cannot change your own role, status or password through admin management',
      );
    }
  }

  /**
   * Locks all active super admins so concurrent demotions/disables are
   * serialized, then ensures the target is not the last one. Also re-checks
   * that the actor is still an active super admin under the lock.
   */
  private async assertAnotherActiveSuperAdminRemains(
    actor: AuthenticatedPlatformAdmin,
    targetId: string,
  ): Promise<void> {
    const activeSuperAdminIds = await this.admins.lockActiveSuperAdminIds();
    if (!activeSuperAdminIds.includes(actor.id)) {
      throw new AppError(
        'FORBIDDEN',
        'PLATFORM_PERMISSION_DENIED',
        'You do not have permission to perform this action',
      );
    }
    if (activeSuperAdminIds.every((id) => id === targetId)) {
      throw new AppError(
        'CONFLICT',
        'LAST_SUPER_ADMIN',
        'At least one active super admin must remain',
      );
    }
  }

  private audited(
    actor: AuthenticatedPlatformAdmin,
    targetId: string,
    action: PlatformAuditAction,
    meta: RequestMeta,
    metadata?: AuditMetadata,
  ): Promise<void> {
    return this.audit.record({
      actorAdminId: actor.id,
      action,
      target: { type: PlatformAuditTarget.PLATFORM_ADMIN, id: targetId },
      metadata,
      meta,
    });
  }
}

function isActiveSuperAdmin(admin: PlatformAdmin): boolean {
  return (
    admin.role === PlatformRole.SUPER_ADMIN &&
    admin.status === PlatformAdminStatus.ACTIVE
  );
}

function notFound(): AppError {
  return new AppError(
    'NOT_FOUND',
    'PLATFORM_ADMIN_NOT_FOUND',
    'Platform admin not found',
  );
}
