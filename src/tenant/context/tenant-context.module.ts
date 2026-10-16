import { Module } from '@nestjs/common';
import { PrismaTenantContextRepository } from './infra/prisma-tenant-context.repository.js';
import { TENANT_CONTEXT_REPOSITORY } from './interfaces/tenant-context.repository.js';

/** Read-only view of tenants for the driving-school domain. */
@Module({
  providers: [
    {
      provide: TENANT_CONTEXT_REPOSITORY,
      useClass: PrismaTenantContextRepository,
    },
  ],
  exports: [TENANT_CONTEXT_REPOSITORY],
})
export class TenantContextModule {}
