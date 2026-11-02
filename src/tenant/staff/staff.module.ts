import { Module } from '@nestjs/common';
import { PasswordHasher } from '../../common/security/password-hasher.js';
import { EntitlementsModule } from '../../platform/entitlements/entitlements.module.js';
import { TenantAuditModule } from '../audit/tenant-audit.module.js';
import { TenantAuthCoreModule } from '../auth/tenant-auth-core.module.js';
import { BranchesCoreModule } from '../branches/branches-core.module.js';
import { TenantContextModule } from '../context/tenant-context.module.js';
import { TenantSessionsModule } from '../sessions/tenant-sessions.module.js';
import { StaffCoreModule } from './staff-core.module.js';
import { StaffController } from './staff.controller.js';
import { StaffService } from './staff.service.js';

@Module({
  imports: [
    TenantAuthCoreModule,
    StaffCoreModule,
    BranchesCoreModule,
    TenantContextModule,
    TenantSessionsModule,
    TenantAuditModule,
    EntitlementsModule,
  ],
  controllers: [StaffController],
  providers: [StaffService, PasswordHasher],
})
export class StaffModule {}
