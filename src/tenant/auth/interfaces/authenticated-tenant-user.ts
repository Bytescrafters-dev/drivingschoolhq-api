import type { Request } from 'express';
import type { TenantRole } from '../../../generated/prisma/enums.js';

/**
 * The tenant user behind the current request, resolved by TenantAuthGuard
 * from the verified session. `tenantId` is the only trusted tenant context.
 */
export interface AuthenticatedTenantUser {
  id: string;
  tenantId: string;
  email: string;
  fullName: string;
  role: TenantRole;
  sessionId: string;
  mustChangePassword: boolean;
}

export interface TenantAuthenticatedRequest extends Request {
  tenantUser?: AuthenticatedTenantUser;
}
