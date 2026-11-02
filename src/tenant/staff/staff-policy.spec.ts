import {
  TenantRole,
  TenantUserBranchAccess,
} from '../../generated/prisma/enums.js';
import {
  type AccessScope,
  type StaffPrincipal,
  assignableRoles,
  canAssignRole,
  isWithinAccess,
  manageDenial,
} from './staff-policy.js';

const { OWNER, ADMIN, BRANCH_MANAGER, FRONT_DESK, INSTRUCTOR, ACCOUNTANT } =
  TenantRole;
const ALL: AccessScope = {
  branchAccess: TenantUserBranchAccess.ALL,
  branchIds: [],
};
const selected = (...branchIds: string[]): AccessScope => ({
  branchAccess: TenantUserBranchAccess.SELECTED,
  branchIds,
});
const person = (
  role: TenantRole,
  scope: AccessScope = ALL,
  id: string = crypto.randomUUID(),
): StaffPrincipal => ({ id, role, scope });

describe('staff policy', () => {
  describe('assignable roles', () => {
    it.each([
      [OWNER, [ADMIN, BRANCH_MANAGER, FRONT_DESK, INSTRUCTOR, ACCOUNTANT]],
      [ADMIN, [BRANCH_MANAGER, FRONT_DESK, INSTRUCTOR, ACCOUNTANT]],
      [BRANCH_MANAGER, [FRONT_DESK, INSTRUCTOR, ACCOUNTANT]],
      [FRONT_DESK, []],
      [INSTRUCTOR, []],
      [ACCOUNTANT, []],
    ])('%s may assign %j', (actor, roles) => {
      expect(assignableRoles(actor)).toEqual(roles);
    });

    it('never lets anyone assign OWNER or a peer role', () => {
      for (const actor of Object.values(TenantRole)) {
        expect(canAssignRole(actor, OWNER)).toBe(false);
        expect(canAssignRole(actor, actor)).toBe(false);
      }
    });
  });

  describe('access delegation', () => {
    it('lets ALL contain everything', () => {
      expect(isWithinAccess(ALL, ALL)).toBe(true);
      expect(isWithinAccess(selected('a', 'b'), ALL)).toBe(true);
    });

    it('never lets SELECTED contain ALL', () => {
      expect(isWithinAccess(ALL, selected('a', 'b'))).toBe(false);
    });

    it('requires every selected branch to be held by the outer scope', () => {
      expect(isWithinAccess(selected('a'), selected('a', 'b'))).toBe(true);
      expect(isWithinAccess(selected('a', 'b'), selected('a', 'b'))).toBe(true);
      expect(isWithinAccess(selected('a', 'c'), selected('a', 'b'))).toBe(
        false,
      );
    });
  });

  describe('manageDenial', () => {
    it('allows managing lower roles within the actor’s access', () => {
      expect(manageDenial(person(OWNER), person(ADMIN))).toBeNull();
      expect(
        manageDenial(
          person(BRANCH_MANAGER, selected('a', 'b')),
          person(FRONT_DESK, selected('b')),
        ),
      ).toBeNull();
    });

    it('denies self-management first', () => {
      const id = crypto.randomUUID();
      expect(manageDenial(person(OWNER, ALL, id), person(OWNER, ALL, id))).toBe(
        'SELF',
      );
      expect(manageDenial(person(ADMIN, ALL, id), person(ADMIN, ALL, id))).toBe(
        'SELF',
      );
    });

    it('denies the owner, peers and higher roles', () => {
      expect(manageDenial(person(ADMIN), person(OWNER))).toBe('ROLE');
      expect(manageDenial(person(ADMIN), person(ADMIN))).toBe('ROLE');
      expect(manageDenial(person(BRANCH_MANAGER), person(ADMIN))).toBe('ROLE');
      expect(manageDenial(person(BRANCH_MANAGER), person(BRANCH_MANAGER))).toBe(
        'ROLE',
      );
      expect(manageDenial(person(FRONT_DESK), person(INSTRUCTOR))).toBe('ROLE');
    });

    it('denies targets with access beyond the actor’s', () => {
      const manager = person(BRANCH_MANAGER, selected('a'));
      expect(manageDenial(manager, person(FRONT_DESK, ALL))).toBe('ACCESS');
      expect(
        manageDenial(manager, person(FRONT_DESK, selected('a', 'b'))),
      ).toBe('ACCESS');
    });
  });
});
