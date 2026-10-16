import { randomUUID } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../src/config/env.js';
import {
  type TenantSessionRevokedReason,
  TenantAccessStatus,
  TenantStatus,
} from '../../src/generated/prisma/enums.js';
import { TenantAuthService } from '../../src/tenant/auth/tenant-auth.service.js';
import {
  TENANT_TOKEN_AUDIENCE,
  TENANT_TOKEN_ISSUER,
  TenantTokenService,
} from '../../src/tenant/auth/tenant-token.service.js';
import { TenantAuditService } from '../../src/tenant/audit/tenant-audit.service.js';
import type { NewTenantAuditEntry } from '../../src/tenant/audit/interfaces/tenant-audit.repository.js';
import type {
  TenantContext,
  TenantContextRepository,
} from '../../src/tenant/context/interfaces/tenant-context.repository.js';
import type {
  NewTenantSession,
  TenantSession,
  TenantSessionRepository,
} from '../../src/tenant/sessions/interfaces/tenant-session.repository.js';
import { FakePasswordHasher, FixedClock, passthroughTx } from './fakes.js';
import { InMemoryTenantUserRepository } from './tenancy-fakes.js';

export const TEST_TENANT_SECRET = 'unit-test-tenant-secret-at-least-32-chars';

export class InMemoryTenantContextRepository implements TenantContextRepository {
  readonly rows: TenantContext[] = [];
  seed(overrides: Partial<TenantContext> = {}): TenantContext {
    const tenant: TenantContext = {
      id: randomUUID(),
      dsCode: `DS${randomUUID().slice(0, 6).toUpperCase()}`,
      displayName: 'School',
      status: TenantStatus.ACTIVE,
      accessStatus: TenantAccessStatus.ACTIVE,
      ...overrides,
    };
    this.rows.push(tenant);
    return tenant;
  }
  async findByDsCode(dsCode: string) {
    return this.rows.find((t) => t.dsCode === dsCode) ?? null;
  }
  async findById(id: string) {
    return this.rows.find((t) => t.id === id) ?? null;
  }
}

type StoredSession = TenantSession & {
  refreshTokenHash: string;
  replacedById: string | null;
};

export class InMemoryTenantSessionRepository implements TenantSessionRepository {
  readonly rows: StoredSession[] = [];

  constructor(
    private readonly users: InMemoryTenantUserRepository,
    private readonly tenants: InMemoryTenantContextRepository,
  ) {}

  async create(input: NewTenantSession) {
    const row: StoredSession = {
      id: randomUUID(),
      tenantId: input.tenantId,
      userId: input.userId,
      expiresAt: input.expiresAt,
      refreshTokenHash: input.refreshTokenHash,
      revokedAt: null,
      revokedReason: null,
      replacedById: null,
    };
    this.rows.push(row);
    return { ...row };
  }
  async findWithPrincipal(sessionId: string) {
    const session = this.rows.find((s) => s.id === sessionId);
    if (!session) return null;
    const user = this.users.rows.find((u) => u.id === session.userId)!;
    const tenant = this.tenants.rows.find((t) => t.id === session.tenantId)!;
    return {
      session: { ...session },
      principal: {
        user: {
          id: user.id,
          tenantId: user.tenantId,
          email: user.email,
          fullName: user.fullName,
          role: user.role,
          status: user.status,
          mustChangePassword: user.mustChangePassword,
        },
        tenant: { id: tenant.id, status: tenant.status },
      },
    };
  }
  async findByRefreshTokenHash(hash: string) {
    const row = this.rows.find((s) => s.refreshTokenHash === hash);
    return row ? { ...row } : null;
  }
  async revokeIfActive(
    id: string,
    reason: TenantSessionRevokedReason,
    at: Date,
    replacedById?: string,
  ) {
    const s = this.rows.find((r) => r.id === id);
    if (!s || s.revokedAt) return false;
    Object.assign(s, {
      revokedAt: at,
      revokedReason: reason,
      replacedById: replacedById ?? null,
    });
    return true;
  }
  async revokeAllActiveForUser(
    tenantId: string,
    userId: string,
    reason: TenantSessionRevokedReason,
    at: Date,
    exceptSessionId?: string,
  ) {
    let count = 0;
    for (const s of this.rows) {
      if (
        s.tenantId === tenantId &&
        s.userId === userId &&
        !s.revokedAt &&
        s.id !== exceptSessionId
      ) {
        Object.assign(s, { revokedAt: at, revokedReason: reason });
        count++;
      }
    }
    return count;
  }
  async revokeAllActiveForTenant(
    tenantId: string,
    reason: TenantSessionRevokedReason,
    at: Date,
  ) {
    let count = 0;
    for (const s of this.rows) {
      if (s.tenantId === tenantId && !s.revokedAt) {
        Object.assign(s, { revokedAt: at, revokedReason: reason });
        count++;
      }
    }
    return count;
  }
  activeFor(userId: string) {
    return this.rows.filter((s) => s.userId === userId && !s.revokedAt);
  }
}

export class FakeTenantAuditRepository {
  readonly entries: NewTenantAuditEntry[] = [];
  async append(entry: NewTenantAuditEntry) {
    this.entries.push(entry);
  }
  actions() {
    return this.entries.map((e) => e.action);
  }
}

export function tenantTokenService(
  secret = TEST_TENANT_SECRET,
): TenantTokenService {
  const jwt = new JwtService({
    secret,
    signOptions: {
      algorithm: 'HS256',
      audience: TENANT_TOKEN_AUDIENCE,
      issuer: TENANT_TOKEN_ISSUER,
    },
    verifyOptions: {
      algorithms: ['HS256'],
      audience: TENANT_TOKEN_AUDIENCE,
      issuer: TENANT_TOKEN_ISSUER,
    },
  });
  const config = {
    get: (key: keyof Env) =>
      ({
        TENANT_ACCESS_TOKEN_TTL_SECONDS: 900,
        TENANT_REFRESH_TOKEN_TTL_DAYS: 7,
      })[key as 'TENANT_ACCESS_TOKEN_TTL_SECONDS'],
  } as unknown as ConfigService<Env, true>;
  return new TenantTokenService(jwt, config);
}

export function tenantAuthSetup() {
  const tenants = new InMemoryTenantContextRepository();
  const users = new InMemoryTenantUserRepository();
  const sessions = new InMemoryTenantSessionRepository(users, tenants);
  const auditRepo = new FakeTenantAuditRepository();
  const hasher = new FakePasswordHasher();
  const clock = new FixedClock();
  const tokens = tenantTokenService();
  const service = new TenantAuthService(
    tenants,
    users,
    sessions,
    tokens,
    hasher.asHasher(),
    new TenantAuditService(auditRepo),
    passthroughTx,
    clock,
  );
  return {
    tenants,
    users,
    sessions,
    auditRepo,
    hasher,
    clock,
    tokens,
    service,
  };
}
