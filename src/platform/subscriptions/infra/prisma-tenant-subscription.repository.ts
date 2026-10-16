import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client.js';
import { TenantSubscriptionStatus } from '../../../generated/prisma/enums.js';
import { AppError } from '../../../common/errors/app-error.js';
import { TransactionManager } from '../../../prisma/transaction-manager.js';
import type {
  CurrentSubscriptions,
  NewActiveSubscription,
  NewScheduledSubscription,
  TenantSubscription,
  TenantSubscriptionRepository,
} from '../interfaces/tenant-subscription.repository.js';

type Row = Prisma.TenantSubscriptionGetPayload<object>;

const CURRENT_STATUSES = [
  TenantSubscriptionStatus.ACTIVE,
  TenantSubscriptionStatus.SCHEDULED,
];

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

function toCurrent(rows: Row[]): CurrentSubscriptions {
  const find = (status: TenantSubscriptionStatus) => {
    const row = rows.find((r) => r.status === status);
    return row ? toSubscription(row) : null;
  };
  return {
    active: find(TenantSubscriptionStatus.ACTIVE),
    scheduled: find(TenantSubscriptionStatus.SCHEDULED),
  };
}

function toSubscription(row: Row): TenantSubscription {
  return {
    ...row,
    listAmount: row.listAmount.toFixed(2),
    agreedAmount: row.agreedAmount.toFixed(2),
  };
}

@Injectable()
export class PrismaTenantSubscriptionRepository implements TenantSubscriptionRepository {
  constructor(private readonly tx: TransactionManager) {}

  async createActive(
    subscription: NewActiveSubscription,
  ): Promise<TenantSubscription> {
    try {
      const row = await this.tx.client.tenantSubscription.create({
        data: { ...subscription, status: TenantSubscriptionStatus.ACTIVE },
      });
      return toSubscription(row);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new AppError(
          'CONFLICT',
          'SUBSCRIPTION_ALREADY_ACTIVE',
          'The tenant already has an active subscription',
        );
      }
      throw error;
    }
  }

  async createScheduled(
    subscription: NewScheduledSubscription,
  ): Promise<TenantSubscription> {
    try {
      const row = await this.tx.client.tenantSubscription.create({
        data: { ...subscription, status: TenantSubscriptionStatus.SCHEDULED },
      });
      return toSubscription(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError(
          'CONFLICT',
          'SUBSCRIPTION_CHANGE_ALREADY_SCHEDULED',
          'The tenant already has a scheduled subscription change',
        );
      }
      throw error;
    }
  }

  async findCurrent(tenantId: string): Promise<CurrentSubscriptions> {
    const rows = await this.tx.client.tenantSubscription.findMany({
      where: { tenantId, status: { in: CURRENT_STATUSES } },
    });
    return toCurrent(rows);
  }

  async lockCurrent(tenantId: string): Promise<CurrentSubscriptions> {
    await this.tx.client.$queryRaw`
      SELECT id FROM tenant_subscriptions
      WHERE "tenantId" = ${tenantId}::uuid
        AND status IN ('ACTIVE', 'SCHEDULED')
      ORDER BY id
      FOR UPDATE`;
    return this.findCurrent(tenantId);
  }

  async listForTenant(tenantId: string): Promise<TenantSubscription[]> {
    const rows = await this.tx.client.tenantSubscription.findMany({
      where: { tenantId },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    });
    return rows.map(toSubscription);
  }

  async findTenantIdsWithDueChanges(
    today: Date,
    limit: number,
  ): Promise<string[]> {
    const rows = await this.tx.client.tenantSubscription.findMany({
      where: {
        status: TenantSubscriptionStatus.SCHEDULED,
        startDate: { lte: today },
      },
      select: { tenantId: true },
      orderBy: [{ startDate: 'asc' }, { id: 'asc' }],
      take: limit,
    });
    return rows.map((r) => r.tenantId);
  }

  async activate(id: string): Promise<TenantSubscription> {
    const row = await this.tx.client.tenantSubscription.update({
      where: { id },
      data: { status: TenantSubscriptionStatus.ACTIVE },
    });
    return toSubscription(row);
  }

  async updateGracePeriod(
    id: string,
    days: number,
  ): Promise<TenantSubscription> {
    const row = await this.tx.client.tenantSubscription.update({
      where: { id },
      data: { gracePeriodDays: days },
    });
    return toSubscription(row);
  }

  async end(id: string, endDate: Date): Promise<TenantSubscription> {
    const row = await this.tx.client.tenantSubscription.update({
      where: { id },
      data: { status: TenantSubscriptionStatus.ENDED, endDate },
    });
    return toSubscription(row);
  }

  async cancel(
    id: string,
    cancellation: { at: Date; byId: string; reason: string },
  ): Promise<TenantSubscription> {
    const row = await this.tx.client.tenantSubscription.update({
      where: { id },
      data: {
        status: TenantSubscriptionStatus.CANCELLED,
        cancelledAt: cancellation.at,
        cancelledById: cancellation.byId,
        cancellationReason: cancellation.reason,
      },
    });
    return toSubscription(row);
  }
}
