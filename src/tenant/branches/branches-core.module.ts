import { Module } from '@nestjs/common';
import { BranchAccessService } from './branch-access.service.js';
import { BranchProvisioningService } from './branch-provisioning.service.js';
import { BranchContextGuard } from './guards/branch-context.guard.js';
import { PrismaBranchRepository } from './infra/prisma-branch.repository.js';
import { BRANCH_REPOSITORY } from './interfaces/branch.repository.js';

/**
 * Branch building blocks shared across modules: branch access checks, the
 * X-Branch-Id guard (every branch-scoped module imports this), and Main
 * Branch provisioning for the platform domain.
 */
@Module({
  providers: [
    BranchAccessService,
    BranchProvisioningService,
    BranchContextGuard,
    { provide: BRANCH_REPOSITORY, useClass: PrismaBranchRepository },
  ],
  exports: [
    BranchAccessService,
    BranchProvisioningService,
    BranchContextGuard,
    BRANCH_REPOSITORY,
  ],
})
export class BranchesCoreModule {}
