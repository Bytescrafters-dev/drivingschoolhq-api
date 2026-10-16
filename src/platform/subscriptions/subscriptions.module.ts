import { Module } from '@nestjs/common';
import { PlatformAuditModule } from '../audit/platform-audit.module.js';
import { PlansModule } from '../plans/plans.module.js';
import { PrismaTenantSubscriptionRepository } from './infra/prisma-tenant-subscription.repository.js';
import { TENANT_SUBSCRIPTION_REPOSITORY } from './interfaces/tenant-subscription.repository.js';
import { SubscriptionsService } from './subscriptions.service.js';

/** Tenant subscriptions. No HTTP surface yet (chunk 4); used by tenants. */
@Module({
  imports: [PlansModule, PlatformAuditModule],
  providers: [
    SubscriptionsService,
    {
      provide: TENANT_SUBSCRIPTION_REPOSITORY,
      useClass: PrismaTenantSubscriptionRepository,
    },
  ],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
