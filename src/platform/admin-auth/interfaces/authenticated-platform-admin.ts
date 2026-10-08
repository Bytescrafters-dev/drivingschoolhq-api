import type { Request } from 'express';
import type { PlatformRole } from '../../../generated/prisma/enums.js';
import type { PlatformPermission } from '../../permissions/platform-permission.js';

/** The platform admin behind the current request, resolved by PlatformAuthGuard. */
export interface AuthenticatedPlatformAdmin {
  id: string;
  email: string;
  fullName: string;
  role: PlatformRole;
  sessionId: string;
  mustChangePassword: boolean;
  permissions: readonly PlatformPermission[];
}

export interface PlatformAuthenticatedRequest extends Request {
  platformAdmin?: AuthenticatedPlatformAdmin;
}
