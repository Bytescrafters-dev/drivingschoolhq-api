import { Inject, Injectable } from '@nestjs/common';
import type { District } from '../../generated/prisma/enums.js';
import {
  BRANCH_REPOSITORY,
  type Branch,
  type BranchRepository,
} from './interfaces/branch.repository.js';

export const MAIN_BRANCH_NAME = 'Main Branch';

export interface ProvisionMainBranchInput {
  tenantId: string;
  address: string;
  district: District;
  /** Normalised +94XXXXXXXXX. */
  phone: string;
  createdByPlatformAdminId: string;
}

/**
 * Entry point for the platform domain: the Main Branch created with a tenant,
 * and a read-only view of a tenant's branches. Joins the caller's transaction.
 */
@Injectable()
export class BranchProvisioningService {
  constructor(
    @Inject(BRANCH_REPOSITORY) private readonly branches: BranchRepository,
  ) {}

  /** Details are copied once from the tenant profile; the owner may edit them later. */
  provisionMainBranch(input: ProvisionMainBranchInput): Promise<Branch> {
    return this.branches.create({
      tenantId: input.tenantId,
      name: MAIN_BRANCH_NAME,
      address: input.address,
      district: input.district,
      phone: input.phone,
      createdByPlatformAdminId: input.createdByPlatformAdminId,
    });
  }

  listForTenant(tenantId: string): Promise<Branch[]> {
    return this.branches.listForTenant(tenantId, { includeClosed: true });
  }

  findForTenant(tenantId: string, branchId: string): Promise<Branch | null> {
    return this.branches.findById(tenantId, branchId);
  }
}
