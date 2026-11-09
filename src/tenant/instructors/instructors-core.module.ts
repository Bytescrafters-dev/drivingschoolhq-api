import { Module } from '@nestjs/common';
import { BranchProfileCoreModule } from '../branches/profile/branch-profile-core.module.js';
import { PrismaInstructorProfileRepository } from './infra/prisma-instructor-profile.repository.js';
import { InstructorCapabilityService } from './instructor-capability.service.js';
import { INSTRUCTOR_PROFILE_REPOSITORY } from './interfaces/instructor-profile.repository.js';

/**
 * Instructor building blocks for the instructor endpoints and (later)
 * training/scheduling: persistence and the "can teach here" gate.
 */
@Module({
  imports: [BranchProfileCoreModule],
  providers: [
    InstructorCapabilityService,
    {
      provide: INSTRUCTOR_PROFILE_REPOSITORY,
      useClass: PrismaInstructorProfileRepository,
    },
  ],
  exports: [
    InstructorCapabilityService,
    INSTRUCTOR_PROFILE_REPOSITORY,
    BranchProfileCoreModule,
  ],
})
export class InstructorsCoreModule {}
