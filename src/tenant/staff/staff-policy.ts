import {
  TenantRole,
  TenantUserBranchAccess,
} from '../../generated/prisma/enums.js';

/**
 * Who may manage whom inside a school. Pure rules, no I/O, so the whole
 * matrix is unit-tested in one place:
 *
 * - Roles rank OWNER > ADMIN > BRANCH_MANAGER > FRONT_DESK / INSTRUCTOR /
 *   ACCOUNTANT. Actors create and manage only roles strictly below their own;
 *   the OWNER is never created or managed here (platform only).
 * - Branch access is delegated, never widened: an actor with ALL may grant
 *   ALL or any branches; an actor with SELECTED may grant only branches they
 *   hold themselves, never ALL.
 * - A staff member is manageable only while their whole access lies within
 *   the actor's, and nobody manages themselves.
 */
export const ROLE_RANK: Readonly<Record<TenantRole, number>> = {
  [TenantRole.OWNER]: 3,
  [TenantRole.ADMIN]: 2,
  [TenantRole.BRANCH_MANAGER]: 1,
  [TenantRole.FRONT_DESK]: 0,
  [TenantRole.INSTRUCTOR]: 0,
  [TenantRole.ACCOUNTANT]: 0,
};

/** ALL, or the branches a SELECTED user is assigned to (any status). */
export interface AccessScope {
  branchAccess: TenantUserBranchAccess;
  branchIds: readonly string[];
}

export interface StaffPrincipal {
  id: string;
  role: TenantRole;
  scope: AccessScope;
}

export type ManageDenial = 'SELF' | 'ROLE' | 'ACCESS';

/** Roles the actor may give to someone, highest first. */
export function assignableRoles(actorRole: TenantRole): TenantRole[] {
  return (Object.keys(ROLE_RANK) as TenantRole[])
    .filter(
      (role) =>
        role !== TenantRole.OWNER && ROLE_RANK[role] < ROLE_RANK[actorRole],
    )
    .sort((a, b) => ROLE_RANK[b] - ROLE_RANK[a]);
}

export function canAssignRole(
  actorRole: TenantRole,
  role: TenantRole,
): boolean {
  return assignableRoles(actorRole).includes(role);
}

/** Whether `inner` grants nothing beyond `outer`. */
export function isWithinAccess(
  inner: AccessScope,
  outer: AccessScope,
): boolean {
  if (outer.branchAccess === TenantUserBranchAccess.ALL) return true;
  if (inner.branchAccess === TenantUserBranchAccess.ALL) return false;
  const allowed = new Set(outer.branchIds);
  return inner.branchIds.every((id) => allowed.has(id));
}

/** Why the actor may not manage the target, or null when they may. */
export function manageDenial(
  actor: StaffPrincipal,
  target: StaffPrincipal,
): ManageDenial | null {
  if (actor.id === target.id) return 'SELF';
  if (target.role === TenantRole.OWNER) return 'ROLE';
  if (ROLE_RANK[target.role] >= ROLE_RANK[actor.role]) return 'ROLE';
  if (!isWithinAccess(target.scope, actor.scope)) return 'ACCESS';
  return null;
}
