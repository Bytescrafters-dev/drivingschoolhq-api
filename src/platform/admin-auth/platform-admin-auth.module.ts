import { Module } from '@nestjs/common';
import { PlatformAdminUsersModule } from '../admin-users/platform-admin-users.module.js';
import { PlatformAuditModule } from '../audit/platform-audit.module.js';
import { PlatformAdminAuthController } from './platform-admin-auth.controller.js';
import { PlatformAdminAuthService } from './platform-admin-auth.service.js';
import { PlatformAuthCoreModule } from './platform-auth-core.module.js';

@Module({
  imports: [
    PlatformAuthCoreModule,
    PlatformAdminUsersModule,
    PlatformAuditModule,
  ],
  controllers: [PlatformAdminAuthController],
  providers: [PlatformAdminAuthService],
})
export class PlatformAdminAuthModule {}
