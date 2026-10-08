import { Module } from '@nestjs/common';
import { PlatformAdminAuthModule } from './admin-auth/platform-admin-auth.module.js';
import { PlatformAdminUsersModule } from './admin-users/platform-admin-users.module.js';
import { PlatformAuditModule } from './audit/platform-audit.module.js';

@Module({
  imports: [
    PlatformAdminAuthModule,
    PlatformAdminUsersModule,
    PlatformAuditModule,
  ],
})
export class PlatformModule {}
