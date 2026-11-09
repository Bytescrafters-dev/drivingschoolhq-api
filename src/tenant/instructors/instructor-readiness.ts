import {
  InstructorProfileStatus,
  TenantUserStatus,
} from '../../generated/prisma/enums.js';
import { licenceExpiry } from '../../reference-data/vehicle-classes/licence-validity.js';

/** Shown on the instructors page: no row yet, or the profile's status. */
export type InstructorProfileState = 'SETUP_REQUIRED' | InstructorProfileStatus;

/** Things that stop the person from being assigned new training. */
export type InstructorBlocker =
  | { code: 'INSTRUCTOR_SETUP_REQUIRED' }
  | { code: 'STAFF_DISABLED' }
  | { code: 'INSTRUCTOR_INACTIVE' }
  | { code: 'NO_QUALIFIED_VEHICLE_CLASSES' };

/**
 * Informational only. Licence validity is the school's responsibility, so an
 * expired or expiring instructor licence never blocks anything.
 */
export type InstructorWarning =
  | { code: 'INSTRUCTOR_LICENCE_EXPIRED'; expiredOn: string }
  | {
      code: 'INSTRUCTOR_LICENCE_EXPIRING';
      expiresOn: string;
      daysLeft: number;
    };

export interface InstructorReadiness {
  /** True when nothing blocks assigning the person (warnings may exist). */
  assignable: boolean;
  blockers: InstructorBlocker[];
  warnings: InstructorWarning[];
}

export interface InstructorReadinessInput {
  staffStatus: TenantUserStatus;
  profile: {
    status: InstructorProfileStatus;
    licence: { expiresOn: Date } | null;
    qualifiedClassCount: number;
  } | null;
}

export function profileStateOf(
  profile: { status: InstructorProfileStatus } | null,
): InstructorProfileState {
  return profile ? profile.status : 'SETUP_REQUIRED';
}

/**
 * The single rule for whether a person can take new training as an
 * instructor (branch membership and the branch's offerings are checked
 * separately, per branch). Staff status and profile status stay independent:
 * both are reported. `today` is a calendar date (UTC midnight).
 */
export function evaluateInstructorReadiness(
  input: InstructorReadinessInput,
  today: Date,
): InstructorReadiness {
  const blockers: InstructorBlocker[] = [];
  const warnings: InstructorWarning[] = [];
  const profile = input.profile;
  if (!profile) blockers.push({ code: 'INSTRUCTOR_SETUP_REQUIRED' });
  if (input.staffStatus === TenantUserStatus.DISABLED) {
    blockers.push({ code: 'STAFF_DISABLED' });
  }
  if (profile) {
    if (profile.status === InstructorProfileStatus.INACTIVE) {
      blockers.push({ code: 'INSTRUCTOR_INACTIVE' });
    }
    if (profile.qualifiedClassCount === 0) {
      blockers.push({ code: 'NO_QUALIFIED_VEHICLE_CLASSES' });
    }
    const expiry = profile.licence
      ? licenceExpiry(profile.licence.expiresOn, today)
      : null;
    if (expiry?.state === 'EXPIRED') {
      warnings.push({
        code: 'INSTRUCTOR_LICENCE_EXPIRED',
        expiredOn: expiry.expiredOn,
      });
    } else if (expiry?.state === 'EXPIRING') {
      warnings.push({
        code: 'INSTRUCTOR_LICENCE_EXPIRING',
        expiresOn: expiry.expiresOn,
        daysLeft: expiry.daysLeft,
      });
    }
  }
  return { assignable: blockers.length === 0, blockers, warnings };
}
