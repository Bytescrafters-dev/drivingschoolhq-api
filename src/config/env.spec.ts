import { validateEnv } from './env.js';

const BASE = {
  DATABASE_URL: 'postgresql://localhost/db',
  PLATFORM_JWT_SECRET: 'p'.repeat(32),
  TENANT_JWT_SECRET: 't'.repeat(32),
};

describe('validateEnv CORS_ORIGINS', () => {
  it('defaults to no origins (CORS off)', () => {
    expect(validateEnv(BASE).CORS_ORIGINS).toEqual([]);
    expect(validateEnv({ ...BASE, CORS_ORIGINS: '' }).CORS_ORIGINS).toEqual([]);
  });

  it('parses a trimmed, de-duplicated comma-separated list', () => {
    expect(
      validateEnv({
        ...BASE,
        CORS_ORIGINS:
          ' http://localhost:3000 , https://admin.drivingschoolhq.lk,http://localhost:3000,',
      }).CORS_ORIGINS,
    ).toEqual(['http://localhost:3000', 'https://admin.drivingschoolhq.lk']);
  });

  it.each([
    '*',
    'localhost:3000',
    'ftp://files.example.com',
    'https://admin.example.com/',
    'https://admin.example.com/app',
  ])('rejects %s', (value) => {
    expect(() => validateEnv({ ...BASE, CORS_ORIGINS: value })).toThrow(
      /CORS_ORIGINS/,
    );
  });
});
