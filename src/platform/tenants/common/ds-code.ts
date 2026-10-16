/**
 * Government-issued driving school code: "DS" followed by digits, e.g. DS119,
 * DS1234. Stored trimmed and uppercased (also enforced by a DB CHECK).
 */
export const DS_CODE_PATTERN = /^DS\d{1,10}$/;

export const DS_CODE_MESSAGE =
  'dsCode must be "DS" followed by digits, e.g. DS119';

/** Trims and uppercases; returns null when the result is not a valid DS code. */
export function normalizeDsCode(raw: string): string | null {
  const dsCode = raw.trim().toUpperCase();
  return DS_CODE_PATTERN.test(dsCode) ? dsCode : null;
}
