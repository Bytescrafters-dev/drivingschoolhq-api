import { Module } from '@nestjs/common';
import { TenantAuditModule } from '../../audit/tenant-audit.module.js';
import { TenantAuthCoreModule } from '../../auth/tenant-auth-core.module.js';
import { BranchesCoreModule } from '../branches-core.module.js';
import { BranchProfileCoreModule } from './branch-profile-core.module.js';
import {
  BranchProfileController,
  TenantVehicleClassesController,
} from './branch-profile.controller.js';
import { BranchProfileService } from './branch-profile.service.js';

@Module({
  imports: [
    TenantAuthCoreModule,
    BranchesCoreModule,
    BranchProfileCoreModule,
    TenantAuditModule,
  ],
  controllers: [BranchProfileController, TenantVehicleClassesController],
  providers: [BranchProfileService],
})
export class BranchProfileModule {}
