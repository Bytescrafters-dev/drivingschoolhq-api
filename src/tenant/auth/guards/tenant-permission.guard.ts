import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppError } from '../../../common/errors/app-error.js';
import type { TenantPermission } from '../../permissions/tenant-permission.js';
import { tenantRoleHasPermissions } from '../../permissions/tenant-role-permissions.js';
import { REQUIRED_TENANT_PERMISSIONS } from '../common/metadata-keys.js';
import type { TenantAuthenticatedRequest } from '../interfaces/authenticated-tenant-user.js';

/** Runs after TenantAuthGuard. Routes without required permissions only need authentication. */
@Injectable()
export class TenantPermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required =
      this.reflector.getAllAndMerge<TenantPermission[]>(
        REQUIRED_TENANT_PERMISSIONS,
        [context.getHandler(), context.getClass()],
      ) ?? [];
    if (required.length === 0) return true;

    const user = context
      .switchToHttp()
      .getRequest<TenantAuthenticatedRequest>().tenantUser;
    if (!user) {
      throw new AppError(
        'UNAUTHORIZED',
        'AUTHENTICATION_REQUIRED',
        'Authentication required',
      );
    }
    if (!tenantRoleHasPermissions(user.role, required)) {
      throw new AppError(
        'FORBIDDEN',
        'TENANT_PERMISSION_DENIED',
        'You do not have permission to perform this action',
      );
    }
    return true;
  }
}
