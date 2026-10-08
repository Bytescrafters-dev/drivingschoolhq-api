import {
  applyDecorators,
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
  UseGuards,
} from '@nestjs/common';
import type { PlatformPermission } from '../../permissions/platform-permission.js';
import type {
  AuthenticatedPlatformAdmin,
  PlatformAuthenticatedRequest,
} from '../interfaces/authenticated-platform-admin.js';
import { PlatformAuthGuard } from '../guards/platform-auth.guard.js';
import { PlatformPermissionGuard } from '../guards/platform-permission.guard.js';
import {
  ALLOW_PASSWORD_CHANGE_REQUIRED,
  REQUIRED_PLATFORM_PERMISSIONS,
} from './metadata-keys.js';

/** Requires an authenticated, active platform admin session. */
export const PlatformAuth = () =>
  applyDecorators(UseGuards(PlatformAuthGuard, PlatformPermissionGuard));

export const RequirePlatformPermissions = (
  ...permissions: PlatformPermission[]
) => SetMetadata(REQUIRED_PLATFORM_PERMISSIONS, permissions);

/** Lets admins with a temporary password reach this handler. */
export const AllowPasswordChangeRequired = () =>
  SetMetadata(ALLOW_PASSWORD_CHANGE_REQUIRED, true);

export const CurrentPlatformAdmin = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedPlatformAdmin => {
    const request = ctx
      .switchToHttp()
      .getRequest<PlatformAuthenticatedRequest>();
    if (!request.platformAdmin) {
      throw new Error(
        'CurrentPlatformAdmin used on a route without PlatformAuth()',
      );
    }
    return request.platformAdmin;
  },
);
