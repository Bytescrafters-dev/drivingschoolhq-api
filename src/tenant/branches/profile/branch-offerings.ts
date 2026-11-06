/** Offered classes after a licence is recorded or its grade corrected. */
export interface OfferingsChange {
  /** The new offered set. */
  next: string[];
  /** Previously offered classes the new grade does not permit (dropped). */
  removed: string[];
  /** True when the first licence pre-filled every permitted class. */
  prefilled: boolean;
}

/**
 * Offered ⊆ permitted, always:
 * - the first licence offers every class its grade permits (the school then
 *   opts out of what it doesn't teach);
 * - later grade changes keep what is still permitted and drop the rest;
 *   newly permitted classes are not added (the school opts in).
 * Order follows `permittedIds`.
 */
export function offeringsForLicence(args: {
  isFirstLicence: boolean;
  offeredIds: string[];
  permittedIds: string[];
}): OfferingsChange {
  if (args.isFirstLicence) {
    return {
      next: [...args.permittedIds],
      removed: args.offeredIds.filter((id) => !args.permittedIds.includes(id)),
      prefilled: true,
    };
  }
  const offered = new Set(args.offeredIds);
  return {
    next: args.permittedIds.filter((id) => offered.has(id)),
    removed: args.offeredIds.filter((id) => !args.permittedIds.includes(id)),
    prefilled: false,
  };
}
