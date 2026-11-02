import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import {
  BranchStatus,
  TenantRole,
  TenantUserBranchAccess,
  TenantUserStatus,
} from '../../../generated/prisma/enums.js';
import { AppError } from '../../../common/errors/app-error.js';
import { violatedUniqueIndex } from '../../../prisma/prisma-errors.js';
import { TransactionManager } from '../../../prisma/transaction-manager.js';
import type {
  NewStaffMember,
  StaffAccess,
  StaffListFilter,
  StaffMember,
  StaffProfileChange,
  StaffRepository,
  StaffViewer,
} from '../interfaces/staff.repository.js';

const STAFF_SELECT = {
  id: true,
  tenantId: true,
  email: true,
  fullName: true,
  phone: true,
  nic: true,
  role: true,
  status: true,
  mustChangePassword: true,
  passwordChangedAt: true,
  lastLoginAt: true,
  disabledAt: true,
  branchAccess: true,
  defaultBranchId: true,
  createdByPlatformAdminId: true,
  createdByTenantUserId: true,
  createdAt: true,
  updatedAt: true,
  branchAssignments: {
    select: { branch: { select: { id: true, name: true, status: true } } },
    orderBy: [{ branch: { createdAt: 'asc' } }, { branchId: 'asc' }],
  },
} as const satisfies Prisma.TenantUserSelect;

type StaffRow = Prisma.TenantUserGetPayload<{ select: typeof STAFF_SELECT }>;

function toMember(row: StaffRow): StaffMember {
  const { branchAssignments, ...user } = row;
  return { ...user, branches: branchAssignments.map((a) => a.branch) };
}

const EMAIL_INDEX = 'tenant_users_tenantId_email_key';
const NIC_INDEX = 'tenant_users_tenantId_nic_key';

/** Maps unique violations on email/NIC to domain errors. */
function mapUniqueViolation(error: unknown): never {
  const index = violatedUniqueIndex(error, [EMAIL_INDEX, NIC_INDEX]);
  if (index === EMAIL_INDEX) {
    throw new AppError(
      'CONFLICT',
      'TENANT_USER_EMAIL_TAKEN',
      'Another user of this school already uses this email',
    );
  }
  if (index === NIC_INDEX) {
    throw new AppError(
      'CONFLICT',
      'TENANT_USER_NIC_TAKEN',
      'Another user of this school already uses this NIC',
    );
  }
  throw error;
}

function visibleWhere(viewer: StaffViewer): Prisma.TenantUserWhereInput {
  if (viewer.branchAccess === TenantUserBranchAccess.ALL) {
    return { tenantId: viewer.tenantId };
  }
  return {
    tenantId: viewer.tenantId,
    OR: [
      { branchAccess: TenantUserBranchAccess.ALL },
      {
        branchAssignments: {
          some: { branchId: { in: [...viewer.branchIds] } },
        },
      },
    ],
  };
}

function filterWhere(filter: StaffListFilter): Prisma.TenantUserWhereInput[] {
  const where: Prisma.TenantUserWhereInput[] = [];
  if (filter.status) where.push({ status: filter.status });
  if (filter.role) where.push({ role: filter.role });
  if (filter.branchId) {
    where.push({
      OR: [
        { branchAccess: TenantUserBranchAccess.ALL },
        { branchAssignments: { some: { branchId: filter.branchId } } },
      ],
    });
  }
  if (filter.search) {
    where.push({
      OR: [
        { fullName: { contains: filter.search, mode: 'insensitive' } },
        { email: { contains: filter.search, mode: 'insensitive' } },
      ],
    });
  }
  return where;
}

/** Writes only ever match a non-owner row of the tenant. */
function staffRow(tenantId: string, id: string) {
  return {
    tenantId_id: { tenantId, id },
    role: { not: TenantRole.OWNER },
  } satisfies Prisma.TenantUserWhereUniqueInput;
}

@Injectable()
export class PrismaStaffRepository implements StaffRepository {
  constructor(private readonly tx: TransactionManager) {}

  async listVisible(
    viewer: StaffViewer,
    filter: StaffListFilter,
    page: { page: number; pageSize: number },
  ): Promise<{ items: StaffMember[]; total: number }> {
    const where: Prisma.TenantUserWhereInput = {
      AND: [visibleWhere(viewer), ...filterWhere(filter)],
    };
    const [rows, total] = await Promise.all([
      this.tx.client.tenantUser.findMany({
        where,
        select: STAFF_SELECT,
        orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
        skip: (page.page - 1) * page.pageSize,
        take: page.pageSize,
      }),
      this.tx.client.tenantUser.count({ where }),
    ]);
    return { items: rows.map(toMember), total };
  }

  async listForTenant(tenantId: string): Promise<StaffMember[]> {
    const rows = await this.tx.client.tenantUser.findMany({
      where: { tenantId },
      select: STAFF_SELECT,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    // The owner first, then everyone else in creation order.
    return rows
      .map(toMember)
      .sort(
        (a, b) =>
          Number(b.role === TenantRole.OWNER) -
          Number(a.role === TenantRole.OWNER),
      );
  }

  async findVisible(
    viewer: StaffViewer,
    id: string,
  ): Promise<StaffMember | null> {
    const row = await this.tx.client.tenantUser.findFirst({
      where: { AND: [{ id }, visibleWhere(viewer)] },
      select: STAFF_SELECT,
    });
    return row ? toMember(row) : null;
  }

  async lockVisible(
    viewer: StaffViewer,
    id: string,
  ): Promise<StaffMember | null> {
    await this.tx.client.$queryRaw`
      SELECT id FROM tenant_users
      WHERE id = ${id}::uuid AND "tenantId" = ${viewer.tenantId}::uuid
      FOR UPDATE`;
    return this.findVisible(viewer, id);
  }

  countActive(tenantId: string): Promise<number> {
    return this.tx.client.tenantUser.count({
      where: { tenantId, status: TenantUserStatus.ACTIVE },
    });
  }

  async create(member: NewStaffMember): Promise<StaffMember> {
    const { branchIds, tenantId, ...data } = member;
    try {
      const row = await this.tx.client.tenantUser.create({
        data: {
          ...data,
          tenantId,
          mustChangePassword: true,
          branchAssignments: {
            create: branchIds.map((branchId) => ({ branchId })),
          },
        },
        select: STAFF_SELECT,
      });
      return toMember(row);
    } catch (error) {
      return mapUniqueViolation(error);
    }
  }

  async updateProfile(
    tenantId: string,
    id: string,
    change: StaffProfileChange,
  ): Promise<StaffMember> {
    try {
      const row = await this.tx.client.tenantUser.update({
        where: staffRow(tenantId, id),
        data: change,
        select: STAFF_SELECT,
      });
      return toMember(row);
    } catch (error) {
      return mapUniqueViolation(error);
    }
  }

  async setRole(
    tenantId: string,
    id: string,
    role: TenantRole,
  ): Promise<StaffMember> {
    return toMember(
      await this.tx.client.tenantUser.update({
        where: staffRow(tenantId, id),
        data: { role },
        select: STAFF_SELECT,
      }),
    );
  }

  async replaceAccess(
    tenantId: string,
    id: string,
    access: StaffAccess,
  ): Promise<StaffMember> {
    const client = this.tx.client;
    if (access.branchAccess === TenantUserBranchAccess.ALL) {
      await client.tenantUserBranch.deleteMany({
        where: { tenantId, userId: id },
      });
    } else {
      await client.tenantUserBranch.deleteMany({
        where: {
          tenantId,
          userId: id,
          branchId: { notIn: [...access.branchIds] },
          branch: { status: BranchStatus.ACTIVE },
        },
      });
      await client.tenantUserBranch.createMany({
        data: access.branchIds.map((branchId) => ({
          tenantId,
          userId: id,
          branchId,
        })),
        skipDuplicates: true,
      });
    }
    return toMember(
      await client.tenantUser.update({
        where: staffRow(tenantId, id),
        data: {
          branchAccess: access.branchAccess,
          defaultBranchId: access.defaultBranchId,
        },
        select: STAFF_SELECT,
      }),
    );
  }

  async setPassword(
    tenantId: string,
    id: string,
    passwordHash: string,
  ): Promise<StaffMember> {
    return toMember(
      await this.tx.client.tenantUser.update({
        where: staffRow(tenantId, id),
        data: { passwordHash, mustChangePassword: true },
        select: STAFF_SELECT,
      }),
    );
  }

  async setStatus(
    tenantId: string,
    id: string,
    status: TenantUserStatus,
    disabledAt: Date | null,
  ): Promise<StaffMember> {
    return toMember(
      await this.tx.client.tenantUser.update({
        where: staffRow(tenantId, id),
        data: { status, disabledAt },
        select: STAFF_SELECT,
      }),
    );
  }
}
