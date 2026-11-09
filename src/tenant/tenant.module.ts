import { Module } from '@nestjs/common';
import { TenantAuthModule } from './auth/tenant-auth.module.js';
import { BranchesModule } from './branches/branches.module.js';
import { BranchProfileModule } from './branches/profile/branch-profile.module.js';
import { InstructorsModule } from './instructors/instructors.module.js';
import { MyProfileModule } from './profile/my-profile.module.js';
import { StaffModule } from './staff/staff.module.js';

/** Root of the driving-school (tenant) domain. */
@Module({
  imports: [
    TenantAuthModule,
    BranchesModule,
    BranchProfileModule,
    StaffModule,
    InstructorsModule,
    MyProfileModule,
  ],
})
export class TenantModule {}
