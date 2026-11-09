/** Vehicle classes after a licence is recorded or its grade corrected. */
export interface LicenceClassesChange {
  /** The new class set. */
  next: string[];
  /** Previously held classes the new grade does not permit (dropped). */
  removed: string[];
  /** True when the first licence pre-filled every permitted class. */
  prefilled: boolean;
}

/**
 * The class set of a licence holder (a branch's offerings, an instructor's
 * qualifications) is always ⊆ what the grade permits:
 * - the first licence pre-fills every class its grade permits (the holder
 *   then opts out of what they don't teach);
 * - later grade changes keep what is still permitted and drop the rest;
 *   newly permitted classes are not added (the holder opts in).
 * Order follows `permittedIds`.
 */
export function classesForLicence(args: {
  isFirstLicence: boolean;
  currentIds: string[];
  permittedIds: string[];
}): LicenceClassesChange {
  const removed = args.currentIds.filter(
    (id) => !args.permittedIds.includes(id),
  );
  if (args.isFirstLicence) {
    return { next: [...args.permittedIds], removed, prefilled: true };
  }
  const current = new Set(args.currentIds);
  return {
    next: args.permittedIds.filter((id) => current.has(id)),
    removed,
    prefilled: false,
  };
}
