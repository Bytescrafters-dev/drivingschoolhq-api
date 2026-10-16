import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Env } from '../../config/env.js';
import {
  generateRefreshToken,
  hashRefreshToken,
} from '../../common/security/refresh-token.js';

export const TENANT_TOKEN_AUDIENCE = 'tenant';
export const TENANT_TOKEN_ISSUER = 'drivingschoolhq';

interface TenantAccessClaims {
  sub: string;
  sid: string;
  tid: string;
}

export interface VerifiedTenantClaims {
  userId: string;
  sessionId: string;
  tenantId: string;
}

/**
 * Tenant access tokens use their own secret and audience, so platform tokens
 * can never authenticate tenant routes (and vice versa).
 */
@Injectable()
export class TenantTokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  get accessTokenTtlSeconds(): number {
    return this.config.get('TENANT_ACCESS_TOKEN_TTL_SECONDS', { infer: true });
  }

  get refreshTokenTtlMs(): number {
    return (
      this.config.get('TENANT_REFRESH_TOKEN_TTL_DAYS', { infer: true }) *
      24 *
      60 *
      60 *
      1000
    );
  }

  issueAccessToken(claims: VerifiedTenantClaims): Promise<string> {
    const payload: TenantAccessClaims = {
      sub: claims.userId,
      sid: claims.sessionId,
      tid: claims.tenantId,
    };
    return this.jwt.signAsync(payload, {
      expiresIn: this.accessTokenTtlSeconds,
    });
  }

  async verifyAccessToken(token: string): Promise<VerifiedTenantClaims | null> {
    try {
      const claims = await this.jwt.verifyAsync<TenantAccessClaims>(token);
      if (
        typeof claims.sub !== 'string' ||
        typeof claims.sid !== 'string' ||
        typeof claims.tid !== 'string'
      ) {
        return null;
      }
      return {
        userId: claims.sub,
        sessionId: claims.sid,
        tenantId: claims.tid,
      };
    } catch {
      return null;
    }
  }

  generateRefreshToken(): { token: string; hash: string } {
    return generateRefreshToken();
  }

  hashRefreshToken(token: string): string {
    return hashRefreshToken(token);
  }
}
