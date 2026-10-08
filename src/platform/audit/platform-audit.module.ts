import { Module } from '@nestjs/common';
import { PlatformAuthCoreModule } from '../admin-auth/platform-auth-core.module.js';
import { PlatformAuditController } from './platform-audit.controller.js';
import { PLATFORM_AUDIT_REPOSITORY } from './interfaces/platform-audit.repository.js';
import { PlatformAuditService } from './platform-audit.service.js';
import { PrismaPlatformAuditRepository } from './infra/prisma-platform-audit.repository.js';

@Module({
  imports: [PlatformAuthCoreModule],
  controllers: [PlatformAuditController],
  providers: [
    PlatformAuditService,
    {
      provide: PLATFORM_AUDIT_REPOSITORY,
      useClass: PrismaPlatformAuditRepository,
    },
  ],
  exports: [PlatformAuditService],
})
export class PlatformAuditModule {}
