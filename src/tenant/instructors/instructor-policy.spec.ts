import {
  TenantRole,
  TenantUserBranchAccess,
} from '../../generated/prisma/enums.js';
import { TenantPermission } from '../permissions/tenant-permission.js';
import { tenantRoleHasPermissions } from '../permissions/tenant-role-permissions.js';
import type { StaffPrincipal } from '../staff/staff-policy.js';
import {
  type InstructorAction,
  type InstructorActor,
  instructorDenial,
} from './instructor-policy.js';

const { OWNER, ADMIN, BRANCH_MANAGER, FRONT_DESK, INSTRUCTOR, ACCOUNTANT } =
  TenantRole;
const ACTIONS: InstructorAction[] = ['CREATE', 'EDIT', 'SET_STATUS'];

function person(
  role: TenantRole,
  branchIds: string[] | 'ALL' = 'ALL',
  id: string = crypto.randomUUID(),
): StaffPrincipal {
  return {
    id,
    role,
    scope:
      branchIds === 'ALL'
        ? { branchAccess: TenantUserBranchAccess.ALL, branchIds: [] }
        : { branchAccess: TenantUserBranchAccess.SELECTED, branchIds },
  };
}

function actorOf(principal: StaffPrincipal): InstructorActor {
  return {
    principal,
    canManageInstructors: tenantRoleHasPermissions(principal.role, [
      TenantPermission.INSTRUCTORS_MANAGE,
    ]),
  };
}

describe('instructorDenial', () => {
  it.each(Object.values(TenantRole))(
    '%s may create and edit their own profile',
    (role) => {
      const me = person(role);
      expect(instructorDenial(actorOf(me), me, 'CREATE')).toBeNull();
      expect(instructorDenial(actorOf(me), me, 'EDIT')).toBeNull();
    },
  );

  it('lets only managers change their own profile status', () => {
    for (const role of [OWNER, ADMIN, BRANCH_MANAGER]) {
      const me = person(role);
      expect(instructorDenial(actorOf(me), me, 'SET_STATUS')).toBeNull();
    }
    for (const role of [FRONT_DESK, INSTRUCTOR, ACCOUNTANT]) {
      const me = person(role);
      expect(instructorDenial(actorOf(me), me, 'SET_STATUS')).toBe(
        'PERMISSION',
      );
    }
  });

  it.each([FRONT_DESK, INSTRUCTOR, ACCOUNTANT])(
    '%s cannot touch anyone else',
    (role) => {
      for (const action of ACTIONS) {
        expect(
          instructorDenial(actorOf(person(role)), person(INSTRUCTOR), action),
        ).toBe('PERMISSION');
      }
    },
  );

  it.each([
    [OWNER, [ADMIN, BRANCH_MANAGER, FRONT_DESK, INSTRUCTOR, ACCOUNTANT]],
    [ADMIN, [BRANCH_MANAGER, FRONT_DESK, INSTRUCTOR, ACCOUNTANT]],
    [BRANCH_MANAGER, [FRONT_DESK, INSTRUCTOR, ACCOUNTANT]],
  ])('%s manages lower roles: %j', (role, lower) => {
    const actor = actorOf(person(role));
    for (const target of lower) {
      for (const action of ACTIONS) {
        expect(instructorDenial(actor, person(target), action)).toBeNull();
      }
    }
  });

  it("keeps the owner's profile owner-only", () => {
    const owner = person(OWNER);
    for (const role of [ADMIN, BRANCH_MANAGER]) {
      for (const action of ACTIONS) {
        expect(instructorDenial(actorOf(person(role)), owner, action)).toBe(
          'ROLE',
        );
      }
    }
  });

  it('does not let a manager manage their peers', () => {
    expect(
      instructorDenial(actorOf(person(ADMIN)), person(ADMIN), 'EDIT'),
    ).toBe('ROLE');
    expect(
      instructorDenial(
        actorOf(person(BRANCH_MANAGER)),
        person(BRANCH_MANAGER),
        'CREATE',
      ),
    ).toBe('ROLE');
  });

  it('limits a branch manager to staff within their branches', () => {
    const manager = actorOf(person(BRANCH_MANAGER, ['b1']));
    expect(
      instructorDenial(manager, person(INSTRUCTOR, ['b1']), 'EDIT'),
    ).toBeNull();
    expect(
      instructorDenial(manager, person(INSTRUCTOR, ['b1', 'b2']), 'EDIT'),
    ).toBe('ACCESS');
    expect(instructorDenial(manager, person(INSTRUCTOR), 'CREATE')).toBe(
      'ACCESS',
    );
  });
});
