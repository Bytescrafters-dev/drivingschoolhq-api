import { Inject, Injectable } from '@nestjs/common';
import type { RequestMeta } from '../../common/http/request-meta.js';
import type {
  TenantAuditAction,
  TenantAuditTarget,
} from './common/tenant-audit-action.js';
import {
  TENANT_AUDIT_REPOSITORY,
  type TenantAuditRepository,
} from './interfaces/tenant-audit.repository.js';

export interface RecordTenantAudit {
  tenantId: string;
  actorTenantUserId: string | null;
  action: TenantAuditAction;
  target?: { type: TenantAuditTarget; id: string };
  /** Context only. Never secrets or password material. */
  metadata?: Record<string, unknown>;
  meta: RequestMeta;
}

/** Operational audit of a tenant. Joins the caller's transaction. */
@Injectable()
export class TenantAuditService {
  constructor(
    @Inject(TENANT_AUDIT_REPOSITORY)
    private readonly audit: TenantAuditRepository,
  ) {}

  record(entry: RecordTenantAudit): Promise<void> {
    return this.audit.append({
      tenantId: entry.tenantId,
      actorTenantUserId: entry.actorTenantUserId,
      action: entry.action,
      targetType: entry.target?.type ?? null,
      targetId: entry.target?.id ?? null,
      metadata: entry.metadata ?? null,
      ipAddress: entry.meta.ipAddress,
      userAgent: entry.meta.userAgent,
    });
  }
}
