import { randomDigits } from './random.js';
import { randomUUID } from 'node:crypto';
import { AppError } from '../../src/common/errors/app-error.js';
import {
  District,
  TenantAccessStatus,
  TenantRole,
  TenantStatus,
  TenantSubscriptionStatus,
  TenantUserStatus,
} from '../../src/generated/prisma/enums.js';
import type {
  CurrentSubscriptions,
  NewActiveSubscription,
  NewScheduledSubscription,
  TenantSubscription,
  TenantSubscriptionRepository,
} from '../../src/platform/subscriptions/interfaces/tenant-subscription.repository.js';
import type {
  NewTenant,
  Tenant,
  TenantAccess,
  TenantProfileChange,
  TenantRepository,
} from '../../src/platform/tenants/interfaces/tenant.repository.js';
import type { TenantSessionsService } from '../../src/tenant/sessions/tenant-sessions.service.js';
import type {
  NewTenantOwner,
  TenantOwnerProfileChange,
  TenantUser,
  TenantUserRepository,
} from '../../src/tenant/users/interfaces/tenant-user.repository.js';

export class InMemoryTenantRepository implements TenantRepository {
  readonly tenants = new Map<string, Tenant>();
  readonly access = new Map<string, TenantAccess>();

  seed(overrides: Partial<Tenant> = {}): Tenant {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const tenant: Tenant = {
      id: randomUUID(),
      dsCode: `DS${randomDigits()}`,
      name: 'Seeded School',
      displayName: 'Seeded',
      address: 'Colombo',
      district: District.COLOMBO,
      phone: '+94771234567',
      status: TenantStatus.ACTIVE,
      closedAt: null,
      createdById: randomUUID(),
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
    this.tenants.set(tenant.id, tenant);
    return tenant;
  }

  async create(input: NewTenant) {
    if ([...this.tenants.values()].some((t) => t.dsCode === input.dsCode)) {
      throw new AppError('CONFLICT', 'TENANT_DS_CODE_TAKEN', 'taken');
    }
    return this.seed(input);
  }
  async findById(id: string) {
    return this.tenants.get(id) ?? null;
  }
  async lockById(id: string) {
    return this.tenants.get(id) ?? null;
  }
  async list() {
    const items = [...this.tenants.values()].map((t) => ({
      ...t,
      accessStatus: this.access.get(t.id)?.status ?? null,
      currentPlan: null,
    }));
    return { items, total: items.length };
  }
  private patch(id: string, changes: Partial<Tenant>) {
    const tenant = { ...this.tenants.get(id)!, ...changes };
    this.tenants.set(id, tenant);
    return tenant;
  }
  async updateProfile(id: string, change: TenantProfileChange) {
    if (
      change.dsCode &&
      [...this.tenants.values()].some(
        (t) => t.id !== id && t.dsCode === change.dsCode,
      )
    ) {
      throw new AppError('CONFLICT', 'TENANT_DS_CODE_TAKEN', 'taken');
    }
    return this.patch(id, change);
  }
  async setStatus(id: string, status: TenantStatus, closedAt: Date | null) {
    return this.patch(id, { status, closedAt });
  }
  async createAccess(tenantId: string, at: Date) {
    const access = { status: TenantAccessStatus.ACTIVE, statusChangedAt: at };
    this.access.set(tenantId, access);
    return access;
  }
  async findAccess(tenantId: string) {
    return this.access.get(tenantId) ?? null;
  }
  async setAccessStatus(
    tenantId: string,
    status: TenantAccessStatus,
    at: Date,
  ) {
    const access = { status, statusChangedAt: at };
    this.access.set(tenantId, access);
    return access;
  }
}

export class InMemorySubscriptionRepository implements TenantSubscriptionRepository {
  readonly rows: TenantSubscription[] = [];

  forTenant(tenantId: string): TenantSubscription[] {
    return this.rows.filter((r) => r.tenantId === tenantId);
  }

  seed(overrides: Partial<TenantSubscription> = {}): TenantSubscription {
    const row: TenantSubscription = {
      id: randomUUID(),
      tenantId: randomUUID(),
      planId: randomUUID(),
      planPriceId: randomUUID(),
      planCode: 'SEED',
      planName: 'Seed',
      billingPeriod: 'MONTHLY',
      listAmount: '1000.00',
      agreedAmount: '1000.00',
      discountReason: null,
      gracePeriodDays: 7,
      status: TenantSubscriptionStatus.ACTIVE,
      startDate: new Date('2026-10-01T00:00:00.000Z'),
      trialEndDate: null,
      endDate: null,
      cancelledAt: null,
      cancelledById: null,
      cancellationReason: null,
      createdById: randomUUID(),
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    };
    this.rows.push(row);
    return row;
  }

  async createActive(input: NewActiveSubscription) {
    if (
      this.forTenant(input.tenantId).some(
        (r) => r.status === TenantSubscriptionStatus.ACTIVE,
      )
    ) {
      throw new AppError('CONFLICT', 'SUBSCRIPTION_ALREADY_ACTIVE', 'active');
    }
    return this.seed({ ...input, status: TenantSubscriptionStatus.ACTIVE });
  }
  async findCurrent(tenantId: string): Promise<CurrentSubscriptions> {
    const rows = this.forTenant(tenantId);
    return {
      active:
        rows.find((r) => r.status === TenantSubscriptionStatus.ACTIVE) ?? null,
      scheduled:
        rows.find((r) => r.status === TenantSubscriptionStatus.SCHEDULED) ??
        null,
    };
  }
  async createScheduled(input: NewScheduledSubscription) {
    if (
      this.forTenant(input.tenantId).some(
        (r) => r.status === TenantSubscriptionStatus.SCHEDULED,
      )
    ) {
      throw new AppError(
        'CONFLICT',
        'SUBSCRIPTION_CHANGE_ALREADY_SCHEDULED',
        'scheduled',
      );
    }
    return this.seed({
      ...input,
      trialEndDate: null,
      status: TenantSubscriptionStatus.SCHEDULED,
    });
  }
  async lockCurrent(tenantId: string) {
    return this.findCurrent(tenantId);
  }
  async listForTenant(tenantId: string) {
    return [...this.forTenant(tenantId)].reverse();
  }
  async findTenantIdsWithDueChanges(today: Date, limit: number) {
    return this.rows
      .filter(
        (r) =>
          r.status === TenantSubscriptionStatus.SCHEDULED &&
          r.startDate <= today,
      )
      .slice(0, limit)
      .map((r) => r.tenantId);
  }
  async activate(id: string) {
    const row = this.rows.find((r) => r.id === id)!;
    row.status = TenantSubscriptionStatus.ACTIVE;
    return row;
  }
  async updateGracePeriod(id: string, days: number) {
    const row = this.rows.find((r) => r.id === id)!;
    row.gracePeriodDays = days;
    return row;
  }
  async end(id: string, endDate: Date) {
    const row = this.rows.find((r) => r.id === id)!;
    Object.assign(row, { status: TenantSubscriptionStatus.ENDED, endDate });
    return row;
  }
  async cancel(
    id: string,
    cancellation: { at: Date; byId: string; reason: string },
  ) {
    const row = this.rows.find((r) => r.id === id)!;
    Object.assign(row, {
      status: TenantSubscriptionStatus.CANCELLED,
      cancelledAt: cancellation.at,
      cancelledById: cancellation.byId,
      cancellationReason: cancellation.reason,
    });
    return row;
  }
}

type StoredTenantUser = TenantUser & { passwordHash: string };

/** Returns copies so callers cannot observe later mutations (like Prisma). */
export class InMemoryTenantUserRepository implements TenantUserRepository {
  readonly rows: StoredTenantUser[] = [];

  seedUser(
    overrides: Partial<StoredTenantUser> & { tenantId: string },
  ): StoredTenantUser {
    const now = new Date();
    const row: StoredTenantUser = {
      id: randomUUID(),
      email: `${randomUUID().slice(0, 8)}@school.lk`,
      fullName: 'Seeded User',
      phone: null,
      nic: null,
      role: TenantRole.FRONT_DESK,
      status: TenantUserStatus.ACTIVE,
      mustChangePassword: false,
      passwordChangedAt: null,
      lastLoginAt: null,
      disabledAt: null,
      createdByPlatformAdminId: randomUUID(),
      createdByTenantUserId: null,
      createdAt: now,
      updatedAt: now,
      passwordHash: 'hashed:seed',
      ...overrides,
    };
    this.rows.push(row);
    return row;
  }

  ownerRow(tenantId: string): StoredTenantUser | undefined {
    return this.rows.find(
      (r) => r.tenantId === tenantId && r.role === TenantRole.OWNER,
    );
  }

  private view(row: StoredTenantUser): TenantUser {
    const { passwordHash: _hash, ...user } = row;
    return { ...user };
  }

  async createOwner(input: NewTenantOwner) {
    if (this.ownerRow(input.tenantId)) {
      throw new AppError('CONFLICT', 'TENANT_OWNER_EXISTS', 'exists');
    }
    return this.view(
      this.seedUser({
        ...input,
        role: TenantRole.OWNER,
        mustChangePassword: true,
      }),
    );
  }
  async findOwner(tenantId: string) {
    const row = this.ownerRow(tenantId);
    return row ? this.view(row) : null;
  }
  async lockOwner(tenantId: string) {
    return this.findOwner(tenantId);
  }
  async updateOwnerProfile(tenantId: string, change: TenantOwnerProfileChange) {
    const owner = this.ownerRow(tenantId)!;
    const others = this.rows.filter(
      (r) => r.tenantId === tenantId && r.id !== owner.id,
    );
    if (change.email && others.some((r) => r.email === change.email)) {
      throw new AppError('CONFLICT', 'TENANT_USER_EMAIL_TAKEN', 'taken');
    }
    if (change.nic && others.some((r) => r.nic === change.nic)) {
      throw new AppError('CONFLICT', 'TENANT_USER_NIC_TAKEN', 'taken');
    }
    Object.assign(owner, change);
    return this.view(owner);
  }
  async setOwnerPassword(tenantId: string, passwordHash: string) {
    const owner = this.ownerRow(tenantId)!;
    Object.assign(owner, { passwordHash, mustChangePassword: true });
    return this.view(owner);
  }
  async disableOwner(tenantId: string, at: Date) {
    const owner = this.ownerRow(tenantId)!;
    Object.assign(owner, {
      status: TenantUserStatus.DISABLED,
      disabledAt: at,
    });
    return this.view(owner);
  }
  async findCredentialsByEmail(tenantId: string, email: string) {
    const row = this.rows.find(
      (r) => r.tenantId === tenantId && r.email === email,
    );
    return row
      ? { user: this.view(row), passwordHash: row.passwordHash }
      : null;
  }
  async findCredentialsById(tenantId: string, id: string) {
    const row = this.rows.find((r) => r.tenantId === tenantId && r.id === id);
    return row
      ? { user: this.view(row), passwordHash: row.passwordHash }
      : null;
  }
  async recordLogin(tenantId: string, id: string, at: Date) {
    const row = this.rows.find((r) => r.tenantId === tenantId && r.id === id)!;
    row.lastLoginAt = at;
  }
  async setOwnPassword(
    tenantId: string,
    id: string,
    passwordHash: string,
    at: Date,
  ) {
    const row = this.rows.find((r) => r.tenantId === tenantId && r.id === id)!;
    Object.assign(row, {
      passwordHash,
      mustChangePassword: false,
      passwordChangedAt: at,
    });
  }
  async enableOwner(tenantId: string) {
    const owner = this.ownerRow(tenantId)!;
    Object.assign(owner, { status: TenantUserStatus.ACTIVE, disabledAt: null });
    return this.view(owner);
  }
}

/** Records revocation requests instead of touching sessions. */
export class FakeTenantSessionsService {
  readonly revocations: {
    tenantId: string;
    userId: string | null;
    reason: string;
  }[] = [];
  async revokeAllForUser(tenantId: string, userId: string, reason: string) {
    this.revocations.push({ tenantId, userId, reason });
    return 1;
  }
  async revokeAllForTenant(tenantId: string, reason: string) {
    this.revocations.push({ tenantId, userId: null, reason });
    return 1;
  }
  asService(): TenantSessionsService {
    return this as unknown as TenantSessionsService;
  }
}
