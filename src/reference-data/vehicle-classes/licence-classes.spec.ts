import { classesForLicence } from './licence-classes.js';

describe('classesForLicence', () => {
  it('pre-fills every permitted class on the first licence', () => {
    expect(
      classesForLicence({
        isFirstLicence: true,
        currentIds: [],
        permittedIds: ['a1', 'a', 'b'],
      }),
    ).toEqual({ next: ['a1', 'a', 'b'], removed: [], prefilled: true });
  });

  it('drops classes a lower grade does not permit', () => {
    expect(
      classesForLicence({
        isFirstLicence: false,
        currentIds: ['a1', 'b', 'ce'],
        permittedIds: ['a1', 'a', 'b'],
      }),
    ).toEqual({ next: ['a1', 'b'], removed: ['ce'], prefilled: false });
  });

  it('adds nothing when a higher grade permits more', () => {
    expect(
      classesForLicence({
        isFirstLicence: false,
        currentIds: ['b'],
        permittedIds: ['a1', 'a', 'b', 'ce'],
      }),
    ).toEqual({ next: ['b'], removed: [], prefilled: false });
  });
});
