import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import { TransactionManager } from '../../../prisma/transaction-manager.js';
import type {
  TenantContext,
  TenantContextRepository,
} from '../interfaces/tenant-context.repository.js';

const SELECT = {
  id: true,
  dsCode: true,
  displayName: true,
  status: true,
  access: { select: { status: true } },
} as const satisfies Prisma.TenantSelect;

type Row = Prisma.TenantGetPayload<{ select: typeof SELECT }>;

function toContext({ access, ...tenant }: Row): TenantContext {
  return { ...tenant, accessStatus: access?.status ?? null };
}

@Injectable()
export class PrismaTenantContextRepository implements TenantContextRepository {
  constructor(private readonly tx: TransactionManager) {}

  async findByDsCode(dsCode: string): Promise<TenantContext | null> {
    const row = await this.tx.client.tenant.findUnique({
      where: { dsCode },
      select: SELECT,
    });
    return row ? toContext(row) : null;
  }

  async findById(id: string): Promise<TenantContext | null> {
    const row = await this.tx.client.tenant.findUnique({
      where: { id },
      select: SELECT,
    });
    return row ? toContext(row) : null;
  }
}
