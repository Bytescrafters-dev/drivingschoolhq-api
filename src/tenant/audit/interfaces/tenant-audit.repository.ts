import type {
  TenantAuditAction,
  TenantAuditTarget,
} from '../common/tenant-audit-action.js';

export const TENANT_AUDIT_REPOSITORY = Symbol('TENANT_AUDIT_REPOSITORY');

export interface NewTenantAuditEntry {
  tenantId: string;
  actorTenantUserId: string | null;
  action: TenantAuditAction;
  targetType: TenantAuditTarget | null;
  targetId: string | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
}

/** Append-only: there is intentionally no update or delete operation. */
export interface TenantAuditRepository {
  append(entry: NewTenantAuditEntry): Promise<void>;
}
