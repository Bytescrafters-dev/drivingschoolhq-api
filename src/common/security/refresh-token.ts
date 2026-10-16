import { createHash, randomBytes } from 'node:crypto';

/**
 * Opaque refresh tokens: 256 random bits, base64url. Only the SHA-256 hash is
 * stored, so a database leak does not expose usable tokens.
 */
export function generateRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashRefreshToken(token) };
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
