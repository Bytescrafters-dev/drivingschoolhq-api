import { parseIsoDate } from '../../../common/time/calendar-date.js';
import { evaluateBranchReadiness } from './branch-readiness.js';

const TODAY = parseIsoDate('2026-11-04');
const licence = (expiresOn: string) => ({ expiresOn: parseIsoDate(expiresOn) });

describe('evaluateBranchReadiness', () => {
  it('blocks a branch without a licence', () => {
    expect(
      evaluateBranchReadiness({ licence: null, offeredClassCount: 0 }, TODAY),
    ).toEqual({
      operational: false,
      blockers: [{ code: 'BRANCH_LICENCE_MISSING' }],
      warnings: [],
    });
  });

  it('blocks a licensed branch offering no classes', () => {
    const result = evaluateBranchReadiness(
      { licence: licence('2028-01-01'), offeredClassCount: 0 },
      TODAY,
    );
    expect(result.operational).toBe(false);
    expect(result.blockers).toEqual([{ code: 'NO_VEHICLE_CLASSES_OFFERED' }]);
  });

  it('is operational with a valid licence and offered classes', () => {
    expect(
      evaluateBranchReadiness(
        { licence: licence('2028-01-01'), offeredClassCount: 3 },
        TODAY,
      ),
    ).toEqual({ operational: true, blockers: [], warnings: [] });
  });

  it('only warns when the licence has expired', () => {
    const result = evaluateBranchReadiness(
      { licence: licence('2026-11-03'), offeredClassCount: 3 },
      TODAY,
    );
    expect(result.operational).toBe(true);
    expect(result.warnings).toEqual([
      { code: 'BRANCH_LICENCE_EXPIRED', expiredOn: '2026-11-03' },
    ]);
  });

  it('treats the expiry date itself as still valid but expiring', () => {
    const result = evaluateBranchReadiness(
      { licence: licence('2026-11-04'), offeredClassCount: 1 },
      TODAY,
    );
    expect(result.warnings).toEqual([
      { code: 'BRANCH_LICENCE_EXPIRING', expiresOn: '2026-11-04', daysLeft: 0 },
    ]);
  });

  it('warns within 30 days of expiry, not before', () => {
    const within = evaluateBranchReadiness(
      { licence: licence('2026-12-04'), offeredClassCount: 1 },
      TODAY,
    );
    expect(within.warnings).toEqual([
      {
        code: 'BRANCH_LICENCE_EXPIRING',
        expiresOn: '2026-12-04',
        daysLeft: 30,
      },
    ]);
    const outside = evaluateBranchReadiness(
      { licence: licence('2026-12-05'), offeredClassCount: 1 },
      TODAY,
    );
    expect(outside.warnings).toEqual([]);
  });
});
