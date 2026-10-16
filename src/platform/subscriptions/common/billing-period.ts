import { BillingPeriod } from '../../../generated/prisma/enums.js';

/**
 * Billing-period arithmetic on calendar dates (UTC-midnight Dates).
 *
 * - Paid periods start on `paidFrom`: the day after the trial's last day, or
 *   the subscription start date when there is no trial.
 * - Each period is 1, 3 or 12 months long. Period boundaries are computed from
 *   `paidFrom`, clamping to the last day of shorter months
 *   (31 Jan → 28 Feb → 31 Mar).
 * - The next renewal date is the end (exclusive) of the current period, or
 *   `paidFrom` while the subscription is still in its trial.
 */
export const BILLING_PERIOD_MONTHS: Record<BillingPeriod, number> = {
  [BillingPeriod.MONTHLY]: 1,
  [BillingPeriod.QUARTERLY]: 3,
  [BillingPeriod.ANNUAL]: 12,
};

export interface BillableSubscription {
  billingPeriod: BillingPeriod;
  startDate: Date;
  trialEndDate: Date | null;
}

export interface PeriodInfo {
  inTrial: boolean;
  /** Null until paid periods begin. */
  periodStart: Date | null;
  /** Exclusive. Null until paid periods begin. */
  periodEnd: Date | null;
  nextRenewalDate: Date;
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

/** Adds months to an anchor date, clamping to the end of shorter months. */
export function addMonthsClamped(anchor: Date, months: number): Date {
  const target = new Date(
    Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + months, 1),
  );
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return new Date(
    Date.UTC(
      target.getUTCFullYear(),
      target.getUTCMonth(),
      Math.min(anchor.getUTCDate(), lastDay),
    ),
  );
}

export function paidFrom(subscription: BillableSubscription): Date {
  return subscription.trialEndDate
    ? addDays(subscription.trialEndDate, 1)
    : subscription.startDate;
}

export function currentPeriod(
  subscription: BillableSubscription,
  today: Date,
): PeriodInfo {
  const anchor = paidFrom(subscription);
  if (today < anchor) {
    return {
      inTrial: subscription.trialEndDate !== null,
      periodStart: null,
      periodEnd: null,
      nextRenewalDate: anchor,
    };
  }
  const length = BILLING_PERIOD_MONTHS[subscription.billingPeriod];
  const monthsElapsed =
    (today.getUTCFullYear() - anchor.getUTCFullYear()) * 12 +
    (today.getUTCMonth() - anchor.getUTCMonth());
  let index = Math.max(0, Math.floor(monthsElapsed / length));
  const startOf = (i: number) => addMonthsClamped(anchor, i * length);
  while (index > 0 && startOf(index) > today) index--;
  while (startOf(index + 1) <= today) index++;
  const periodEnd = startOf(index + 1);
  return {
    inTrial: false,
    periodStart: startOf(index),
    periodEnd,
    nextRenewalDate: periodEnd,
  };
}
