import { Module } from '@nestjs/common';
import { PrismaTenantAuditRepository } from './infra/prisma-tenant-audit.repository.js';
import { TENANT_AUDIT_REPOSITORY } from './interfaces/tenant-audit.repository.js';
import { TenantAuditService } from './tenant-audit.service.js';

@Module({
  providers: [
    TenantAuditService,
    { provide: TENANT_AUDIT_REPOSITORY, useClass: PrismaTenantAuditRepository },
  ],
  exports: [TenantAuditService],
})
export class TenantAuditModule {}
