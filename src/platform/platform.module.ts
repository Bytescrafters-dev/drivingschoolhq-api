import { Module } from '@nestjs/common';
import { PlatformAdminAuthModule } from './admin-auth/platform-admin-auth.module.js';
import { PlatformAdminUsersModule } from './admin-users/platform-admin-users.module.js';
import { PlatformAuditModule } from './audit/platform-audit.module.js';
import { PlansModule } from './plans/plans.module.js';
import { SubscriptionsModule } from './subscriptions/subscriptions.module.js';
import { TenantsModule } from './tenants/tenants.module.js';

@Module({
  imports: [
    PlatformAdminAuthModule,
    PlatformAdminUsersModule,
    PlatformAuditModule,
    PlansModule,
    SubscriptionsModule,
    TenantsModule,
  ],
})
export class PlatformModule {}
