import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from '../../common/clock/clock.js';
import type { TenantSessionRevokedReason } from '../../generated/prisma/enums.js';
import {
  TENANT_SESSION_REPOSITORY,
  type TenantSessionRepository,
} from './interfaces/tenant-session.repository.js';

/**
 * Session revocation entry points used outside tenant auth (owner management,
 * tenant close). Joins the caller's transaction.
 */
@Injectable()
export class TenantSessionsService {
  constructor(
    @Inject(TENANT_SESSION_REPOSITORY)
    private readonly sessions: TenantSessionRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  revokeAllForUser(
    tenantId: string,
    userId: string,
    reason: TenantSessionRevokedReason,
  ): Promise<number> {
    return this.sessions.revokeAllActiveForUser(
      tenantId,
      userId,
      reason,
      this.clock.now(),
    );
  }

  revokeAllForTenant(
    tenantId: string,
    reason: TenantSessionRevokedReason,
  ): Promise<number> {
    return this.sessions.revokeAllActiveForTenant(
      tenantId,
      reason,
      this.clock.now(),
    );
  }
}
