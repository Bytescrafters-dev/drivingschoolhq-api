import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppError } from '../../../common/errors/app-error.js';
import type { PlatformPermission } from '../../permissions/platform-permission.js';
import { roleHasPermissions } from '../../permissions/role-permissions.js';
import type { PlatformAuthenticatedRequest } from '../interfaces/authenticated-platform-admin.js';
import { REQUIRED_PLATFORM_PERMISSIONS } from '../common/metadata-keys.js';

/** Must run after PlatformAuthGuard. Routes without required permissions only need authentication. */
@Injectable()
export class PlatformPermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required =
      this.reflector.getAllAndMerge<PlatformPermission[]>(
        REQUIRED_PLATFORM_PERMISSIONS,
        [context.getHandler(), context.getClass()],
      ) ?? [];
    if (required.length === 0) return true;

    const admin = context
      .switchToHttp()
      .getRequest<PlatformAuthenticatedRequest>().platformAdmin;
    if (!admin) {
      throw new AppError(
        'UNAUTHORIZED',
        'AUTHENTICATION_REQUIRED',
        'Authentication required',
      );
    }
    if (!roleHasPermissions(admin.role, required)) {
      throw new AppError(
        'FORBIDDEN',
        'PLATFORM_PERMISSION_DENIED',
        'You do not have permission to perform this action',
      );
    }
    return true;
  }
}
