import { Prisma } from '../generated/prisma/client.js';

/**
 * Name of the unique index violated by a P2002 error, or null when the error
 * is not a unique violation. With the pg driver adapter the index name is in
 * `meta.driverAdapterError.cause.constraint.index`; we fall back to searching
 * the serialized meta so the check survives minor Prisma shape changes.
 */
export function violatedUniqueIndex(
  error: unknown,
  candidates: readonly string[],
): string | null {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== 'P2002'
  ) {
    return null;
  }
  const meta = JSON.stringify(error.meta ?? {});
  return candidates.find((name) => meta.includes(name)) ?? 'UNKNOWN';
}
