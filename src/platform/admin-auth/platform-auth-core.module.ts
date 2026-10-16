import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import type { Env } from '../../config/env.js';
import { PlatformAuthGuard } from './guards/platform-auth.guard.js';
import { PlatformPermissionGuard } from './guards/platform-permission.guard.js';
import { PasswordHasher } from '../../common/security/password-hasher.js';
import { PLATFORM_SESSION_REPOSITORY } from './interfaces/platform-session.repository.js';
import {
  PLATFORM_TOKEN_AUDIENCE,
  PLATFORM_TOKEN_ISSUER,
  PlatformTokenService,
} from './platform-token.service.js';
import { PrismaPlatformSessionRepository } from './infra/prisma-platform-session.repository.js';

/**
 * Platform admin authentication building blocks (tokens, sessions, password
 * hashing, guards). Imported by every platform module exposing protected routes.
 */
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('PLATFORM_JWT_SECRET', { infer: true }),
        signOptions: {
          algorithm: 'HS256',
          audience: PLATFORM_TOKEN_AUDIENCE,
          issuer: PLATFORM_TOKEN_ISSUER,
        },
        verifyOptions: {
          algorithms: ['HS256'],
          audience: PLATFORM_TOKEN_AUDIENCE,
          issuer: PLATFORM_TOKEN_ISSUER,
        },
      }),
    }),
  ],
  providers: [
    PlatformTokenService,
    PasswordHasher,
    PlatformAuthGuard,
    PlatformPermissionGuard,
    {
      provide: PLATFORM_SESSION_REPOSITORY,
      useClass: PrismaPlatformSessionRepository,
    },
  ],
  exports: [
    PlatformTokenService,
    PasswordHasher,
    PlatformAuthGuard,
    PlatformPermissionGuard,
    PLATFORM_SESSION_REPOSITORY,
  ],
})
export class PlatformAuthCoreModule {}
