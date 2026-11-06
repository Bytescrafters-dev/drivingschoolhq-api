import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error.js';
import { VehicleClassCatalogService } from '../../../reference-data/vehicle-classes/vehicle-class-catalog.service.js';
import {
  BRANCH_PROFILE_REPOSITORY,
  type BranchProfileRepository,
} from './interfaces/branch-profile.repository.js';

/**
 * The gate for class-dependent work (instructors, vehicles, applications):
 * a branch can serve a vehicle class only when its profile has a licence and
 * the class is currently offered. Licence expiry never blocks: validity is the
 * school's responsibility. Removing an offering only affects new work.
 */
@Injectable()
export class BranchCapabilityService {
  constructor(
    @Inject(BRANCH_PROFILE_REPOSITORY)
    private readonly profiles: BranchProfileRepository,
    private readonly catalog: VehicleClassCatalogService,
  ) {}

  /** The caller has already verified access to (tenantId, branchId). */
  async assertCanServe(
    tenantId: string,
    branchId: string,
    vehicleClassCode: string,
  ): Promise<void> {
    const [vehicleClass] = await this.catalog.resolveCodes([vehicleClassCode]);
    const state = (await this.profiles.states(tenantId, [branchId])).get(
      branchId,
    );
    if (!state?.currentLicence) {
      throw new AppError(
        'CONFLICT',
        'BRANCH_PROFILE_INCOMPLETE',
        'Record the branch driving-school licence in the branch profile first',
      );
    }
    if (!state.offeredVehicleClassIds.includes(vehicleClass!.id)) {
      throw new AppError(
        'CONFLICT',
        'VEHICLE_CLASS_NOT_OFFERED',
        `This branch does not offer vehicle class ${vehicleClass!.code}`,
      );
    }
  }
}
