import { offeringsForLicence } from './branch-offerings.js';

describe('offeringsForLicence', () => {
  it('pre-fills every permitted class on the first licence', () => {
    expect(
      offeringsForLicence({
        isFirstLicence: true,
        offeredIds: [],
        permittedIds: ['a1', 'a', 'b'],
      }),
    ).toEqual({ next: ['a1', 'a', 'b'], removed: [], prefilled: true });
  });

  it('drops classes a lower grade does not permit', () => {
    expect(
      offeringsForLicence({
        isFirstLicence: false,
        offeredIds: ['a1', 'b', 'ce'],
        permittedIds: ['a1', 'a', 'b'],
      }),
    ).toEqual({ next: ['a1', 'b'], removed: ['ce'], prefilled: false });
  });

  it('adds nothing when a higher grade permits more', () => {
    expect(
      offeringsForLicence({
        isFirstLicence: false,
        offeredIds: ['b'],
        permittedIds: ['a1', 'a', 'b', 'ce'],
      }),
    ).toEqual({ next: ['b'], removed: [], prefilled: false });
  });
});
