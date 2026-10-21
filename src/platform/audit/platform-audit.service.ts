import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error.js';
import type { RequestMeta } from '../../common/http/request-meta.js';
import type {
  PlatformAuditAction,
  PlatformAuditTarget,
} from './common/platform-audit-action.js';
import {
  PLATFORM_AUDIT_REPOSITORY,
  type AuditCursor,
  type AuditMetadata,
  type PlatformAuditEntry,
  type PlatformAuditFilter,
  type PlatformAuditRepository,
} from './interfaces/platform-audit.repository.js';

export interface RecordPlatformAudit {
  actorAdminId: string | null;
  action: PlatformAuditAction;
  target?: { type: PlatformAuditTarget; id: string };
  /**
   * Tenant the action concerns. Required (DB CHECK) for TENANT,
   * TENANT_SUBSCRIPTION and TENANT_USER targets.
   */
  tenantId?: string | null;
  metadata?: AuditMetadata;
  meta: RequestMeta;
}

export interface PlatformAuditPage {
  items: PlatformAuditEntry[];
  nextCursor: string | null;
}

@Injectable()
export class PlatformAuditService {
  constructor(
    @Inject(PLATFORM_AUDIT_REPOSITORY)
    private readonly audit: PlatformAuditRepository,
  ) {}

  /** Joins the caller's transaction when invoked inside TransactionManager.run(). */
  record(entry: RecordPlatformAudit): Promise<void> {
    return this.audit.append({
      actorAdminId: entry.actorAdminId,
      action: entry.action,
      targetType: entry.target?.type ?? null,
      targetId: entry.target?.id ?? null,
      tenantId: entry.tenantId ?? null,
      metadata: entry.metadata ?? null,
      ipAddress: entry.meta.ipAddress,
      userAgent: entry.meta.userAgent,
    });
  }

  async list(
    filter: PlatformAuditFilter,
    cursor: string | undefined,
    limit: number,
  ): Promise<PlatformAuditPage> {
    const rows = await this.audit.listNewestFirst(
      filter,
      cursor ? decodeCursor(cursor) : null,
      limit + 1,
    );
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        hasMore && last
          ? encodeCursor({ createdAt: last.createdAt, id: last.id })
          : null,
    };
  }
}

function encodeCursor(cursor: AuditCursor): string {
  return Buffer.from(
    JSON.stringify({ c: cursor.createdAt.toISOString(), i: cursor.id }),
  ).toString('base64url');
}

function decodeCursor(raw: string): AuditCursor {
  try {
    const parsed = JSON.parse(
      Buffer.from(raw, 'base64url').toString('utf8'),
    ) as {
      c?: unknown;
      i?: unknown;
    };
    const createdAt = typeof parsed.c === 'string' ? new Date(parsed.c) : null;
    if (
      !createdAt ||
      Number.isNaN(createdAt.getTime()) ||
      typeof parsed.i !== 'string'
    ) {
      throw new Error('malformed');
    }
    return { createdAt, id: parsed.i };
  } catch {
    throw new AppError(
      'BAD_REQUEST',
      'INVALID_CURSOR',
      'Invalid pagination cursor',
    );
  }
}
