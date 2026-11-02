import { Module } from '@nestjs/common';
import { TenantAuditModule } from '../audit/tenant-audit.module.js';
import { TenantAuthCoreModule } from '../auth/tenant-auth-core.module.js';
import { TenantUsersModule } from '../users/tenant-users.module.js';
import { MyProfileController } from './my-profile.controller.js';
import { MyProfileService } from './my-profile.service.js';

@Module({
  imports: [TenantAuthCoreModule, TenantUsersModule, TenantAuditModule],
  controllers: [MyProfileController],
  providers: [MyProfileService],
})
export class MyProfileModule {}
