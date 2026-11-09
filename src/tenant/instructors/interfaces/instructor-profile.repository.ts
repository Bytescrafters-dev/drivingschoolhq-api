import type {
  BranchStatus,
  InstructorProfileStatus,
  TenantRole,
  TenantUserBranchAccess,
  TenantUserStatus,
} from '../../../generated/prisma/enums.js';
import type { LicenceDetails } from '../../../reference-data/vehicle-classes/licence-details.js';

export const INSTRUCTOR_PROFILE_REPOSITORY = Symbol(
  'INSTRUCTOR_PROFILE_REPOSITORY',
);

/** An instructor licence (calendar dates at UTC midnight). */
export interface InstructorLicence extends LicenceDetails {
  id: string;
  tenantId: string;
  instructorProfileId: string;
  recordedByTenantUserId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface InstructorProfile {
  id: string;
  tenantId: string;
  tenantUserId: string;
  status: InstructorProfileStatus;
  inactivatedAt: Date | null;
  currentLicence: InstructorLicence | null;
  qualifiedVehicleClassIds: string[];
  createdByTenantUserId: string;
  createdAt: Date;
  updatedAt: Date;
}

/** The staff side of an instructor (read-only here; staff owns it). */
export interface InstructorUser {
  id: string;
  tenantId: string;
  fullName: string;
  email: string;
  phone: string | null;
  role: TenantRole;
  status: TenantUserStatus;
  branchAccess: TenantUserBranchAccess;
  /** Assigned branches of a SELECTED user (any status). */
  branches: { id: string; name: string; status: BranchStatus }[];
}

/** A staff member with their instructor profile, if any. */
export interface InstructorPerson {
  user: InstructorUser;
  profile: InstructorProfile | null;
}

export interface NewInstructorProfile {
  tenantId: string;
  tenantUserId: string;
  createdByTenantUserId: string;
  licence: LicenceDetails;
  vehicleClassIds: string[];
}

/**
 * Instructor profiles, licences and qualified classes. Every operation is
 * tenant-scoped; callers have already verified access to the person.
 */
export interface InstructorProfileRepository {
  /**
   * People who can work in the branch (ALL access or assigned to it) and are
   * instructors: they hold a profile, or have the INSTRUCTOR role. By name.
   */
  listForBranch(
    tenantId: string,
    branchId: string,
  ): Promise<InstructorPerson[]>;
  /** ACTIVE staff who can work in the branch and have no profile. By name. */
  listCandidates(
    tenantId: string,
    branchId: string,
  ): Promise<InstructorPerson[]>;
  findByUserId(
    tenantId: string,
    tenantUserId: string,
  ): Promise<InstructorProfile | null>;
  /** Locks the profile row (FOR UPDATE) and returns it. */
  lockByUserId(
    tenantId: string,
    tenantUserId: string,
  ): Promise<InstructorProfile | null>;
  findPerson(
    tenantId: string,
    instructorProfileId: string,
  ): Promise<InstructorPerson | null>;
  /** ACTIVE profiles: the MAX_INSTRUCTORS seat count. */
  countActive(tenantId: string): Promise<number>;
  /**
   * Inserts the profile (ACTIVE), its first licence (made current) and its
   * classes. Throws INSTRUCTOR_PROFILE_EXISTS when the person has one.
   */
  create(profile: NewInstructorProfile): Promise<InstructorProfile>;
  /** Every licence of the profile, newest first (the current one included). */
  listLicences(
    tenantId: string,
    instructorProfileId: string,
  ): Promise<InstructorLicence[]>;
  /** Inserts a licence and makes it the profile's current licence. */
  recordLicence(
    tenantId: string,
    instructorProfileId: string,
    licence: LicenceDetails,
    recordedByTenantUserId: string,
  ): Promise<InstructorLicence>;
  correctLicence(
    tenantId: string,
    instructorProfileId: string,
    licenceId: string,
    change: Partial<LicenceDetails>,
  ): Promise<InstructorLicence>;
  /** Makes the qualified set exactly `vehicleClassIds`. */
  replaceQualifiedClasses(
    tenantId: string,
    instructorProfileId: string,
    vehicleClassIds: string[],
  ): Promise<void>;
  setStatus(
    tenantId: string,
    instructorProfileId: string,
    status: InstructorProfileStatus,
    inactivatedAt: Date | null,
  ): Promise<InstructorProfile>;
}
