import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import type { Env } from '../../config/env.js';
import { TenantSessionsModule } from '../sessions/tenant-sessions.module.js';
import { TenantAuthGuard } from './guards/tenant-auth.guard.js';
import {
  TENANT_TOKEN_AUDIENCE,
  TENANT_TOKEN_ISSUER,
  TenantTokenService,
} from './tenant-token.service.js';

/**
 * Tenant user authentication building blocks (tokens, guard). Imported by
 * every tenant module exposing protected routes.
 */
@Module({
  imports: [
    TenantSessionsModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('TENANT_JWT_SECRET', { infer: true }),
        signOptions: {
          algorithm: 'HS256',
          audience: TENANT_TOKEN_AUDIENCE,
          issuer: TENANT_TOKEN_ISSUER,
        },
        verifyOptions: {
          algorithms: ['HS256'],
          audience: TENANT_TOKEN_AUDIENCE,
          issuer: TENANT_TOKEN_ISSUER,
        },
      }),
    }),
  ],
  providers: [TenantTokenService, TenantAuthGuard],
  exports: [TenantTokenService, TenantAuthGuard, TenantSessionsModule],
})
export class TenantAuthCoreModule {}
