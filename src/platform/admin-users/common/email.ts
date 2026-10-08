/** Platform admin emails are stored trimmed and lowercased (enforced by a DB CHECK). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
