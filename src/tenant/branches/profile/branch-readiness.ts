import { licenceExpiry } from '../../../reference-data/vehicle-classes/licence-validity.js';

/** Things that stop the branch from taking class-dependent work. */
export type ReadinessBlocker =
  { code: 'BRANCH_LICENCE_MISSING' } | { code: 'NO_VEHICLE_CLASSES_OFFERED' };

/**
 * Informational only. Licence validity is the school's responsibility, so an
 * expired or expiring licence never blocks anything.
 */
export type ReadinessWarning =
  | { code: 'BRANCH_LICENCE_EXPIRED'; expiredOn: string }
  | { code: 'BRANCH_LICENCE_EXPIRING'; expiresOn: string; daysLeft: number };

export interface BranchReadiness {
  /** True when nothing blocks the branch (warnings may still exist). */
  operational: boolean;
  blockers: ReadinessBlocker[];
  warnings: ReadinessWarning[];
}

/**
 * The single rule for whether a branch profile is complete enough to operate.
 * `today` and `expiresOn` are calendar dates (UTC midnight); the licence is
 * valid through its expiry date.
 */
export function evaluateBranchReadiness(
  input: { licence: { expiresOn: Date } | null; offeredClassCount: number },
  today: Date,
): BranchReadiness {
  const blockers: ReadinessBlocker[] = [];
  const warnings: ReadinessWarning[] = [];
  if (!input.licence) {
    blockers.push({ code: 'BRANCH_LICENCE_MISSING' });
  } else {
    const expiry = licenceExpiry(input.licence.expiresOn, today);
    if (expiry?.state === 'EXPIRED') {
      warnings.push({
        code: 'BRANCH_LICENCE_EXPIRED',
        expiredOn: expiry.expiredOn,
      });
    } else if (expiry?.state === 'EXPIRING') {
      warnings.push({
        code: 'BRANCH_LICENCE_EXPIRING',
        expiresOn: expiry.expiresOn,
        daysLeft: expiry.daysLeft,
      });
    }
  }
  if (input.licence && input.offeredClassCount === 0) {
    blockers.push({ code: 'NO_VEHICLE_CLASSES_OFFERED' });
  }
  return { operational: blockers.length === 0, blockers, warnings };
}
