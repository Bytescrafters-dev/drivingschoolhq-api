import { Module } from '@nestjs/common';
import { PasswordHasher } from '../../common/security/password-hasher.js';
import { TenantAuditModule } from '../audit/tenant-audit.module.js';
import { TenantContextModule } from '../context/tenant-context.module.js';
import { TenantUsersModule } from '../users/tenant-users.module.js';
import { TenantAuthCoreModule } from './tenant-auth-core.module.js';
import { TenantAuthController } from './tenant-auth.controller.js';
import { TenantAuthService } from './tenant-auth.service.js';

@Module({
  imports: [
    TenantAuthCoreModule,
    TenantUsersModule,
    TenantContextModule,
    TenantAuditModule,
  ],
  controllers: [TenantAuthController],
  providers: [TenantAuthService, PasswordHasher],
})
export class TenantAuthModule {}
