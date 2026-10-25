import { Module } from '@nestjs/common';
import { PrismaTenantEntitlementsRepository } from './infra/prisma-tenant-entitlements.repository.js';
import { TENANT_ENTITLEMENTS_REPOSITORY } from './interfaces/tenant-entitlements.repository.js';
import { TenantEntitlementsService } from './tenant-entitlements.service.js';

/** Plan limits/features as seen by business modules (read-only). */
@Module({
  providers: [
    TenantEntitlementsService,
    {
      provide: TENANT_ENTITLEMENTS_REPOSITORY,
      useClass: PrismaTenantEntitlementsRepository,
    },
  ],
  exports: [TenantEntitlementsService],
})
export class EntitlementsModule {}
