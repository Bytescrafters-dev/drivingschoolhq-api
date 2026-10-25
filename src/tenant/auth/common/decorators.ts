import {
  applyDecorators,
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
  UseGuards,
} from '@nestjs/common';
import type { TenantPermission } from '../../permissions/tenant-permission.js';
import { TenantAuthGuard } from '../guards/tenant-auth.guard.js';
import { TenantPermissionGuard } from '../guards/tenant-permission.guard.js';
import type {
  AuthenticatedTenantUser,
  TenantAuthenticatedRequest,
} from '../interfaces/authenticated-tenant-user.js';
import {
  REQUIRED_TENANT_PERMISSIONS,
  TENANT_ALLOW_PASSWORD_CHANGE_REQUIRED,
} from './metadata-keys.js';

/**
 * Requires an authenticated, active tenant user session, plus the
 * permissions declared with @RequireTenantPermissions().
 */
export const TenantAuth = () =>
  applyDecorators(UseGuards(TenantAuthGuard, TenantPermissionGuard));

export const RequireTenantPermissions = (...permissions: TenantPermission[]) =>
  SetMetadata(REQUIRED_TENANT_PERMISSIONS, permissions);

/** Lets tenant users with a temporary password reach this handler. */
export const TenantAllowPasswordChangeRequired = () =>
  SetMetadata(TENANT_ALLOW_PASSWORD_CHANGE_REQUIRED, true);

export const CurrentTenantUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedTenantUser => {
    const request = ctx.switchToHttp().getRequest<TenantAuthenticatedRequest>();
    if (!request.tenantUser) {
      throw new Error('CurrentTenantUser used on a route without TenantAuth()');
    }
    return request.tenantUser;
  },
);
