import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppError } from '../../../common/errors/app-error.js';
import { CLOCK, type Clock } from '../../../common/clock/clock.js';
import { PlatformAdminStatus } from '../../../generated/prisma/enums.js';
import { permissionsForRole } from '../../permissions/role-permissions.js';
import type { PlatformAuthenticatedRequest } from '../interfaces/authenticated-platform-admin.js';
import { ALLOW_PASSWORD_CHANGE_REQUIRED } from '../common/metadata-keys.js';
import {
  PLATFORM_SESSION_REPOSITORY,
  type PlatformSessionRepository,
} from '../interfaces/platform-session.repository.js';
import { PlatformTokenService } from '../platform-token.service.js';

/**
 * Authenticates platform admins. Besides the JWT signature it checks the
 * backing session and admin on every request, so logout, disable, role change
 * and password reset take effect immediately.
 */
@Injectable()
export class PlatformAuthGuard implements CanActivate {
  constructor(
    private readonly tokens: PlatformTokenService,
    @Inject(PLATFORM_SESSION_REPOSITORY)
    private readonly sessions: PlatformSessionRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<PlatformAuthenticatedRequest>();
    const token = this.extractBearerToken(request.headers.authorization);
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

    const found = await this.sessions.findWithAdmin(claims.sessionId);
    if (
      !found ||
      found.admin.id !== claims.adminId ||
      found.session.revokedAt !== null ||
      found.session.expiresAt <= this.clock.now() ||
      found.admin.status !== PlatformAdminStatus.ACTIVE
    ) {
      throw new AppError(
        'UNAUTHORIZED',
        'SESSION_INVALID',
        'Session is no longer valid',
      );
    }

    const { admin, session } = found;
    const allowWhilePasswordChangeRequired =
      this.reflector.getAllAndOverride<boolean>(
        ALLOW_PASSWORD_CHANGE_REQUIRED,
        [context.getHandler(), context.getClass()],
      );
    if (admin.mustChangePassword && !allowWhilePasswordChangeRequired) {
      throw new AppError(
        'FORBIDDEN',
        'PASSWORD_CHANGE_REQUIRED',
        'You must change your temporary password before continuing',
      );
    }

    request.platformAdmin = {
      id: admin.id,
      email: admin.email,
      fullName: admin.fullName,
      role: admin.role,
      sessionId: session.id,
      mustChangePassword: admin.mustChangePassword,
      permissions: permissionsForRole(admin.role),
    };
    return true;
  }

  private extractBearerToken(header: string | undefined): string | null {
    if (!header) return null;
    const [scheme, value] = header.split(' ');
    return scheme?.toLowerCase() === 'bearer' && value ? value : null;
  }
}
