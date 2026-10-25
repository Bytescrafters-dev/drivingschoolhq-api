import { Module } from '@nestjs/common';
import { TenantAuthModule } from './auth/tenant-auth.module.js';
import { BranchesModule } from './branches/branches.module.js';

/** Root of the driving-school (tenant) domain. */
@Module({
  imports: [TenantAuthModule, BranchesModule],
})
export class TenantModule {}
