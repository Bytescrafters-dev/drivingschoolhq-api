import { randomUUID } from 'node:crypto';
import { AppError } from '../../src/common/errors/app-error.js';
import {
  BranchStatus,
  District,
  TenantUserBranchAccess,
  TenantUserStatus,
} from '../../src/generated/prisma/enums.js';
import type {
  Branch,
  BranchDetailsChange,
  BranchRepository,
  BranchViewer,
  NewBranch,
} from '../../src/tenant/branches/interfaces/branch.repository.js';
import type { InMemoryTenantUserRepository } from './tenancy-fakes.js';

interface Assignment {
  tenantId: string;
  userId: string;
  branchId: string;
}

/**
 * In-memory branches + assignments. User defaults live on the user fake's
 * rows, so reassignments are observable there. Returns copies, like Prisma.
 */
export class InMemoryBranchRepository implements BranchRepository {
  readonly rows: Branch[] = [];
  readonly assignments: Assignment[] = [];
  private tick = 0;

  constructor(private readonly users?: InMemoryTenantUserRepository) {}

  seed(overrides: Partial<Branch> & { tenantId: string }): Branch {
    // Strictly increasing createdAt keeps "oldest first" deterministic.
    const createdAt = new Date(Date.UTC(2026, 0, 1) + this.tick++ * 1000);
    const branch: Branch = {
      id: randomUUID(),
      name: `Branch ${this.tick}`,
      address: 'Somewhere',
      district: District.COLOMBO,
      phone: '+94771234567',
      status: BranchStatus.ACTIVE,
      closedAt: null,
      createdAt,
      updatedAt: createdAt,
      ...overrides,
    };
    this.rows.push(branch);
    return { ...branch };
  }

  assign(tenantId: string, userId: string, ...branchIds: string[]): void {
    for (const branchId of branchIds) {
      this.assignments.push({ tenantId, userId, branchId });
    }
  }

  private accessible(viewer: BranchViewer, branch: Branch): boolean {
    if (branch.tenantId !== viewer.tenantId) return false;
    return (
      viewer.branchAccess === TenantUserBranchAccess.ALL ||
      this.assignments.some(
        (a) => a.userId === viewer.userId && a.branchId === branch.id,
      )
    );
  }

  private assertUniqueName(tenantId: string, name: string, exceptId?: string) {
    if (
      this.rows.some(
        (b) =>
          b.tenantId === tenantId &&
          b.id !== exceptId &&
          b.name.toLowerCase() === name.toLowerCase(),
      )
    ) {
      throw new AppError('CONFLICT', 'BRANCH_NAME_TAKEN', 'taken');
    }
  }

  private row(tenantId: string, id: string): Branch {
    const row = this.rows.find((b) => b.tenantId === tenantId && b.id === id);
    if (!row) throw new Error(`branch ${id} not found in tenant ${tenantId}`);
    return row;
  }

  async create(input: NewBranch) {
    this.assertUniqueName(input.tenantId, input.name);
    return this.seed({
      tenantId: input.tenantId,
      name: input.name,
      address: input.address,
      district: input.district,
      phone: input.phone,
    });
  }
  async listForTenant(tenantId: string, options: { includeClosed: boolean }) {
    return this.rows
      .filter((b) => b.tenantId === tenantId)
      .filter((b) => options.includeClosed || b.status === BranchStatus.ACTIVE)
      .map((b) => ({ ...b }));
  }
  async listAccessible(
    viewer: BranchViewer,
    options: { includeClosed: boolean },
  ) {
    return this.rows
      .filter((b) => this.accessible(viewer, b))
      .filter((b) => options.includeClosed || b.status === BranchStatus.ACTIVE)
      .map((b) => ({ ...b }));
  }
  async findAccessible(viewer: BranchViewer, branchId: string) {
    const branch = this.rows.find((b) => b.id === branchId);
    return branch && this.accessible(viewer, branch) ? { ...branch } : null;
  }
  async lockAccessible(viewer: BranchViewer, branchId: string) {
    return this.findAccessible(viewer, branchId);
  }
  async countActive(tenantId: string) {
    return this.rows.filter(
      (b) => b.tenantId === tenantId && b.status === BranchStatus.ACTIVE,
    ).length;
  }
  async hasActiveAccessible(viewer: BranchViewer) {
    return this.rows.some(
      (b) => b.status === BranchStatus.ACTIVE && this.accessible(viewer, b),
    );
  }
  async updateDetails(
    tenantId: string,
    branchId: string,
    change: BranchDetailsChange,
  ) {
    if (change.name !== undefined) {
      this.assertUniqueName(tenantId, change.name, branchId);
    }
    const row = this.row(tenantId, branchId);
    Object.assign(row, change, { updatedAt: new Date() });
    return { ...row };
  }
  async setStatus(
    tenantId: string,
    branchId: string,
    status: BranchStatus,
    closedAt: Date | null,
  ) {
    const row = this.row(tenantId, branchId);
    Object.assign(row, { status, closedAt });
    return { ...row };
  }
  async assignUser(tenantId: string, userId: string, branchId: string) {
    if (
      !this.assignments.some(
        (a) => a.userId === userId && a.branchId === branchId,
      )
    ) {
      this.assign(tenantId, userId, branchId);
    }
  }
  private activeAssigned(userId: string): string[] {
    return this.assignments
      .filter((a) => a.userId === userId)
      .map((a) => a.branchId)
      .filter(
        (id) =>
          this.rows.find((b) => b.id === id)?.status === BranchStatus.ACTIVE,
      );
  }
  async findExclusiveUsers(tenantId: string, branchId: string) {
    return (this.users?.rows ?? [])
      .filter(
        (u) =>
          u.tenantId === tenantId &&
          u.status === TenantUserStatus.ACTIVE &&
          u.branchAccess === TenantUserBranchAccess.SELECTED,
      )
      .filter((u) => {
        const active = this.activeAssigned(u.id);
        const assignedHere = this.assignments.some(
          (a) => a.userId === u.id && a.branchId === branchId,
        );
        return assignedHere && active.every((id) => id === branchId);
      })
      .map((u) => ({ id: u.id, fullName: u.fullName, email: u.email }));
  }
  async reassignDefaults(tenantId: string, fromBranchId: string) {
    let moved = 0;
    for (const user of this.users?.rows ?? []) {
      if (user.tenantId !== tenantId || user.defaultBranchId !== fromBranchId) {
        continue;
      }
      const viewer: BranchViewer = {
        tenantId,
        userId: user.id,
        branchAccess: user.branchAccess,
      };
      const next = this.rows.find(
        (b) =>
          b.id !== fromBranchId &&
          b.status === BranchStatus.ACTIVE &&
          this.accessible(viewer, b),
      );
      if (next) {
        user.defaultBranchId = next.id;
        moved++;
      }
    }
    return moved;
  }
  async setUserDefault(tenantId: string, userId: string, branchId: string) {
    const user = this.users?.rows.find(
      (u) => u.tenantId === tenantId && u.id === userId,
    );
    if (user) user.defaultBranchId = branchId;
  }
}
