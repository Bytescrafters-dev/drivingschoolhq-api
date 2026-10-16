import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CLOCK, type Clock } from '../../../common/clock/clock.js';
import { AppError } from '../../../common/errors/app-error.js';
import {
  TenantStatus,
  TenantUserStatus,
} from '../../../generated/prisma/enums.js';
import {
  TENANT_SESSION_REPOSITORY,
  type TenantSessionRepository,
} from '../../sessions/interfaces/tenant-session.repository.js';
import { TENANT_ALLOW_PASSWORD_CHANGE_REQUIRED } from '../common/metadata-keys.js';
import type { TenantAuthenticatedRequest } from '../interfaces/authenticated-tenant-user.js';
import { TenantTokenService } from '../tenant-token.service.js';

/**
 * Authenticates tenant users. Besides the JWT it checks the backing session,
 * user and tenant on every request, so logout, disable, password reset and
 * tenant closure take effect immediately. The tenant context is taken from
 * the verified session only.
 */
@Injectable()
export class TenantAuthGuard implements CanActivate {
  constructor(
    private readonly tokens: TenantTokenService,
    @Inject(TENANT_SESSION_REPOSITORY)
    private readonly sessions: TenantSessionRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<TenantAuthenticatedRequest>();
    const token = extractBearerToken(request.headers.authorization);
    if (!token) {
      throw new AppError(
        'UNAUTHORIZED',
        'AUTHENTICATION_REQUIRED',
        'Authentication required',
      );
    }

    const claims = await this.tokens.verifyAccessToken(token);
    if (!claims) {
      throw new AppError(
        'UNAUTHORIZED',
        'INVALID_ACCESS_TOKEN',
        'Invalid or expired access token',
      );
    }

    const found = await this.sessions.findWithPrincipal(claims.sessionId);
    if (
      !found ||
      found.session.userId !== claims.userId ||
      found.session.tenantId !== claims.tenantId ||
      found.principal.user.tenantId !== claims.tenantId ||
      found.session.revokedAt !== null ||
      found.session.expiresAt <= this.clock.now() ||
      found.principal.user.status !== TenantUserStatus.ACTIVE ||
      found.principal.tenant.status === TenantStatus.CLOSED
    ) {
      throw new AppError(
        'UNAUTHORIZED',
        'SESSION_INVALID',
        'Session is no longer valid',
      );
    }

    const { user } = found.principal;
    const allowWhilePasswordChangeRequired =
      this.reflector.getAllAndOverride<boolean>(
        TENANT_ALLOW_PASSWORD_CHANGE_REQUIRED,
        [context.getHandler(), context.getClass()],
      );
    if (user.mustChangePassword && !allowWhilePasswordChangeRequired) {
      throw new AppError(
        'FORBIDDEN',
        'PASSWORD_CHANGE_REQUIRED',
        'You must change your temporary password before continuing',
      );
    }

    request.tenantUser = {
      id: user.id,
      tenantId: user.tenantId,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      sessionId: found.session.id,
      mustChangePassword: user.mustChangePassword,
    };
    return true;
  }
}

function extractBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && value ? value : null;
}
