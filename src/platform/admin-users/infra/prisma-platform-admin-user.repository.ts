import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client.js';
import {
  PlatformAdminStatus,
  type PlatformRole,
} from '../../../generated/prisma/enums.js';
import { AppError } from '../../../common/errors/app-error.js';
import { TransactionManager } from '../../../prisma/transaction-manager.js';
import type {
  NewPlatformAdmin,
  PlatformAdmin,
  PlatformAdminCredentials,
  PlatformAdminListFilter,
  PlatformAdminUserRepository,
} from '../interfaces/platform-admin-user.repository.js';

const ADMIN_SELECT = {
  id: true,
  email: true,
  fullName: true,
  role: true,
  status: true,
  mustChangePassword: true,
  passwordChangedAt: true,
  lastLoginAt: true,
  disabledAt: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.PlatformAdminUserSelect;

@Injectable()
export class PrismaPlatformAdminUserRepository implements PlatformAdminUserRepository {
  constructor(private readonly tx: TransactionManager) {}

  findById(id: string): Promise<PlatformAdmin | null> {
    return this.tx.client.platformAdminUser.findUnique({
      where: { id },
      select: ADMIN_SELECT,
    });
  }

  findCredentialsByEmail(
    email: string,
  ): Promise<PlatformAdminCredentials | null> {
    return this.findCredentials({ email });
  }

  findCredentialsById(id: string): Promise<PlatformAdminCredentials | null> {
    return this.findCredentials({ id });
  }

  async list(
    filter: PlatformAdminListFilter,
    page: { skip: number; take: number },
  ): Promise<{ items: PlatformAdmin[]; total: number }> {
    const where: Prisma.PlatformAdminUserWhereInput = {
      role: filter.role,
      status: filter.status,
      ...(filter.search
        ? {
            OR: [
              { email: { contains: filter.search, mode: 'insensitive' } },
              { fullName: { contains: filter.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.tx.client.platformAdminUser.findMany({
        where,
        select: ADMIN_SELECT,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: page.skip,
        take: page.take,
      }),
      this.tx.client.platformAdminUser.count({ where }),
    ]);
    return { items, total };
  }

  async create(admin: NewPlatformAdmin): Promise<PlatformAdmin> {
    try {
      return await this.tx.client.platformAdminUser.create({
        data: { ...admin, mustChangePassword: true },
        select: ADMIN_SELECT,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new AppError(
          'CONFLICT',
          'PLATFORM_ADMIN_EMAIL_TAKEN',
          'A platform admin with this email already exists',
        );
      }
      throw error;
    }
  }

  updateFullName(id: string, fullName: string): Promise<PlatformAdmin> {
    return this.update(id, { fullName });
  }

  changeRole(id: string, role: PlatformRole): Promise<PlatformAdmin> {
    return this.update(id, { role });
  }

  disable(id: string, at: Date): Promise<PlatformAdmin> {
    return this.update(id, {
      status: PlatformAdminStatus.DISABLED,
      disabledAt: at,
    });
  }

  enable(id: string): Promise<PlatformAdmin> {
    return this.update(id, {
      status: PlatformAdminStatus.ACTIVE,
      disabledAt: null,
    });
  }

  setPassword(
    id: string,
    change: {
      passwordHash: string;
      mustChangePassword: boolean;
      passwordChangedAt?: Date;
    },
  ): Promise<PlatformAdmin> {
    return this.update(id, change);
  }

  async recordLogin(id: string, at: Date): Promise<void> {
    await this.tx.client.platformAdminUser.update({
      where: { id },
      data: { lastLoginAt: at },
      select: { id: true },
    });
  }

  async lockActiveSuperAdminIds(): Promise<string[]> {
    const rows = await this.tx.client.$queryRaw<{ id: string }[]>`
      SELECT id FROM platform_admin_users
      WHERE role = 'SUPER_ADMIN' AND status = 'ACTIVE'
      ORDER BY id
      FOR UPDATE`;
    return rows.map((row) => row.id);
  }

  private update(
    id: string,
    data: Prisma.PlatformAdminUserUpdateInput,
  ): Promise<PlatformAdmin> {
    return this.tx.client.platformAdminUser.update({
      where: { id },
      data,
      select: ADMIN_SELECT,
    });
  }

  private async findCredentials(
    where: Prisma.PlatformAdminUserWhereUniqueInput,
  ): Promise<PlatformAdminCredentials | null> {
    const row = await this.tx.client.platformAdminUser.findUnique({
      where,
      select: { ...ADMIN_SELECT, passwordHash: true },
    });
    if (!row) return null;
    const { passwordHash, ...admin } = row;
    return { admin, passwordHash };
  }
}
