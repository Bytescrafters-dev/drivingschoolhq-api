import { businessToday, parseIsoDate, toIsoDate } from './calendar-date.js';

describe('calendar dates', () => {
  it('evaluates today in Asia/Colombo (UTC+05:30)', () => {
    // 2026-10-15 19:00 UTC is already 2026-10-16 00:30 in Colombo.
    expect(toIsoDate(businessToday(new Date('2026-10-15T19:00:00Z')))).toBe(
      '2026-10-16',
    );
    expect(toIsoDate(businessToday(new Date('2026-10-15T18:29:00Z')))).toBe(
      '2026-10-15',
    );
  });

  it('round-trips ISO dates', () => {
    expect(toIsoDate(parseIsoDate('2026-02-28'))).toBe('2026-02-28');
  });

  it.each(['2026-02-30', '2026-13-01', '26-01-01', 'today'])(
    'rejects %s',
    (value) => {
      expect(() => parseIsoDate(value)).toThrow();
    },
  );
});
