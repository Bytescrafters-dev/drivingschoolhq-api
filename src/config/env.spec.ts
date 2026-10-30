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

describe('validateEnv TRUST_PROXY', () => {
  it('trusts no proxy by default', () => {
    expect(validateEnv(BASE).TRUST_PROXY).toBe(false);
    expect(validateEnv({ ...BASE, TRUST_PROXY: '' }).TRUST_PROXY).toBe(false);
    expect(validateEnv({ ...BASE, TRUST_PROXY: 'false' }).TRUST_PROXY).toBe(
      false,
    );
    expect(validateEnv({ ...BASE, TRUST_PROXY: '0' }).TRUST_PROXY).toBe(false);
  });

  it('accepts a hop count', () => {
    expect(validateEnv({ ...BASE, TRUST_PROXY: '1' }).TRUST_PROXY).toBe(1);
  });

  it('accepts a de-duplicated list of addresses, subnets and named ranges', () => {
    expect(
      validateEnv({
        ...BASE,
        TRUST_PROXY: ' 10.0.0.5, 10.1.0.0/16 ,loopback,::1,fd00::/8,10.0.0.5',
      }).TRUST_PROXY,
    ).toEqual(['10.0.0.5', '10.1.0.0/16', 'loopback', '::1', 'fd00::/8']);
  });

  it.each([
    'true',
    'everyone',
    '10.0.0.300',
    '10.0.0.0/33',
    '::1/129',
    '10.0.0.0/8/1',
    '10.0.0.0/abc',
  ])('rejects %s', (value) => {
    expect(() => validateEnv({ ...BASE, TRUST_PROXY: value })).toThrow(
      /TRUST_PROXY/,
    );
  });
});
