import { BillingPeriod } from '../../../generated/prisma/enums.js';
import {
  parseIsoDate as d,
  toIsoDate,
} from '../../../common/time/calendar-date.js';
import { addMonthsClamped, currentPeriod } from './billing-period.js';

const iso = (date: Date | null) => (date ? toIsoDate(date) : null);

describe('addMonthsClamped', () => {
  it.each([
    ['2026-01-31', 1, '2026-02-28'],
    ['2026-01-31', 2, '2026-03-31'],
    ['2028-01-31', 1, '2028-02-29'],
    ['2026-11-15', 3, '2027-02-15'],
    ['2026-10-07', 12, '2027-10-07'],
  ])('%s + %d months = %s', (anchor, months, expected) => {
    expect(iso(addMonthsClamped(d(anchor), months))).toBe(expected);
  });
});

describe('currentPeriod', () => {
  const monthly = (startDate: string, trialEndDate: string | null = null) => ({
    billingPeriod: BillingPeriod.MONTHLY,
    startDate: d(startDate),
    trialEndDate: trialEndDate ? d(trialEndDate) : null,
  });

  it('starts the first period on the start date without a trial', () => {
    const info = currentPeriod(monthly('2026-10-07'), d('2026-10-07'));
    expect({
      inTrial: info.inTrial,
      start: iso(info.periodStart),
      end: iso(info.periodEnd),
      renewal: iso(info.nextRenewalDate),
    }).toEqual({
      inTrial: false,
      start: '2026-10-07',
      end: '2026-11-07',
      renewal: '2026-11-07',
    });
  });

  it('renews on the day after the trial while in trial', () => {
    const info = currentPeriod(
      monthly('2026-10-07', '2026-10-21'),
      d('2026-10-21'),
    );
    expect(info.inTrial).toBe(true);
    expect(info.periodStart).toBeNull();
    expect(iso(info.nextRenewalDate)).toBe('2026-10-22');
  });

  it('anchors paid periods on the day after the trial', () => {
    const info = currentPeriod(
      monthly('2026-10-07', '2026-10-21'),
      d('2026-12-01'),
    );
    expect(info.inTrial).toBe(false);
    expect(iso(info.periodStart)).toBe('2026-11-22');
    expect(iso(info.nextRenewalDate)).toBe('2026-12-22');
  });

  it('moves to the next period exactly on the renewal date', () => {
    const info = currentPeriod(monthly('2026-10-07'), d('2026-11-07'));
    expect(iso(info.periodStart)).toBe('2026-11-07');
    expect(iso(info.nextRenewalDate)).toBe('2026-12-07');
  });

  it('keeps month-end anchors across short months', () => {
    const sub = monthly('2026-01-31');
    expect(iso(currentPeriod(sub, d('2026-02-27')).nextRenewalDate)).toBe(
      '2026-02-28',
    );
    expect(iso(currentPeriod(sub, d('2026-03-01')).nextRenewalDate)).toBe(
      '2026-03-31',
    );
  });

  it.each([
    [BillingPeriod.QUARTERLY, '2027-03-15', '2027-02-15', '2027-05-15'],
    [BillingPeriod.ANNUAL, '2028-06-01', '2027-11-15', '2028-11-15'],
  ])('handles %s periods', (billingPeriod, today, start, end) => {
    const info = currentPeriod(
      { billingPeriod, startDate: d('2026-11-15'), trialEndDate: null },
      d(today),
    );
    expect(iso(info.periodStart)).toBe(start);
    expect(iso(info.periodEnd)).toBe(end);
  });
});
