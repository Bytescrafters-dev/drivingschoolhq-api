import 'dotenv/config';

/**
 * Integration/e2e tests run against a dedicated `<db>_test` database derived
 * from DATABASE_URL (or TEST_DATABASE_URL). Refuses anything not ending in `_test`.
 */
export function resolveTestDatabaseUrl(): string {
  const explicit = process.env.TEST_DATABASE_URL;
  const base = explicit ?? process.env.DATABASE_URL;
  if (!base)
    throw new Error(
      'DATABASE_URL or TEST_DATABASE_URL must be set for DB tests',
    );

  const url = new URL(base);
  const dbName = url.pathname.replace(/^\//, '');
  if (!explicit && !dbName.endsWith('_test')) {
    url.pathname = `/${dbName}_test`;
  }
  assertTestDatabase(url.toString());
  return url.toString();
}

export function assertTestDatabase(databaseUrl: string): void {
  const dbName = new URL(databaseUrl).pathname.replace(/^\//, '');
  if (!dbName.endsWith('_test')) {
    throw new Error(
      `Refusing to run DB tests against non-test database "${dbName}"`,
    );
  }
}

export function applyTestEnv(): void {
  process.env.DATABASE_URL = resolveTestDatabaseUrl();
  process.env.PLATFORM_JWT_SECRET ??=
    'test-platform-jwt-secret-at-least-32-characters';
  process.env.PLATFORM_AUTH_RATE_LIMIT = '1000';
  process.env.PLATFORM_AUTH_RATE_WINDOW_SECONDS = '60';
}
