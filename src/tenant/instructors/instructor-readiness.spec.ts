import {
  InstructorProfileStatus,
  TenantUserStatus,
} from '../../generated/prisma/enums.js';
import { parseIsoDate } from '../../common/time/calendar-date.js';
import {
  evaluateInstructorReadiness,
  profileStateOf,
} from './instructor-readiness.js';

const TODAY = parseIsoDate('2026-11-07');

function profile(
  overrides: Partial<{
    status: InstructorProfileStatus;
    expiresOn: string;
    qualifiedClassCount: number;
  }> = {},
) {
  return {
    status: overrides.status ?? InstructorProfileStatus.ACTIVE,
    licence: { expiresOn: parseIsoDate(overrides.expiresOn ?? '2028-01-01') },
    qualifiedClassCount: overrides.qualifiedClassCount ?? 3,
  };
}

describe('evaluateInstructorReadiness', () => {
  it('is assignable with an active profile, active staff and classes', () => {
    expect(
      evaluateInstructorReadiness(
        { staffStatus: TenantUserStatus.ACTIVE, profile: profile() },
        TODAY,
      ),
    ).toEqual({ assignable: true, blockers: [], warnings: [] });
  });

  it('requires setup without a profile', () => {
    const readiness = evaluateInstructorReadiness(
      { staffStatus: TenantUserStatus.ACTIVE, profile: null },
      TODAY,
    );
    expect(readiness.assignable).toBe(false);
    expect(readiness.blockers).toEqual([{ code: 'INSTRUCTOR_SETUP_REQUIRED' }]);
  });

  it('reports staff and profile status independently', () => {
    const readiness = evaluateInstructorReadiness(
      {
        staffStatus: TenantUserStatus.DISABLED,
        profile: profile({ status: InstructorProfileStatus.INACTIVE }),
      },
      TODAY,
    );
    expect(readiness.blockers).toEqual([
      { code: 'STAFF_DISABLED' },
      { code: 'INSTRUCTOR_INACTIVE' },
    ]);
  });

  it('blocks when every class was opted out', () => {
    expect(
      evaluateInstructorReadiness(
        {
          staffStatus: TenantUserStatus.ACTIVE,
          profile: profile({ qualifiedClassCount: 0 }),
        },
        TODAY,
      ).blockers,
    ).toEqual([{ code: 'NO_QUALIFIED_VEHICLE_CLASSES' }]);
  });

  it('only warns about an expired or expiring licence', () => {
    const expired = evaluateInstructorReadiness(
      {
        staffStatus: TenantUserStatus.ACTIVE,
        profile: profile({ expiresOn: '2026-11-06' }),
      },
      TODAY,
    );
    expect(expired).toEqual({
      assignable: true,
      blockers: [],
      warnings: [
        { code: 'INSTRUCTOR_LICENCE_EXPIRED', expiredOn: '2026-11-06' },
      ],
    });
    const expiring = evaluateInstructorReadiness(
      {
        staffStatus: TenantUserStatus.ACTIVE,
        profile: profile({ expiresOn: '2026-11-07' }),
      },
      TODAY,
    );
    expect(expiring.warnings).toEqual([
      {
        code: 'INSTRUCTOR_LICENCE_EXPIRING',
        expiresOn: '2026-11-07',
        daysLeft: 0,
      },
    ]);
  });

  it('names the profile state', () => {
    expect(profileStateOf(null)).toBe('SETUP_REQUIRED');
    expect(profileStateOf({ status: InstructorProfileStatus.INACTIVE })).toBe(
      'INACTIVE',
    );
  });
});
