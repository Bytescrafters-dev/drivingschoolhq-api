import { Module } from '@nestjs/common';
import { PrismaTenantSessionRepository } from './infra/prisma-tenant-session.repository.js';
import { TENANT_SESSION_REPOSITORY } from './interfaces/tenant-session.repository.js';
import { TenantSessionsService } from './tenant-sessions.service.js';

@Module({
  providers: [
    TenantSessionsService,
    {
      provide: TENANT_SESSION_REPOSITORY,
      useClass: PrismaTenantSessionRepository,
    },
  ],
  exports: [TenantSessionsService, TENANT_SESSION_REPOSITORY],
})
export class TenantSessionsModule {}
