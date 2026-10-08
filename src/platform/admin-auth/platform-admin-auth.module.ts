import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import type { Env } from '../../config/env.js';
import { PlatformAdminUsersModule } from '../admin-users/platform-admin-users.module.js';
import { PlatformAuditModule } from '../audit/platform-audit.module.js';
import { PlatformAdminAuthController } from './platform-admin-auth.controller.js';
import { PlatformAdminAuthService } from './platform-admin-auth.service.js';
import { PlatformAuthCoreModule } from './platform-auth-core.module.js';

@Module({
  imports: [
    PlatformAuthCoreModule,
    PlatformAdminUsersModule,
    PlatformAuditModule,
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        throttlers: [
          {
            ttl:
              config.get('PLATFORM_AUTH_RATE_WINDOW_SECONDS', { infer: true }) *
              1000,
            limit: config.get('PLATFORM_AUTH_RATE_LIMIT', { infer: true }),
          },
        ],
      }),
    }),
  ],
  controllers: [PlatformAdminAuthController],
  providers: [PlatformAdminAuthService],
})
export class PlatformAdminAuthModule {}
