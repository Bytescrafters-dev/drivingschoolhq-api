import { toIsoDate } from '../../../common/time/calendar-date.js';
import type {
  DrivingSchoolGrade,
  InstructorProfileStatus,
  TenantRole,
  TenantUserStatus,
} from '../../../generated/prisma/enums.js';
import {
  toVehicleClassResponse,
  type VehicleClassResponse,
} from '../../../reference-data/vehicle-classes/vehicle-class.response.js';
import type {
  InstructorProfileState,
  InstructorReadiness,
} from '../instructor-readiness.js';
import type {
  InstructorChangeResult,
  InstructorDetail,
  InstructorListItem,
  InstructorView,
} from '../instructors.service.js';
import type {
  InstructorLicence,
  InstructorUser,
} from './instructor-profile.repository.js';

export interface InstructorUserResponse {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  role: TenantRole;
  /** Staff status (sign-in), independent of the profile status. */
  status: TenantUserStatus;
}

export interface InstructorLicenceResponse {
  id: string;
  licenceNumber: string;
  grade: DrivingSchoolGrade;
  issuedOn: string;
  expiresOn: string;
  recordedByTenantUserId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface InstructorProfileSummaryResponse {
  id: string;
  status: InstructorProfileStatus;
  inactivatedAt: Date | null;
  grade: DrivingSchoolGrade | null;
  licenceNumber: string | null;
  licenceExpiresOn: string | null;
  createdAt: Date;
}

export interface InstructorViewResponse {
  user: InstructorUserResponse;
  profileStatus: InstructorProfileState;
  profile: InstructorProfileSummaryResponse | null;
  qualifiedVehicleClasses: string[];
  readiness: InstructorReadiness;
  canCreate: boolean;
  canEdit: boolean;
  canChangeStatus: boolean;
}

export interface InstructorListItemResponse extends InstructorViewResponse {
  /** Classes this person can teach in the working branch. */
  teachableHere: string[];
}

export interface InstructorDetailResponse extends InstructorViewResponse {
  currentLicence: InstructorLicenceResponse | null;
  licenceHistory: InstructorLicenceResponse[];
  permittedVehicleClasses: VehicleClassResponse[];
  branches: { id: string; name: string; teachableVehicleClasses: string[] }[];
}

function toUserResponse(user: InstructorUser): InstructorUserResponse {
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    phone: user.phone,
    role: user.role,
    status: user.status,
  };
}

export function toInstructorLicenceResponse(
  licence: InstructorLicence,
): InstructorLicenceResponse {
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

export function toInstructorViewResponse(
  view: InstructorView,
): InstructorViewResponse {
  const { user, profile } = view.person;
  const licence = profile?.currentLicence ?? null;
  return {
    user: toUserResponse(user),
    profileStatus: view.state,
    profile: profile
      ? {
          id: profile.id,
          status: profile.status,
          inactivatedAt: profile.inactivatedAt,
          grade: licence?.grade ?? null,
          licenceNumber: licence?.licenceNumber ?? null,
          licenceExpiresOn: licence ? toIsoDate(licence.expiresOn) : null,
          createdAt: profile.createdAt,
        }
      : null,
    qualifiedVehicleClasses: view.qualifiedClasses.map((c) => c.code),
    readiness: view.readiness,
    canCreate: view.canCreate,
    canEdit: view.canEdit,
    canChangeStatus: view.canChangeStatus,
  };
}

export function toInstructorListItemResponse(
  item: InstructorListItem,
): InstructorListItemResponse {
  return {
    ...toInstructorViewResponse(item),
    teachableHere: item.teachableHere.map((c) => c.code),
  };
}

export function toInstructorDetailResponse(
  detail: InstructorDetail,
): InstructorDetailResponse {
  const licence = detail.person.profile?.currentLicence ?? null;
  return {
    ...toInstructorViewResponse(detail),
    currentLicence: licence ? toInstructorLicenceResponse(licence) : null,
    licenceHistory: detail.licenceHistory.map(toInstructorLicenceResponse),
    permittedVehicleClasses: detail.permittedClasses.map(
      toVehicleClassResponse,
    ),
    branches: detail.branches.map((b) => ({
      id: b.id,
      name: b.name,
      teachableVehicleClasses: b.teachableClasses.map((c) => c.code),
    })),
  };
}

export function toInstructorChangeResponse(result: InstructorChangeResult) {
  return {
    ...toInstructorDetailResponse(result.detail),
    /** Qualified classes dropped because the new grade does not permit them. */
    removedVehicleClasses: result.removedVehicleClasses,
  };
}
