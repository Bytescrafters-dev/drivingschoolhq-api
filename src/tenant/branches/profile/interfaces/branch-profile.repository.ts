import type { DrivingSchoolGrade } from '../../../../generated/prisma/enums.js';
import type { LicenceDetails } from '../../../../reference-data/vehicle-classes/licence-details.js';

export const BRANCH_PROFILE_REPOSITORY = Symbol('BRANCH_PROFILE_REPOSITORY');

/** A branch's driving-school licence (calendar dates at UTC midnight). */
export interface BranchSchoolLicence {
  id: string;
  tenantId: string;
  branchId: string;
  licenceNumber: string;
  grade: DrivingSchoolGrade;
  issuedOn: Date;
  expiresOn: Date;
  recordedByTenantUserId: string;
  createdAt: Date;
  updatedAt: Date;
}

export type { LicenceDetails };

export type NewBranchLicence = LicenceDetails & {
  tenantId: string;
  branchId: string;
  recordedByTenantUserId: string;
};

/** Profile state of one branch: its current licence and offered classes. */
export interface BranchProfileState {
  currentLicence: BranchSchoolLicence | null;
  offeredVehicleClassIds: string[];
}

/**
 * Licences and offered classes of branches. Every operation is scoped to a
 * tenant; callers have already verified access to the branch.
 */
export interface BranchProfileRepository {
  /** State per branch id; ids not belonging to the tenant are absent. */
  states(
    tenantId: string,
    branchIds: string[],
  ): Promise<Map<string, BranchProfileState>>;
  /** Every licence of the branch, newest first (the current one included). */
  listLicences(
    tenantId: string,
    branchId: string,
  ): Promise<BranchSchoolLicence[]>;
  /** Inserts a licence and makes it the branch's current licence. */
  recordLicence(licence: NewBranchLicence): Promise<BranchSchoolLicence>;
  correctLicence(
    tenantId: string,
    branchId: string,
    licenceId: string,
    change: Partial<LicenceDetails>,
  ): Promise<BranchSchoolLicence>;
  /** Makes the offered set exactly `vehicleClassIds`. */
  replaceOfferedClasses(
    tenantId: string,
    branchId: string,
    vehicleClassIds: string[],
  ): Promise<void>;
}
