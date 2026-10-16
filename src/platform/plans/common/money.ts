import { AppError } from '../../../common/errors/app-error.js';

/**
 * All platform amounts are LKR, stored as NUMERIC(12,2) and exchanged as
 * decimal strings (never JS floats) so no precision is lost.
 */

/** Non-negative, up to 10 integer digits and 2 decimals (fits NUMERIC(12,2)). */
export const LKR_AMOUNT_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;

/** Canonical 2-decimal form: "005000" → "5000.00", "12.5" → "12.50". */
export function normalizeLkrAmount(amount: string): string {
  if (!LKR_AMOUNT_PATTERN.test(amount)) {
    throw new AppError(
      'BAD_REQUEST',
      'INVALID_AMOUNT',
      'Amount must be a non-negative LKR value with at most 2 decimals',
    );
  }
  const [integer, fraction = ''] = amount.split('.');
  return `${integer!.replace(/^0+(?=\d)/, '')}.${fraction.padEnd(2, '0')}`;
}
