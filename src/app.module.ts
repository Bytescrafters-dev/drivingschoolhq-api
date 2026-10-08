import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { ClockModule } from './common/clock/clock.js';
import { AppErrorFilter } from './common/errors/app-error.filter.js';
import { createValidationPipe } from './common/validation/validation-pipe.js';
import { validateEnv } from './config/env.js';
import { PlatformModule } from './platform/platform.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    PrismaModule,
    ClockModule,
    PlatformModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_PIPE, useFactory: createValidationPipe },
    { provide: APP_FILTER, useClass: AppErrorFilter },
  ],
})
export class AppModule {}
