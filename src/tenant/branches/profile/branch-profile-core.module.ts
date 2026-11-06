import { Module } from '@nestjs/common';
import { VehicleClassesModule } from '../../../reference-data/vehicle-classes/vehicle-classes.module.js';
import { BranchCapabilityService } from './branch-capability.service.js';
import { BranchProfileReader } from './branch-profile-reader.service.js';
import { PrismaBranchProfileRepository } from './infra/prisma-branch-profile.repository.js';
import { BRANCH_PROFILE_REPOSITORY } from './interfaces/branch-profile.repository.js';

/**
 * Branch profile building blocks shared by the branch endpoints, the platform
 * tenant views and (later) class-dependent modules.
 */
@Module({
  imports: [VehicleClassesModule],
  providers: [
    BranchProfileReader,
    BranchCapabilityService,
    {
      provide: BRANCH_PROFILE_REPOSITORY,
      useClass: PrismaBranchProfileRepository,
    },
  ],
  exports: [
    BranchProfileReader,
    BranchCapabilityService,
    BRANCH_PROFILE_REPOSITORY,
    VehicleClassesModule,
  ],
})
export class BranchProfileCoreModule {}
