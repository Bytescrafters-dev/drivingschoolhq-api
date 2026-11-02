import { Module } from '@nestjs/common';
import { TenantAuthModule } from './auth/tenant-auth.module.js';
import { BranchesModule } from './branches/branches.module.js';
import { MyProfileModule } from './profile/my-profile.module.js';
import { StaffModule } from './staff/staff.module.js';

/** Root of the driving-school (tenant) domain. */
@Module({
  imports: [TenantAuthModule, BranchesModule, StaffModule, MyProfileModule],
})
export class TenantModule {}
