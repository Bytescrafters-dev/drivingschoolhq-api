/**
 * Calendar dates (Prisma `@db.Date`) are represented as Date objects at UTC
 * midnight. The business operates in Sri Lanka, so "today" is evaluated in
 * Asia/Colombo.
 */
export const BUSINESS_TIME_ZONE = 'Asia/Colombo';

export const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Today's calendar date in Asia/Colombo for the given instant. */
export function businessToday(now: Date): Date {
  return parseIsoDate(formatter.format(now));
}

/** Parses "YYYY-MM-DD" into a UTC-midnight Date; throws on invalid dates. */
export function parseIsoDate(value: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    !ISO_DATE_PATTERN.test(value) ||
    Number.isNaN(date.getTime()) ||
    toIsoDate(date) !== value
  ) {
    throw new Error(`Invalid calendar date: ${value}`);
  }
  return date;
}

/** Formats a UTC-midnight Date as "YYYY-MM-DD". */
export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
