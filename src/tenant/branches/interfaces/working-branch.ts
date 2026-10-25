import type { TenantAuthenticatedRequest } from '../../auth/interfaces/authenticated-tenant-user.js';

/**
 * The branch the current request works in, resolved by BranchContextGuard
 * from the X-Branch-Id header and verified against the user's access.
 * Branch-scoped repositories take (tenantId, branchId) from here only.
 */
export interface WorkingBranch {
  id: string;
  tenantId: string;
  name: string;
}

export interface BranchScopedRequest extends TenantAuthenticatedRequest {
  branch?: WorkingBranch;
}
