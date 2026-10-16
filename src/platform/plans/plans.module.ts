import { Module } from '@nestjs/common';
import { PlatformAuthCoreModule } from '../admin-auth/platform-auth-core.module.js';
import { PlatformAuditModule } from '../audit/platform-audit.module.js';
import { PrismaPlanRepository } from './infra/prisma-plan.repository.js';
import { PLAN_REPOSITORY } from './interfaces/plan.repository.js';
import { PlansController } from './plans.controller.js';
import { PlansService } from './plans.service.js';

@Module({
  imports: [PlatformAuthCoreModule, PlatformAuditModule],
  controllers: [PlansController],
  providers: [
    PlansService,
    { provide: PLAN_REPOSITORY, useClass: PrismaPlanRepository },
  ],
  // Read access to the catalogue for subscriptions (getSubscribablePrice).
  exports: [PlansService],
})
export class PlansModule {}
