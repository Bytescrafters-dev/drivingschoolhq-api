import { Module } from '@nestjs/common';
import { TenantSessionsModule } from '../../tenant/sessions/tenant-sessions.module.js';
import { TenantUsersModule } from '../../tenant/users/tenant-users.module.js';
import { PlatformAuthCoreModule } from '../admin-auth/platform-auth-core.module.js';
import { PlatformAuditModule } from '../audit/platform-audit.module.js';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module.js';
import { PrismaTenantRepository } from './infra/prisma-tenant.repository.js';
import { TENANT_REPOSITORY } from './interfaces/tenant.repository.js';
import { SubscriptionRenewalJob } from './subscription-renewal.job.js';
import { TenantOwnerAdminService } from './tenant-owner-admin.service.js';
import { TenantOwnerController } from './tenant-owner.controller.js';
import { TenantSubscriptionsController } from './tenant-subscriptions.controller.js';
import { TenantSubscriptionsService } from './tenant-subscriptions.service.js';
import { TenantsController } from './tenants.controller.js';
import { TenantsService } from './tenants.service.js';

@Module({
  imports: [
    PlatformAuthCoreModule,
    PlatformAuditModule,
    SubscriptionsModule,
    TenantUsersModule,
    TenantSessionsModule,
  ],
  controllers: [
    TenantsController,
    TenantSubscriptionsController,
    TenantOwnerController,
  ],
  providers: [
    TenantsService,
    TenantSubscriptionsService,
    TenantOwnerAdminService,
    SubscriptionRenewalJob,
    { provide: TENANT_REPOSITORY, useClass: PrismaTenantRepository },
  ],
})
export class TenantsModule {}
