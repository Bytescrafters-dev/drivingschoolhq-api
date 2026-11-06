import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import {
  BranchStatus,
  TenantUserBranchAccess,
  TenantUserStatus,
} from '../../../generated/prisma/enums.js';
import { AppError } from '../../../common/errors/app-error.js';
import { violatedUniqueIndex } from '../../../prisma/prisma-errors.js';
import { TransactionManager } from '../../../prisma/transaction-manager.js';
import type {
  Branch,
  BranchDetailsChange,
  BranchRepository,
  BranchViewer,
  ExclusiveBranchUser,
  NewBranch,
} from '../interfaces/branch.repository.js';

const BRANCH_SELECT = {
  id: true,
  tenantId: true,
  name: true,
  address: true,
  district: true,
  phone: true,
  status: true,
  closedAt: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.BranchSelect;

const ORDER = [
  { createdAt: 'asc' },
  { id: 'asc' },
] as const satisfies Prisma.BranchOrderByWithRelationInput[];

function nameTaken(): AppError {
  return new AppError(
    'CONFLICT',
    'BRANCH_NAME_TAKEN',
    'Another branch of this school already has this name',
  );
}

/** Hand-written case-insensitive unique index on (tenantId, lower(name)). */
const NAME_INDEX = 'branches_tenantId_lower_name_key';

function isNameViolation(error: unknown): boolean {
  return violatedUniqueIndex(error, [NAME_INDEX]) === NAME_INDEX;
}

function accessibleWhere(viewer: BranchViewer): Prisma.BranchWhereInput {
  return viewer.branchAccess === TenantUserBranchAccess.ALL
    ? { tenantId: viewer.tenantId }
    : {
        tenantId: viewer.tenantId,
        assignments: { some: { userId: viewer.userId } },
      };
}

@Injectable()
export class PrismaBranchRepository implements BranchRepository {
  constructor(private readonly tx: TransactionManager) {}

  async create(branch: NewBranch): Promise<Branch> {
    try {
      return await this.tx.client.branch.create({
        data: branch,
        select: BRANCH_SELECT,
      });
    } catch (error) {
      if (isNameViolation(error)) throw nameTaken();
      throw error;
    }
  }

  findById(tenantId: string, branchId: string): Promise<Branch | null> {
    return this.tx.client.branch.findFirst({
      where: { tenantId, id: branchId },
      select: BRANCH_SELECT,
    });
  }

  listForTenant(
    tenantId: string,
    options: { includeClosed: boolean },
  ): Promise<Branch[]> {
    return this.tx.client.branch.findMany({
      where: {
        tenantId,
        ...(options.includeClosed ? {} : { status: BranchStatus.ACTIVE }),
      },
      select: BRANCH_SELECT,
      orderBy: [...ORDER],
    });
  }

  listAccessible(
    viewer: BranchViewer,
    options: { includeClosed: boolean },
  ): Promise<Branch[]> {
    return this.tx.client.branch.findMany({
      where: {
        ...accessibleWhere(viewer),
        ...(options.includeClosed ? {} : { status: BranchStatus.ACTIVE }),
      },
      select: BRANCH_SELECT,
      orderBy: [...ORDER],
    });
  }

  findAccessible(
    viewer: BranchViewer,
    branchId: string,
  ): Promise<Branch | null> {
    return this.tx.client.branch.findFirst({
      where: { id: branchId, ...accessibleWhere(viewer) },
      select: BRANCH_SELECT,
    });
  }

  async lockAccessible(
    viewer: BranchViewer,
    branchId: string,
  ): Promise<Branch | null> {
    await this.tx.client.$queryRaw`
      SELECT id FROM branches
      WHERE id = ${branchId}::uuid AND "tenantId" = ${viewer.tenantId}::uuid
      FOR UPDATE`;
    return this.findAccessible(viewer, branchId);
  }

  countActive(tenantId: string): Promise<number> {
    return this.tx.client.branch.count({
      where: { tenantId, status: BranchStatus.ACTIVE },
    });
  }

  async hasActiveAccessible(viewer: BranchViewer): Promise<boolean> {
    const branch = await this.tx.client.branch.findFirst({
      where: { ...accessibleWhere(viewer), status: BranchStatus.ACTIVE },
      select: { id: true },
    });
    return branch !== null;
  }

  async updateDetails(
    tenantId: string,
    branchId: string,
    change: BranchDetailsChange,
  ): Promise<Branch> {
    try {
      return await this.tx.client.branch.update({
        where: { tenantId_id: { tenantId, id: branchId } },
        data: change,
        select: BRANCH_SELECT,
      });
    } catch (error) {
      if (isNameViolation(error)) throw nameTaken();
      throw error;
    }
  }

  setStatus(
    tenantId: string,
    branchId: string,
    status: BranchStatus,
    closedAt: Date | null,
  ): Promise<Branch> {
    return this.tx.client.branch.update({
      where: { tenantId_id: { tenantId, id: branchId } },
      data: { status, closedAt },
      select: BRANCH_SELECT,
    });
  }

  async assignUser(
    tenantId: string,
    userId: string,
    branchId: string,
  ): Promise<void> {
    await this.tx.client.tenantUserBranch.upsert({
      where: { userId_branchId: { userId, branchId } },
      create: { tenantId, userId, branchId },
      update: {},
    });
  }

  findExclusiveUsers(
    tenantId: string,
    branchId: string,
  ): Promise<ExclusiveBranchUser[]> {
    return this.tx.client.tenantUser.findMany({
      where: {
        tenantId,
        status: TenantUserStatus.ACTIVE,
        branchAccess: TenantUserBranchAccess.SELECTED,
        branchAssignments: {
          some: { branchId },
          none: {
            branchId: { not: branchId },
            branch: { status: BranchStatus.ACTIVE },
          },
        },
      },
      select: { id: true, fullName: true, email: true },
      orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
    });
  }

  reassignDefaults(tenantId: string, fromBranchId: string): Promise<number> {
    // The replacement is the oldest other ACTIVE branch the user may access.
    return this.tx.client.$executeRaw`
      WITH replacement AS (
        SELECT u.id AS "userId", (
          SELECT b.id FROM branches b
          WHERE b."tenantId" = u."tenantId"
            AND b.status = 'ACTIVE'
            AND b.id <> u."defaultBranchId"
            AND (
              u."branchAccess" = 'ALL'
              OR EXISTS (
                SELECT 1 FROM tenant_user_branches a
                WHERE a."userId" = u.id AND a."branchId" = b.id
              )
            )
          ORDER BY b."createdAt", b.id
          LIMIT 1
        ) AS "branchId"
        FROM tenant_users u
        WHERE u."tenantId" = ${tenantId}::uuid
          AND u."defaultBranchId" = ${fromBranchId}::uuid
      )
      UPDATE tenant_users u
      SET "defaultBranchId" = r."branchId", "updatedAt" = now()
      FROM replacement r
      WHERE u.id = r."userId" AND r."branchId" IS NOT NULL`;
  }

  async setUserDefault(
    tenantId: string,
    userId: string,
    branchId: string,
  ): Promise<void> {
    await this.tx.client.tenantUser.update({
      where: { tenantId_id: { tenantId, id: userId } },
      data: { defaultBranchId: branchId },
      select: { id: true },
    });
  }
}
