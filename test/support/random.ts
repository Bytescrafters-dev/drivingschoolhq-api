import { randomInt } from 'node:crypto';

/** Random 8-digit string, e.g. for unique DS codes ("DS" + digits). */
export function randomDigits(): string {
  return String(randomInt(10_000_000, 100_000_000));
}
