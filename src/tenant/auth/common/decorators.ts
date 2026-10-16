import {
  applyDecorators,
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
  UseGuards,
} from '@nestjs/common';
import { TenantAuthGuard } from '../guards/tenant-auth.guard.js';
import type {
  AuthenticatedTenantUser,
  TenantAuthenticatedRequest,
} from '../interfaces/authenticated-tenant-user.js';
import { TENANT_ALLOW_PASSWORD_CHANGE_REQUIRED } from './metadata-keys.js';

/** Requires an authenticated, active tenant user session. */
export const TenantAuth = () => applyDecorators(UseGuards(TenantAuthGuard));

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
