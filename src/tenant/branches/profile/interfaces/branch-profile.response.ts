import { toIsoDate } from '../../../../common/time/calendar-date.js';
import type { DrivingSchoolGrade } from '../../../../generated/prisma/enums.js';
import type { VehicleClass } from '../../../../reference-data/vehicle-classes/interfaces/vehicle-class.repository.js';
import type { BranchReadiness } from '../branch-readiness.js';
import type {
  BranchProfile,
  BranchProfileSummary,
} from '../branch-profile-reader.service.js';
import type { BranchSchoolLicence } from './branch-profile.repository.js';

export interface VehicleClassResponse {
  code: string;
  name: string;
  description: string;
  permittedGrades: DrivingSchoolGrade[];
}

export interface BranchLicenceResponse {
  id: string;
  licenceNumber: string;
  grade: DrivingSchoolGrade;
  issuedOn: string;
  expiresOn: string;
  recordedByTenantUserId: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Compact profile attached to branch list/detail responses. */
export interface BranchProfileSummaryResponse {
  grade: DrivingSchoolGrade | null;
  licenceNumber: string | null;
  licenceExpiresOn: string | null;
  offeredVehicleClasses: string[];
  readiness: BranchReadiness;
}

export interface BranchProfileResponse {
  branchId: string;
  currentLicence: BranchLicenceResponse | null;
  licenceHistory: BranchLicenceResponse[];
  permittedVehicleClasses: VehicleClassResponse[];
  offeredVehicleClasses: VehicleClassResponse[];
  readiness: BranchReadiness;
}

export function toVehicleClassResponse(c: VehicleClass): VehicleClassResponse {
  return {
    code: c.code,
    name: c.name,
    description: c.description,
    permittedGrades: c.permittedGrades,
  };
}

export function toBranchLicenceResponse(
  licence: BranchSchoolLicence,
): BranchLicenceResponse {
  return {
    id: licence.id,
    licenceNumber: licence.licenceNumber,
    grade: licence.grade,
    issuedOn: toIsoDate(licence.issuedOn),
    expiresOn: toIsoDate(licence.expiresOn),
    recordedByTenantUserId: licence.recordedByTenantUserId,
    createdAt: licence.createdAt,
    updatedAt: licence.updatedAt,
  };
}

export function toBranchProfileSummaryResponse(
  summary: BranchProfileSummary,
): BranchProfileSummaryResponse {
  const licence = summary.currentLicence;
  return {
    grade: licence?.grade ?? null,
    licenceNumber: licence?.licenceNumber ?? null,
    licenceExpiresOn: licence ? toIsoDate(licence.expiresOn) : null,
    offeredVehicleClasses: summary.offeredClasses.map((c) => c.code),
    readiness: summary.readiness,
  };
}

export function toBranchProfileResponse(
  profile: BranchProfile,
): BranchProfileResponse {
  return {
    branchId: profile.branch.id,
    currentLicence: profile.currentLicence
      ? toBranchLicenceResponse(profile.currentLicence)
      : null,
    licenceHistory: profile.licenceHistory.map(toBranchLicenceResponse),
    permittedVehicleClasses: profile.permittedClasses.map(
      toVehicleClassResponse,
    ),
    offeredVehicleClasses: profile.offeredClasses.map(toVehicleClassResponse),
    readiness: profile.readiness,
  };
}
