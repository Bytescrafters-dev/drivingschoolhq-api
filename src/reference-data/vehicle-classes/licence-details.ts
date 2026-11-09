import { AppError } from '../../common/errors/app-error.js';
import { parseIsoDate, toIsoDate } from '../../common/time/calendar-date.js';
import type { DrivingSchoolGrade } from '../../generated/prisma/enums.js';

/**
 * A graded licence as data entry (branch driving-school licences, instructor
 * licences): number, grade and validity dates (calendar dates at UTC
 * midnight). The number is kept as entered and is not unique.
 */
export interface LicenceDetails {
  licenceNumber: string;
  grade: DrivingSchoolGrade;
  issuedOn: Date;
  expiresOn: Date;
}

/** Licence fields as received (calendar dates as YYYY-MM-DD). */
export interface LicenceInput {
  licenceNumber: string;
  grade: DrivingSchoolGrade;
  issuedOn: string;
  expiresOn: string;
}

export type LicenceDiff = Record<string, { from: string; to: string }>;

/** Parses and validates a complete licence (400 INVALID_LICENCE_DATES). */
export function parseLicence(input: LicenceInput): LicenceDetails {
  const details: LicenceDetails = {
    licenceNumber: requireLicenceNumber(input.licenceNumber),
    grade: input.grade,
    issuedOn: parseDate(input.issuedOn, 'issuedOn'),
    expiresOn: parseDate(input.expiresOn, 'expiresOn'),
  };
  assertLicenceDateOrder(details);
  return details;
}

/** Parses a partial correction; check the merged dates with assertLicenceDateOrder. */
export function parseLicenceChange(
  input: Partial<LicenceInput>,
): Partial<LicenceDetails> {
  const change: Partial<LicenceDetails> = {};
  if (input.licenceNumber !== undefined) {
    change.licenceNumber = requireLicenceNumber(input.licenceNumber);
  }
  if (input.grade !== undefined) change.grade = input.grade;
  if (input.issuedOn !== undefined) {
    change.issuedOn = parseDate(input.issuedOn, 'issuedOn');
  }
  if (input.expiresOn !== undefined) {
    change.expiresOn = parseDate(input.expiresOn, 'expiresOn');
  }
  return change;
}

export function assertLicenceDateOrder(dates: {
  issuedOn: Date;
  expiresOn: Date;
}): void {
  if (dates.expiresOn.getTime() <= dates.issuedOn.getTime()) {
    throw new AppError(
      'BAD_REQUEST',
      'INVALID_LICENCE_DATES',
      'The licence must expire after it was issued',
    );
  }
}

/** Licence fields as audit metadata (dates as YYYY-MM-DD). */
export function licenceMetadata(licence: LicenceDetails) {
  return {
    licenceNumber: licence.licenceNumber,
    grade: licence.grade,
    issuedOn: toIsoDate(licence.issuedOn),
    expiresOn: toIsoDate(licence.expiresOn),
  };
}

/** Fields a correction actually changes, as { from, to }. */
export function diffLicence(
  current: LicenceDetails,
  change: Partial<LicenceDetails>,
): LicenceDiff {
  const before = licenceMetadata(current);
  const after = licenceMetadata({ ...current, ...change });
  const changes: LicenceDiff = {};
  for (const key of Object.keys(before) as (keyof typeof before)[]) {
    if (before[key] !== after[key]) {
      changes[key] = { from: before[key], to: after[key] };
    }
  }
  return changes;
}

function requireLicenceNumber(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new AppError(
      'BAD_REQUEST',
      'BAD_REQUEST',
      'licenceNumber is required',
    );
  }
  return trimmed;
}

function parseDate(value: string, field: string): Date {
  try {
    return parseIsoDate(value);
  } catch {
    throw new AppError(
      'BAD_REQUEST',
      'INVALID_LICENCE_DATES',
      `${field} must be a valid YYYY-MM-DD date`,
    );
  }
}
