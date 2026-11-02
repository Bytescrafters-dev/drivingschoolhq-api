import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error.js';
import { PlanLimitCode } from '../../generated/prisma/enums.js';
import {
  STAFF_REPOSITORY,
  type StaffMember,
  type StaffRepository,
} from '../../tenant/staff/interfaces/staff.repository.js';
import { TenantEntitlementsService } from '../entitlements/tenant-entitlements.service.js';
import {
  TENANT_REPOSITORY,
  type TenantRepository,
} from './interfaces/tenant.repository.js';

export interface TenantUsersOverview {
  users: StaffMember[];
  /** ACTIVE users including the owner. */
  seatsUsed: number;
  /** The plan's MAX_STAFF_USERS; null = unlimited. */
  seatLimit: number | null;
}

/**
 * Read-only view of a tenant's users for platform admins. Staff are managed
 * by the school itself; the platform only manages the OWNER.
 */
@Injectable()
export class TenantUsersAdminService {
  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepository,
    @Inject(STAFF_REPOSITORY) private readonly staff: StaffRepository,
    private readonly entitlements: TenantEntitlementsService,
  ) {}

  async overview(tenantId: string): Promise<TenantUsersOverview> {
    if (!(await this.tenants.findById(tenantId))) {
      throw new AppError('NOT_FOUND', 'TENANT_NOT_FOUND', 'Tenant not found');
    }
    const [users, seatsUsed, seatLimit] = await Promise.all([
      this.staff.listForTenant(tenantId),
      this.staff.countActive(tenantId),
      this.entitlements.limit(tenantId, PlanLimitCode.MAX_STAFF_USERS),
    ]);
    return { users, seatsUsed, seatLimit };
  }
}
