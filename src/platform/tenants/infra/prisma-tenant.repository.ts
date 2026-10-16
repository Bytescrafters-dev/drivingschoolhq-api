import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client.js';
import {
  TenantAccessStatus,
  type TenantStatus,
  TenantSubscriptionStatus,
} from '../../../generated/prisma/enums.js';
import { AppError } from '../../../common/errors/app-error.js';
import { TransactionManager } from '../../../prisma/transaction-manager.js';
import type {
  NewTenant,
  Tenant,
  TenantAccess,
  TenantListFilter,
  TenantListItem,
  TenantProfileChange,
  TenantRepository,
} from '../interfaces/tenant.repository.js';

const TENANT_SELECT = {
  id: true,
  dsCode: true,
  name: true,
  displayName: true,
  address: true,
  district: true,
  phone: true,
  status: true,
  closedAt: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.TenantSelect;

const ACCESS_SELECT = {
  status: true,
  statusChangedAt: true,
} as const satisfies Prisma.TenantAccessSelect;

function dsCodeTaken(error: unknown): never {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  ) {
    throw new AppError(
      'CONFLICT',
      'TENANT_DS_CODE_TAKEN',
      'A tenant with this DS code already exists',
    );
  }
  throw error;
}

@Injectable()
export class PrismaTenantRepository implements TenantRepository {
  constructor(private readonly tx: TransactionManager) {}

  async create(tenant: NewTenant): Promise<Tenant> {
    try {
      return await this.tx.client.tenant.create({
        data: tenant,
        select: TENANT_SELECT,
      });
    } catch (error) {
      dsCodeTaken(error);
    }
  }

  findById(id: string): Promise<Tenant | null> {
    return this.tx.client.tenant.findUnique({
      where: { id },
      select: TENANT_SELECT,
    });
  }

  async lockById(id: string): Promise<Tenant | null> {
    const locked = await this.tx.client.$queryRaw<{ id: string }[]>`
      SELECT id FROM tenants WHERE id = ${id}::uuid FOR UPDATE`;
    if (locked.length === 0) return null;
    return this.findById(id);
  }

  async list(
    filter: TenantListFilter,
    page: { skip: number; take: number },
  ): Promise<{ items: TenantListItem[]; total: number }> {
    const where: Prisma.TenantWhereInput = {
      status: filter.status,
      district: filter.district,
      ...(filter.accessStatus
        ? { access: { status: filter.accessStatus } }
        : {}),
      ...(filter.search
        ? {
            OR: [
              { dsCode: { contains: filter.search, mode: 'insensitive' } },
              { name: { contains: filter.search, mode: 'insensitive' } },
              {
                displayName: { contains: filter.search, mode: 'insensitive' },
              },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.tx.client.tenant.findMany({
        where,
        select: {
          ...TENANT_SELECT,
          access: { select: { status: true } },
          subscriptions: {
            where: { status: TenantSubscriptionStatus.ACTIVE },
            select: { planName: true, billingPeriod: true },
            take: 1,
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: page.skip,
        take: page.take,
      }),
      this.tx.client.tenant.count({ where }),
    ]);
    const items = rows.map(({ access, subscriptions, ...tenant }) => ({
      ...tenant,
      accessStatus: access?.status ?? null,
      currentPlan: subscriptions[0] ?? null,
    }));
    return { items, total };
  }

  async updateProfile(
    id: string,
    change: TenantProfileChange,
  ): Promise<Tenant> {
    try {
      return await this.tx.client.tenant.update({
        where: { id },
        data: change,
        select: TENANT_SELECT,
      });
    } catch (error) {
      dsCodeTaken(error);
    }
  }

  setStatus(
    id: string,
    status: TenantStatus,
    closedAt: Date | null,
  ): Promise<Tenant> {
    return this.tx.client.tenant.update({
      where: { id },
      data: { status, closedAt },
      select: TENANT_SELECT,
    });
  }

  createAccess(tenantId: string, at: Date): Promise<TenantAccess> {
    return this.tx.client.tenantAccess.create({
      data: {
        tenantId,
        status: TenantAccessStatus.ACTIVE,
        statusChangedAt: at,
      },
      select: ACCESS_SELECT,
    });
  }

  findAccess(tenantId: string): Promise<TenantAccess | null> {
    return this.tx.client.tenantAccess.findUnique({
      where: { tenantId },
      select: ACCESS_SELECT,
    });
  }

  setAccessStatus(
    tenantId: string,
    status: TenantAccessStatus,
    at: Date,
  ): Promise<TenantAccess> {
    return this.tx.client.tenantAccess.update({
      where: { tenantId },
      data: { status, statusChangedAt: at },
      select: ACCESS_SELECT,
    });
  }
}
