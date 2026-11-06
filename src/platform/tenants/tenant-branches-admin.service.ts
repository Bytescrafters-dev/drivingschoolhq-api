import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error.js';
import { BranchProvisioningService } from '../../tenant/branches/branch-provisioning.service.js';
import type { Branch } from '../../tenant/branches/interfaces/branch.repository.js';
import {
  type BranchProfile,
  BranchProfileReader,
  type BranchProfileSummary,
} from '../../tenant/branches/profile/branch-profile-reader.service.js';
import {
  TENANT_REPOSITORY,
  type TenantRepository,
} from './interfaces/tenant.repository.js';

export interface TenantBranchOverview {
  branch: Branch;
  profile: BranchProfileSummary;
}

/**
 * Read-only view of a tenant's branches and branch profiles (grade, licence,
 * offered classes) for platform admins. Branches are managed by the school.
 */
@Injectable()
export class TenantBranchesAdminService {
  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepository,
    private readonly branches: BranchProvisioningService,
    private readonly profiles: BranchProfileReader,
  ) {}

  /** Every branch (oldest first, any status) with its profile summary. */
  async list(tenantId: string): Promise<TenantBranchOverview[]> {
    await this.assertTenant(tenantId);
    const branches = await this.branches.listForTenant(tenantId);
    const summaries = await this.profiles.summaries(tenantId, branches);
    return branches.map((branch) => ({
      branch,
      profile: summaries.get(branch.id)!,
    }));
  }

  async profile(tenantId: string, branchId: string): Promise<BranchProfile> {
    await this.assertTenant(tenantId);
    const branch = await this.branches.findForTenant(tenantId, branchId);
    if (!branch) {
      throw new AppError('NOT_FOUND', 'BRANCH_NOT_FOUND', 'Branch not found');
    }
    return this.profiles.profile(branch);
  }

  private async assertTenant(tenantId: string): Promise<void> {
    if (!(await this.tenants.findById(tenantId))) {
      throw new AppError('NOT_FOUND', 'TENANT_NOT_FOUND', 'Tenant not found');
    }
  }
}
