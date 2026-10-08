import { randomUUID } from 'node:crypto';
import type { Clock } from '../../src/common/clock/clock.js';
import {
  PlatformAdminStatus,
  PlatformRole,
  type PlatformSessionRevokedReason,
} from '../../src/generated/prisma/enums.js';
import type { TransactionManager } from '../../src/prisma/transaction-manager.js';
import type { AuthenticatedPlatformAdmin } from '../../src/platform/admin-auth/interfaces/authenticated-platform-admin.js';
import type { PasswordHasher } from '../../src/platform/admin-auth/common/password-hasher.js';
import type {
  NewPlatformSession,
  PlatformSession,
  PlatformSessionRepository,
  SessionAdmin,
} from '../../src/platform/admin-auth/interfaces/platform-session.repository.js';
import type {
  NewPlatformAdmin,
  PlatformAdmin,
  PlatformAdminCredentials,
  PlatformAdminUserRepository,
} from '../../src/platform/admin-users/interfaces/platform-admin-user.repository.js';
import type { RecordPlatformAudit } from '../../src/platform/audit/platform-audit.service.js';
import type { PlatformAuditService } from '../../src/platform/audit/platform-audit.service.js';
import { AppError } from '../../src/common/errors/app-error.js';
import { permissionsForRole } from '../../src/platform/permissions/role-permissions.js';
import type { RequestMeta } from '../../src/common/http/request-meta.js';

export const META: RequestMeta = {
  ipAddress: '127.0.0.1',
  userAgent: 'vitest',
};

export class FixedClock implements Clock {
  constructor(public current = new Date('2026-10-07T10:00:00.000Z')) {}
  now(): Date {
    return new Date(this.current);
  }
  advanceMs(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

/** Runs work directly; unit tests do not exercise real transactions. */
export const passthroughTx = {
  run: <T>(work: () => Promise<T>) => work(),
} as unknown as TransactionManager;

/** Deterministic, fast stand-in: hash(p) = "hashed:" + p. */
export class FakePasswordHasher {
  dummyVerifications = 0;
  async hash(password: string) {
    return `hashed:${password}`;
  }
  async verify(hash: string, password: string) {
    return hash === `hashed:${password}`;
  }
  async verifyAgainstDummy() {
    this.dummyVerifications++;
  }
  asHasher(): PasswordHasher {
    return this as unknown as PasswordHasher;
  }
}

export class FakeAuditService {
  readonly entries: RecordPlatformAudit[] = [];
  async record(entry: RecordPlatformAudit) {
    this.entries.push(entry);
  }
  actions(): string[] {
    return this.entries.map((e) => e.action);
  }
  asService(): PlatformAuditService {
    return this as unknown as PlatformAuditService;
  }
}

interface StoredAdmin {
  admin: PlatformAdmin;
  passwordHash: string;
}

export class InMemoryAdminRepository implements PlatformAdminUserRepository {
  readonly rows = new Map<string, StoredAdmin>();
  /** Overrides lockActiveSuperAdminIds to simulate concurrent changes. */
  lockedSuperAdminIdsOverride: string[] | null = null;

  seed(
    overrides: Partial<PlatformAdmin> & { password?: string } = {},
  ): PlatformAdmin {
    const { password = 'Initial-Password-1', ...rest } = overrides;
    const now = new Date('2026-01-01T00:00:00.000Z');
    const admin: PlatformAdmin = {
      id: randomUUID(),
      email: `${randomUUID().slice(0, 8)}@test.lk`,
      fullName: 'Test Admin',
      role: PlatformRole.SUPER_ADMIN,
      status: PlatformAdminStatus.ACTIVE,
      mustChangePassword: false,
      passwordChangedAt: null,
      lastLoginAt: null,
      disabledAt: null,
      createdById: null,
      createdAt: now,
      updatedAt: now,
      ...rest,
    };
    this.rows.set(admin.id, { admin, passwordHash: `hashed:${password}` });
    return admin;
  }

  get(id: string): StoredAdmin {
    const row = this.rows.get(id);
    if (!row) throw new Error(`no admin ${id}`);
    return row;
  }

  async findById(id: string) {
    return this.rows.get(id)?.admin ?? null;
  }
  async findCredentialsByEmail(
    email: string,
  ): Promise<PlatformAdminCredentials | null> {
    return [...this.rows.values()].find((r) => r.admin.email === email) ?? null;
  }
  async findCredentialsById(id: string) {
    return this.rows.get(id) ?? null;
  }
  async list() {
    const items = [...this.rows.values()].map((r) => r.admin);
    return { items, total: items.length };
  }
  async create(input: NewPlatformAdmin) {
    if ([...this.rows.values()].some((r) => r.admin.email === input.email)) {
      throw new AppError('CONFLICT', 'PLATFORM_ADMIN_EMAIL_TAKEN', 'taken');
    }
    const { passwordHash, ...rest } = input;
    const admin = this.seed({ ...rest, mustChangePassword: true });
    this.get(admin.id).passwordHash = passwordHash;
    return admin;
  }
  private patch(id: string, changes: Partial<PlatformAdmin>) {
    const row = this.get(id);
    row.admin = { ...row.admin, ...changes };
    return row.admin;
  }
  async updateFullName(id: string, fullName: string) {
    return this.patch(id, { fullName });
  }
  async changeRole(id: string, role: PlatformRole) {
    return this.patch(id, { role });
  }
  async disable(id: string, at: Date) {
    return this.patch(id, {
      status: PlatformAdminStatus.DISABLED,
      disabledAt: at,
    });
  }
  async enable(id: string) {
    return this.patch(id, {
      status: PlatformAdminStatus.ACTIVE,
      disabledAt: null,
    });
  }
  async setPassword(
    id: string,
    change: {
      passwordHash: string;
      mustChangePassword: boolean;
      passwordChangedAt?: Date;
    },
  ) {
    this.get(id).passwordHash = change.passwordHash;
    return this.patch(id, {
      mustChangePassword: change.mustChangePassword,
      ...(change.passwordChangedAt
        ? { passwordChangedAt: change.passwordChangedAt }
        : {}),
    });
  }
  async recordLogin(id: string, at: Date) {
    this.patch(id, { lastLoginAt: at });
  }
  async lockActiveSuperAdminIds() {
    if (this.lockedSuperAdminIdsOverride)
      return this.lockedSuperAdminIdsOverride;
    return [...this.rows.values()]
      .map((r) => r.admin)
      .filter(
        (a) =>
          a.role === PlatformRole.SUPER_ADMIN &&
          a.status === PlatformAdminStatus.ACTIVE,
      )
      .map((a) => a.id);
  }
}

interface StoredSession extends PlatformSession {
  refreshTokenHash: string;
  replacedById: string | null;
}

export class InMemorySessionRepository implements PlatformSessionRepository {
  readonly rows = new Map<string, StoredSession>();

  constructor(private readonly admins: InMemoryAdminRepository) {}

  async create(input: NewPlatformSession) {
    const row: StoredSession = {
      id: randomUUID(),
      adminId: input.adminId,
      expiresAt: input.expiresAt,
      refreshTokenHash: input.refreshTokenHash,
      revokedAt: null,
      revokedReason: null,
      replacedById: null,
    };
    this.rows.set(row.id, row);
    return row;
  }
  async findWithAdmin(sessionId: string) {
    const session = this.rows.get(sessionId);
    if (!session) return null;
    const a = this.admins.get(session.adminId).admin;
    const admin: SessionAdmin = {
      id: a.id,
      email: a.email,
      fullName: a.fullName,
      role: a.role,
      status: a.status,
      mustChangePassword: a.mustChangePassword,
    };
    return { session, admin };
  }
  async findByRefreshTokenHash(hash: string) {
    return (
      [...this.rows.values()].find((s) => s.refreshTokenHash === hash) ?? null
    );
  }
  async revokeIfActive(
    id: string,
    reason: PlatformSessionRevokedReason,
    at: Date,
    replacedById?: string,
  ) {
    const s = this.rows.get(id);
    if (!s || s.revokedAt) return false;
    Object.assign(s, {
      revokedAt: at,
      revokedReason: reason,
      replacedById: replacedById ?? null,
    });
    return true;
  }
  async revokeAllActiveForAdmin(
    adminId: string,
    reason: PlatformSessionRevokedReason,
    at: Date,
    exceptSessionId?: string,
  ) {
    let count = 0;
    for (const s of this.rows.values()) {
      if (s.adminId === adminId && !s.revokedAt && s.id !== exceptSessionId) {
        Object.assign(s, { revokedAt: at, revokedReason: reason });
        count++;
      }
    }
    return count;
  }
  activeFor(adminId: string): StoredSession[] {
    return [...this.rows.values()].filter(
      (s) => s.adminId === adminId && !s.revokedAt,
    );
  }
}

export function actorFrom(
  admin: PlatformAdmin,
  sessionId: string = randomUUID(),
): AuthenticatedPlatformAdmin {
  return {
    id: admin.id,
    email: admin.email,
    fullName: admin.fullName,
    role: admin.role,
    sessionId,
    mustChangePassword: admin.mustChangePassword,
    permissions: permissionsForRole(admin.role),
  };
}

export async function expectAppError(
  promise: Promise<unknown>,
  code: string,
): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(code);
    return error as AppError;
  }
  throw new Error(`Expected AppError ${code} but promise resolved`);
}
