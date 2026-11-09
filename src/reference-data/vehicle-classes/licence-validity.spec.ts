import { parseIsoDate } from '../../common/time/calendar-date.js';
import {
  LICENCE_EXPIRY_WARNING_DAYS,
  licenceExpiry,
} from './licence-validity.js';

const TODAY = parseIsoDate('2026-11-07');

describe('licenceExpiry', () => {
  it('flags an expired licence from the day after expiry', () => {
    expect(licenceExpiry(parseIsoDate('2026-11-06'), TODAY)).toEqual({
      state: 'EXPIRED',
      expiredOn: '2026-11-06',
    });
  });

  it('treats the expiry day itself as valid but expiring', () => {
    expect(licenceExpiry(parseIsoDate('2026-11-07'), TODAY)).toEqual({
      state: 'EXPIRING',
      expiresOn: '2026-11-07',
      daysLeft: 0,
    });
  });

  it('flags expiry within the warning window only', () => {
    expect(licenceExpiry(parseIsoDate('2026-12-07'), TODAY)).toMatchObject({
      state: 'EXPIRING',
      daysLeft: LICENCE_EXPIRY_WARNING_DAYS,
    });
    expect(licenceExpiry(parseIsoDate('2026-12-08'), TODAY)).toBeNull();
  });
});
