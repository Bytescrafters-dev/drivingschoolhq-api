import { Module } from '@nestjs/common';
import { PlatformAuthCoreModule } from '../admin-auth/platform-auth-core.module.js';
import { PlatformAuditModule } from '../audit/platform-audit.module.js';
import { PLATFORM_ADMIN_USER_REPOSITORY } from './interfaces/platform-admin-user.repository.js';
import { PlatformAdminsController } from './platform-admins.controller.js';
import { PlatformAdminsService } from './platform-admins.service.js';
import { PrismaPlatformAdminUserRepository } from './infra/prisma-platform-admin-user.repository.js';

@Module({
  imports: [PlatformAuthCoreModule, PlatformAuditModule],
  controllers: [PlatformAdminsController],
  providers: [
    PlatformAdminsService,
    {
      provide: PLATFORM_ADMIN_USER_REPOSITORY,
      useClass: PrismaPlatformAdminUserRepository,
    },
  ],
  // The repository is shared with the platform admin auth module (same platform
  // identity sub-domain) for credential lookups and password changes.
  exports: [PLATFORM_ADMIN_USER_REPOSITORY],
})
export class PlatformAdminUsersModule {}
