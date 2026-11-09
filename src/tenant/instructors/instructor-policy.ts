import { manageDenial, type StaffPrincipal } from '../staff/staff-policy.js';

/**
 * What someone may do to an instructor profile. Pure rules, no I/O:
 * - anyone may create their own profile and edit its licence and classes
 *   (licence validity is the school's responsibility);
 * - managing someone else's profile needs INSTRUCTORS_MANAGE and the staff
 *   rules (role strictly below the actor's, access within the actor's), so
 *   the OWNER's profile is managed by the owner only;
 * - inactivating/reactivating (which frees/takes a MAX_INSTRUCTORS seat)
 *   needs INSTRUCTORS_MANAGE, for one's own profile too.
 */
export type InstructorAction = 'CREATE' | 'EDIT' | 'SET_STATUS';

export interface InstructorActor {
  principal: StaffPrincipal;
  /** Holds INSTRUCTORS_MANAGE. */
  canManageInstructors: boolean;
}

export type InstructorDenial = 'PERMISSION' | 'ROLE' | 'ACCESS';

/** Why the actor may not perform `action` on the target's profile, or null. */
export function instructorDenial(
  actor: InstructorActor,
  target: StaffPrincipal,
  action: InstructorAction,
): InstructorDenial | null {
  if (actor.principal.id === target.id) {
    if (action === 'SET_STATUS' && !actor.canManageInstructors) {
      return 'PERMISSION';
    }
    return null;
  }
  if (!actor.canManageInstructors) return 'PERMISSION';
  const denial = manageDenial(actor.principal, target);
  if (denial === 'ACCESS') return 'ACCESS';
  return denial === null ? null : 'ROLE';
}

export function mayAct(
  actor: InstructorActor,
  target: StaffPrincipal,
  action: InstructorAction,
): boolean {
  return instructorDenial(actor, target, action) === null;
}
