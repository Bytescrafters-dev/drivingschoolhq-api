/** Emails are stored trimmed and lowercased (enforced by DB CHECK constraints). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
