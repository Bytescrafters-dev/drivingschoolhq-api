import { toIsoDate } from '../../../common/time/calendar-date.js';

/** How far ahead an approaching licence expiry is flagged. */
export const LICENCE_EXPIRY_WARNING_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

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
    const daysLeft = Math.round(
      (input.licence.expiresOn.getTime() - today.getTime()) / DAY_MS,
    );
    if (daysLeft < 0) {
      warnings.push({
        code: 'BRANCH_LICENCE_EXPIRED',
        expiredOn: toIsoDate(input.licence.expiresOn),
      });
    } else if (daysLeft <= LICENCE_EXPIRY_WARNING_DAYS) {
      warnings.push({
        code: 'BRANCH_LICENCE_EXPIRING',
        expiresOn: toIsoDate(input.licence.expiresOn),
        daysLeft,
      });
    }
  }
  if (input.licence && input.offeredClassCount === 0) {
    blockers.push({ code: 'NO_VEHICLE_CLASSES_OFFERED' });
  }
  return { operational: blockers.length === 0, blockers, warnings };
}
