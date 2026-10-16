import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client.js';
import {
  TenantRole,
  TenantUserStatus,
} from '../../../generated/prisma/enums.js';
import { AppError } from '../../../common/errors/app-error.js';
import { violatedUniqueIndex } from '../../../prisma/prisma-errors.js';
import { TransactionManager } from '../../../prisma/transaction-manager.js';
import type {
  NewTenantOwner,
  TenantOwnerProfileChange,
  TenantUser,
  TenantUserCredentials,
  TenantUserRepository,
} from '../interfaces/tenant-user.repository.js';

const TENANT_USER_SELECT = {
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
  createdByPlatformAdminId: true,
  createdByTenantUserId: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.TenantUserSelect;

@Injectable()
export class PrismaTenantUserRepository implements TenantUserRepository {
  constructor(private readonly tx: TransactionManager) {}

  async createOwner(owner: NewTenantOwner): Promise<TenantUser> {
    try {
      return await this.tx.client.tenantUser.create({
        data: { ...owner, role: TenantRole.OWNER, mustChangePassword: true },
        select: TENANT_USER_SELECT,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new AppError(
          'CONFLICT',
          'TENANT_OWNER_EXISTS',
          'The tenant already has an owner',
        );
      }
      throw error;
    }
  }

  findOwner(tenantId: string): Promise<TenantUser | null> {
    return this.tx.client.tenantUser.findFirst({
      where: { tenantId, role: TenantRole.OWNER },
      select: TENANT_USER_SELECT,
    });
  }

  async lockOwner(tenantId: string): Promise<TenantUser | null> {
    await this.tx.client.$queryRaw`
      SELECT id FROM tenant_users
      WHERE "tenantId" = ${tenantId}::uuid AND role = 'OWNER'
      FOR UPDATE`;
    return this.findOwner(tenantId);
  }

  async updateOwnerProfile(
    tenantId: string,
    change: TenantOwnerProfileChange,
  ): Promise<TenantUser> {
    try {
      return await this.updateOwner(tenantId, change);
    } catch (error) {
      const index = violatedUniqueIndex(error, [
        'tenant_users_tenantId_email_key',
        'tenant_users_tenantId_nic_key',
      ]);
      if (index === 'tenant_users_tenantId_email_key') {
        throw new AppError(
          'CONFLICT',
          'TENANT_USER_EMAIL_TAKEN',
          'Another user of this tenant already uses this email',
        );
      }
      if (index === 'tenant_users_tenantId_nic_key') {
        throw new AppError(
          'CONFLICT',
          'TENANT_USER_NIC_TAKEN',
          'Another user of this tenant already uses this NIC',
        );
      }
      throw error;
    }
  }

  setOwnerPassword(
    tenantId: string,
    passwordHash: string,
  ): Promise<TenantUser> {
    return this.updateOwner(tenantId, {
      passwordHash,
      mustChangePassword: true,
    });
  }

  disableOwner(tenantId: string, at: Date): Promise<TenantUser> {
    return this.updateOwner(tenantId, {
      status: TenantUserStatus.DISABLED,
      disabledAt: at,
    });
  }

  enableOwner(tenantId: string): Promise<TenantUser> {
    return this.updateOwner(tenantId, {
      status: TenantUserStatus.ACTIVE,
      disabledAt: null,
    });
  }

  findCredentialsByEmail(
    tenantId: string,
    email: string,
  ): Promise<TenantUserCredentials | null> {
    return this.findCredentials({ tenantId_email: { tenantId, email } });
  }

  findCredentialsById(
    tenantId: string,
    id: string,
  ): Promise<TenantUserCredentials | null> {
    return this.findCredentials({ tenantId_id: { tenantId, id } });
  }

  async recordLogin(tenantId: string, id: string, at: Date): Promise<void> {
    await this.tx.client.tenantUser.update({
      where: { tenantId_id: { tenantId, id } },
      data: { lastLoginAt: at },
      select: { id: true },
    });
  }

  async setOwnPassword(
    tenantId: string,
    id: string,
    passwordHash: string,
    at: Date,
  ): Promise<void> {
    await this.tx.client.tenantUser.update({
      where: { tenantId_id: { tenantId, id } },
      data: { passwordHash, mustChangePassword: false, passwordChangedAt: at },
      select: { id: true },
    });
  }

  private async findCredentials(
    where: Prisma.TenantUserWhereUniqueInput,
  ): Promise<TenantUserCredentials | null> {
    const row = await this.tx.client.tenantUser.findUnique({
      where,
      select: { ...TENANT_USER_SELECT, passwordHash: true },
    });
    if (!row) return null;
    const { passwordHash, ...user } = row;
    return { user, passwordHash };
  }

  /** Updates the single OWNER row of the tenant; never any other user. */
  private async updateOwner(
    tenantId: string,
    data: Prisma.TenantUserUpdateManyMutationInput,
  ): Promise<TenantUser> {
    const owner = await this.findOwner(tenantId);
    if (!owner) {
      throw new AppError(
        'NOT_FOUND',
        'TENANT_OWNER_NOT_FOUND',
        'Tenant owner not found',
      );
    }
    return this.tx.client.tenantUser.update({
      where: {
        tenantId_id: { tenantId, id: owner.id },
        role: TenantRole.OWNER,
      },
      data,
      select: TENANT_USER_SELECT,
    });
  }
}
