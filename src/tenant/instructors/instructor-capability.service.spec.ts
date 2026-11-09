import {
  BranchStatus,
  DrivingSchoolGrade,
  InstructorProfileStatus,
  TenantRole,
  TenantUserBranchAccess,
  TenantUserStatus,
} from '../../generated/prisma/enums.js';
import {
  InMemoryBranchProfileRepository,
  InMemoryVehicleClassRepository,
} from '../../../test/support/branch-profile-fakes.js';
import { FixedClock, expectAppError } from '../../../test/support/fakes.js';
import { parseIsoDate } from '../../common/time/calendar-date.js';
import { VehicleClassCatalogService } from '../../reference-data/vehicle-classes/vehicle-class-catalog.service.js';
import { BranchCapabilityService } from '../branches/profile/branch-capability.service.js';
import {
  InstructorCapabilityService,
  teachableClassIds,
} from './instructor-capability.service.js';
import type {
  InstructorPerson,
  InstructorProfileRepository,
} from './interfaces/instructor-profile.repository.js';

const GRADE_C_CLASSES = ['A1', 'A', 'B1', 'B', 'G'];

function setup() {
  const classes = new InMemoryVehicleClassRepository();
  const catalog = new VehicleClassCatalogService(classes);
  const branchProfiles = new InMemoryBranchProfileRepository();
  const people = new Map<string, InstructorPerson>();
  const repo = {
    findPerson: async (tenantId: string, profileId: string) => {
      const person = people.get(profileId);
      return person?.user.tenantId === tenantId ? person : null;
    },
  } as unknown as InstructorProfileRepository;
  const service = new InstructorCapabilityService(
    repo,
    new BranchCapabilityService(branchProfiles, catalog),
    catalog,
    new FixedClock(new Date('2026-11-07T04:00:00.000Z')),
  );
  const tenantId = crypto.randomUUID();
  const branchId = crypto.randomUUID();
  const otherBranchId = crypto.randomUUID();

  // A Grade C branch offering everything its grade permits.
  async function gradeCBranch(id: string) {
    await branchProfiles.recordLicence({
      tenantId,
      branchId: id,
      licenceNumber: 'DS/1',
      grade: DrivingSchoolGrade.C,
      issuedOn: parseIsoDate('2026-01-01'),
      expiresOn: parseIsoDate('2027-01-01'),
      recordedByTenantUserId: crypto.randomUUID(),
    });
    await branchProfiles.replaceOfferedClasses(
      tenantId,
      id,
      GRADE_C_CLASSES.map((c) => classes.idOf(c)),
    );
  }

  // A Grade A instructor qualified for all 13 classes.
  function instructor(
    overrides: {
      staffStatus?: TenantUserStatus;
      status?: InstructorProfileStatus;
      branchIds?: string[];
      qualified?: string[];
    } = {},
  ): string {
    const profileId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    people.set(profileId, {
      user: {
        id: userId,
        tenantId,
        fullName: 'Nimal',
        email: 'nimal@school.lk',
        phone: null,
        role: TenantRole.INSTRUCTOR,
        status: overrides.staffStatus ?? TenantUserStatus.ACTIVE,
        branchAccess: TenantUserBranchAccess.SELECTED,
        branches: (overrides.branchIds ?? [branchId]).map((id) => ({
          id,
          name: 'Branch',
          status: BranchStatus.ACTIVE,
        })),
      },
      profile: {
        id: profileId,
        tenantId,
        tenantUserId: userId,
        status: overrides.status ?? InstructorProfileStatus.ACTIVE,
        inactivatedAt: null,
        currentLicence: null,
        qualifiedVehicleClassIds: (
          overrides.qualified ?? [
            'A1',
            'A',
            'B1',
            'B',
            'C1',
            'C',
            'CE',
            'D1',
            'D',
            'DE',
            'G1',
            'G',
            'J',
          ]
        ).map((c) => classes.idOf(c)),
        createdByTenantUserId: userId,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    return profileId;
  }

  return {
    service,
    tenantId,
    branchId,
    otherBranchId,
    gradeCBranch,
    instructor,
  };
}

describe('teachableClassIds', () => {
  it('intersects in branch order', () => {
    expect(teachableClassIds(['a1', 'b', 'g'], ['g', 'ce', 'a1'])).toEqual([
      'a1',
      'g',
    ]);
  });
});

describe('InstructorCapabilityService.assertCanTeach', () => {
  it('lets a Grade A instructor teach what a Grade C branch offers', async () => {
    const s = setup();
    await s.gradeCBranch(s.branchId);
    const id = s.instructor();
    await expect(
      s.service.assertCanTeach(s.tenantId, id, s.branchId, 'B'),
    ).resolves.toBeUndefined();
  });

  it('checks the branch first: a class the branch does not offer', async () => {
    const s = setup();
    await s.gradeCBranch(s.branchId);
    const id = s.instructor();
    await expectAppError(
      s.service.assertCanTeach(s.tenantId, id, s.branchId, 'CE'),
      'VEHICLE_CLASS_NOT_OFFERED',
    );
  });

  it('rejects an instructor who is not qualified', async () => {
    const s = setup();
    await s.gradeCBranch(s.branchId);
    const id = s.instructor({ qualified: ['A1', 'A'] });
    await expectAppError(
      s.service.assertCanTeach(s.tenantId, id, s.branchId, 'B'),
      'INSTRUCTOR_NOT_QUALIFIED',
    );
  });

  it('rejects an instructor who does not work in the branch', async () => {
    const s = setup();
    await s.gradeCBranch(s.otherBranchId);
    const id = s.instructor();
    await expectAppError(
      s.service.assertCanTeach(s.tenantId, id, s.otherBranchId, 'B'),
      'INSTRUCTOR_NOT_IN_BRANCH',
    );
  });

  it.each([
    [{ status: InstructorProfileStatus.INACTIVE }],
    [{ staffStatus: TenantUserStatus.DISABLED }],
  ])('rejects an instructor who is not assignable (%j)', async (overrides) => {
    const s = setup();
    await s.gradeCBranch(s.branchId);
    const id = s.instructor(overrides);
    await expectAppError(
      s.service.assertCanTeach(s.tenantId, id, s.branchId, 'B'),
      'INSTRUCTOR_NOT_ASSIGNABLE',
    );
  });

  it("does not find another tenant's instructor", async () => {
    const s = setup();
    await s.gradeCBranch(s.branchId);
    const id = s.instructor();
    const other = setup();
    await other.gradeCBranch(other.branchId);
    await expectAppError(
      other.service.assertCanTeach(other.tenantId, id, other.branchId, 'B'),
      'INSTRUCTOR_NOT_FOUND',
    );
  });
});
