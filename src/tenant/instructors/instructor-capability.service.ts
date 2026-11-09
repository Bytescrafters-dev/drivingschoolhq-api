import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from '../../common/clock/clock.js';
import { AppError } from '../../common/errors/app-error.js';
import { businessToday } from '../../common/time/calendar-date.js';
import {
  BranchStatus,
  TenantUserBranchAccess,
} from '../../generated/prisma/enums.js';
import { VehicleClassCatalogService } from '../../reference-data/vehicle-classes/vehicle-class-catalog.service.js';
import { BranchCapabilityService } from '../branches/profile/branch-capability.service.js';
import {
  INSTRUCTOR_PROFILE_REPOSITORY,
  type InstructorProfileRepository,
  type InstructorUser,
} from './interfaces/instructor-profile.repository.js';
import { evaluateInstructorReadiness } from './instructor-readiness.js';

/**
 * Whether the user can work in the branch through their staff access (ALL,
 * or assigned to it while it is ACTIVE). For ALL users the caller has
 * verified the branch itself.
 */
export function worksInBranch(user: InstructorUser, branchId: string): boolean {
  if (user.branchAccess === TenantUserBranchAccess.ALL) return true;
  return user.branches.some(
    (b) => b.id === branchId && b.status === BranchStatus.ACTIVE,
  );
}

/**
 * What an instructor teaches at a branch: their qualifications intersected
 * with the branch's offerings, in `offeredIds` order. The two sets are stored
 * independently (a Grade A instructor keeps every class at a Grade C branch).
 */
export function teachableClassIds(
  offeredIds: readonly string[],
  qualifiedIds: readonly string[],
): string[] {
  const qualified = new Set(qualifiedIds);
  return offeredIds.filter((id) => qualified.has(id));
}

/**
 * The gate for assigning an instructor to class-dependent work (training,
 * scheduling): the branch must serve the class, then the instructor must be
 * assignable, work in the branch and be qualified. Licence expiry never
 * blocks. Availability and vehicles are checked by their own modules.
 */
@Injectable()
export class InstructorCapabilityService {
  constructor(
    @Inject(INSTRUCTOR_PROFILE_REPOSITORY)
    private readonly profiles: InstructorProfileRepository,
    private readonly branches: BranchCapabilityService,
    private readonly catalog: VehicleClassCatalogService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** The caller has already verified access to (tenantId, branchId). */
  async assertCanTeach(
    tenantId: string,
    instructorProfileId: string,
    branchId: string,
    vehicleClassCode: string,
  ): Promise<void> {
    await this.branches.assertCanServe(tenantId, branchId, vehicleClassCode);
    const [vehicleClass] = await this.catalog.resolveCodes([vehicleClassCode]);
    const person = await this.profiles.findPerson(
      tenantId,
      instructorProfileId,
    );
    if (!person?.profile) {
      throw new AppError(
        'NOT_FOUND',
        'INSTRUCTOR_NOT_FOUND',
        'Instructor not found',
      );
    }
    const profile = person.profile;
    const readiness = evaluateInstructorReadiness(
      {
        staffStatus: person.user.status,
        profile: {
          status: profile.status,
          licence: profile.currentLicence,
          qualifiedClassCount: profile.qualifiedVehicleClassIds.length,
        },
      },
      businessToday(this.clock.now()),
    );
    if (!readiness.assignable) {
      throw new AppError(
        'CONFLICT',
        'INSTRUCTOR_NOT_ASSIGNABLE',
        'This instructor cannot take new training right now',
      );
    }
    if (!worksInBranch(person.user, branchId)) {
      throw new AppError(
        'CONFLICT',
        'INSTRUCTOR_NOT_IN_BRANCH',
        'This instructor does not work in this branch',
      );
    }
    if (!profile.qualifiedVehicleClassIds.includes(vehicleClass!.id)) {
      throw new AppError(
        'CONFLICT',
        'INSTRUCTOR_NOT_QUALIFIED',
        `This instructor is not qualified for vehicle class ${vehicleClass!.code}`,
      );
    }
  }
}
