import { Module } from '@nestjs/common';
import { EntitlementsModule } from '../../platform/entitlements/entitlements.module.js';
import { TenantAuditModule } from '../audit/tenant-audit.module.js';
import { TenantAuthCoreModule } from '../auth/tenant-auth-core.module.js';
import { TenantContextModule } from '../context/tenant-context.module.js';
import { TenantSessionsModule } from '../sessions/tenant-sessions.module.js';
import { BranchesCoreModule } from './branches-core.module.js';
import {
  BranchContextController,
  BranchesController,
  MyDefaultBranchController,
} from './branches.controller.js';
import { BranchesService } from './branches.service.js';
import { BranchProfileCoreModule } from './profile/branch-profile-core.module.js';

@Module({
  imports: [
    TenantAuthCoreModule,
    BranchesCoreModule,
    TenantContextModule,
    TenantAuditModule,
    EntitlementsModule,
    TenantSessionsModule,
    BranchProfileCoreModule,
  ],
  controllers: [
    BranchesController,
    MyDefaultBranchController,
    BranchContextController,
  ],
  providers: [BranchesService],
})
export class BranchesModule {}
