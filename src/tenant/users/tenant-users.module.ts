import { Module } from '@nestjs/common';
import { TenantSessionsModule } from '../sessions/tenant-sessions.module.js';
import { PrismaTenantUserRepository } from './infra/prisma-tenant-user.repository.js';
import { TENANT_USER_REPOSITORY } from './interfaces/tenant-user.repository.js';
import { TenantOwnersService } from './tenant-owners.service.js';

/** Driving-school users. Exposes OWNER provisioning to the platform domain. */
@Module({
  imports: [TenantSessionsModule],
  providers: [
    TenantOwnersService,
    { provide: TENANT_USER_REPOSITORY, useClass: PrismaTenantUserRepository },
  ],
  // The repository is shared with tenant auth (same identity sub-domain).
  exports: [TenantOwnersService, TENANT_USER_REPOSITORY],
})
export class TenantUsersModule {}
