import type { Request } from 'express';
import type {
  TenantRole,
  TenantUserBranchAccess,
} from '../../../generated/prisma/enums.js';

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
  /** Loaded per request, so access changes apply immediately. */
  branchAccess: TenantUserBranchAccess;
  /** Stored default; may point at a branch that has since closed. */
  defaultBranchId: string;
}

export interface TenantAuthenticatedRequest extends Request {
  tenantUser?: AuthenticatedTenantUser;
}
