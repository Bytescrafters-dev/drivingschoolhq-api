import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Env } from '../../config/env.js';
import {
  generateRefreshToken,
  hashRefreshToken,
} from '../../common/security/refresh-token.js';

export const PLATFORM_TOKEN_AUDIENCE = 'platform';
export const PLATFORM_TOKEN_ISSUER = 'drivingschoolhq';

interface PlatformAccessClaims {
  sub: string;
  sid: string;
}

@Injectable()
export class PlatformTokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  get accessTokenTtlSeconds(): number {
    return this.config.get('PLATFORM_ACCESS_TOKEN_TTL_SECONDS', {
      infer: true,
    });
  }

  get refreshTokenTtlMs(): number {
    return (
      this.config.get('PLATFORM_REFRESH_TOKEN_TTL_DAYS', { infer: true }) *
      24 *
      60 *
      60 *
      1000
    );
  }

  issueAccessToken(adminId: string, sessionId: string): Promise<string> {
    const claims: PlatformAccessClaims = { sub: adminId, sid: sessionId };
    return this.jwt.signAsync(claims, {
      expiresIn: this.accessTokenTtlSeconds,
    });
  }

  async verifyAccessToken(
    token: string,
  ): Promise<{ adminId: string; sessionId: string } | null> {
    try {
      const claims = await this.jwt.verifyAsync<PlatformAccessClaims>(token);
      if (typeof claims.sub !== 'string' || typeof claims.sid !== 'string') {
        return null;
      }
      return { adminId: claims.sub, sessionId: claims.sid };
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
