import { Module } from '@nestjs/common';
import { EntitlementsModule } from '../../platform/entitlements/entitlements.module.js';
import { TenantAuditModule } from '../audit/tenant-audit.module.js';
import { TenantAuthCoreModule } from '../auth/tenant-auth-core.module.js';
import { BranchesCoreModule } from '../branches/branches-core.module.js';
import { TenantContextModule } from '../context/tenant-context.module.js';
import { StaffCoreModule } from '../staff/staff-core.module.js';
import { InstructorsCoreModule } from './instructors-core.module.js';
import {
  InstructorsController,
  MyInstructorProfileController,
} from './instructors.controller.js';
import { InstructorsService } from './instructors.service.js';

@Module({
  imports: [
    TenantAuthCoreModule,
    BranchesCoreModule,
    StaffCoreModule,
    InstructorsCoreModule,
    TenantContextModule,
    TenantAuditModule,
    EntitlementsModule,
  ],
  controllers: [InstructorsController, MyInstructorProfileController],
  providers: [InstructorsService],
})
export class InstructorsModule {}
