import type {
  PlatformAuditAction,
  PlatformAuditTarget,
} from '../common/platform-audit-action.js';

export const PLATFORM_AUDIT_REPOSITORY = Symbol('PLATFORM_AUDIT_REPOSITORY');

export type AuditMetadata = Record<string, unknown>;

export interface NewPlatformAuditEntry {
  actorAdminId: string | null;
  action: PlatformAuditAction;
  targetType: PlatformAuditTarget | null;
  targetId: string | null;
  metadata: AuditMetadata | null;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface PlatformAuditEntry {
  id: string;
  actorAdminId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
}

export interface AuditCursor {
  createdAt: Date;
  id: string;
}

export interface PlatformAuditFilter {
  actorAdminId?: string;
  action?: string;
  targetType?: string;
  targetId?: string;
  from?: Date;
  to?: Date;
}

/** Append-only: there is intentionally no update or delete operation. */
export interface PlatformAuditRepository {
  append(entry: NewPlatformAuditEntry): Promise<void>;
  listNewestFirst(
    filter: PlatformAuditFilter,
    after: AuditCursor | null,
    limit: number,
  ): Promise<PlatformAuditEntry[]>;
}
