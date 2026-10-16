import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { ClockModule } from './common/clock/clock.js';
import { AppErrorFilter } from './common/errors/app-error.filter.js';
import { createValidationPipe } from './common/validation/validation-pipe.js';
import { type Env, validateEnv } from './config/env.js';
import { PlatformModule } from './platform/platform.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { TenantModule } from './tenant/tenant.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    ScheduleModule.forRoot(),
    // Rate limiting for the platform and tenant login/refresh endpoints
    // (applied per route with ThrottlerGuard).
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        throttlers: [
          {
            ttl: config.get('AUTH_RATE_WINDOW_SECONDS', { infer: true }) * 1000,
            limit: config.get('AUTH_RATE_LIMIT', { infer: true }),
          },
        ],
      }),
    }),
    PrismaModule,
    ClockModule,
    PlatformModule,
    TenantModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_PIPE, useFactory: createValidationPipe },
    { provide: APP_FILTER, useClass: AppErrorFilter },
  ],
})
export class AppModule {}
