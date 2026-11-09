import { toIsoDate } from '../../common/time/calendar-date.js';

/** How far ahead an approaching licence expiry is flagged. */
export const LICENCE_EXPIRY_WARNING_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export type LicenceExpiry =
  | { state: 'EXPIRED'; expiredOn: string }
  | { state: 'EXPIRING'; expiresOn: string; daysLeft: number };

/**
 * Whether a licence has expired or expires within the warning window.
 * Informational only: licence validity is the school's responsibility, so
 * callers turn this into warnings, never blockers. `today` and `expiresOn`
 * are calendar dates (UTC midnight); the licence is valid through its expiry
 * date.
 */
export function licenceExpiry(
  expiresOn: Date,
  today: Date,
): LicenceExpiry | null {
  const daysLeft = Math.round((expiresOn.getTime() - today.getTime()) / DAY_MS);
  if (daysLeft < 0)
    return { state: 'EXPIRED', expiredOn: toIsoDate(expiresOn) };
  if (daysLeft <= LICENCE_EXPIRY_WARNING_DAYS) {
    return { state: 'EXPIRING', expiresOn: toIsoDate(expiresOn), daysLeft };
  }
  return null;
}
