/** Canonical Sri Lankan phone form stored in the database (enforced by CHECKs). */
export const SRI_LANKAN_PHONE_PATTERN = /^\+94[1-9]\d{8}$/;

/** Sri Lankan NIC: old (9 digits + V/X) or new (12 digits) format, uppercased. */
export const NIC_PATTERN = /^(\d{9}[VX]|\d{12})$/;

/**
 * Normalises a Sri Lankan phone number to +94XXXXXXXXX. Accepts the local
 * (0771234567), short (771234567) and international (94…/+94…) forms with
 * optional spaces, dashes or parentheses. Returns null when it is not valid.
 */
export function normalizeSriLankanPhone(raw: string): string | null {
  const compact = raw.replace(/[\s\-()]/g, '');
  const match = /^(?:\+94|94|0)?([1-9]\d{8})$/.exec(compact);
  return match ? `+94${match[1]}` : null;
}

/** Trims and uppercases a NIC. Returns null when it is not a valid format. */
export function normalizeNic(raw: string): string | null {
  const nic = raw.trim().toUpperCase();
  return NIC_PATTERN.test(nic) ? nic : null;
}
