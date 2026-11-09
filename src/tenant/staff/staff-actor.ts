import { TenantUserBranchAccess } from '../../generated/prisma/enums.js';
import type { AuthenticatedTenantUser } from '../auth/interfaces/authenticated-tenant-user.js';
import { viewerOf } from '../branches/branch-access.service.js';
import type { BranchRepository } from '../branches/interfaces/branch.repository.js';
import type {
  StaffMember,
  StaffViewer,
} from './interfaces/staff.repository.js';
import type { AccessScope, StaffPrincipal } from './staff-policy.js';

/** The actor resolved for staff rules: who they are and what they hold. */
export interface StaffActor {
  principal: StaffPrincipal;
  viewer: StaffViewer;
}

/**
 * Reads the actor's own access fresh (assignments of any status), for the
 * rules in staff-policy.ts. Shared by staff and instructor management.
 */
export async function loadStaffActor(
  branches: BranchRepository,
  actor: AuthenticatedTenantUser,
): Promise<StaffActor> {
  const branchIds =
    actor.branchAccess === TenantUserBranchAccess.ALL
      ? []
      : (
          await branches.listAccessible(viewerOf(actor), {
            includeClosed: true,
          })
        ).map((branch) => branch.id);
  const scope: AccessScope = { branchAccess: actor.branchAccess, branchIds };
  return {
    principal: { id: actor.id, role: actor.role, scope },
    viewer: { tenantId: actor.tenantId, ...scope },
  };
}

/** A staff member as a principal of staff-policy.ts. */
export function principalOf(
  member: Pick<StaffMember, 'id' | 'role' | 'branchAccess' | 'branches'>,
): StaffPrincipal {
  return {
    id: member.id,
    role: member.role,
    scope: {
      branchAccess: member.branchAccess,
      branchIds: member.branches.map((branch) => branch.id),
    },
  };
}
