export interface Env {
  DATABASE_URL: string;
  PLATFORM_JWT_SECRET: string;
  PLATFORM_ACCESS_TOKEN_TTL_SECONDS: number;
  PLATFORM_REFRESH_TOKEN_TTL_DAYS: number;
  TENANT_JWT_SECRET: string;
  TENANT_ACCESS_TOKEN_TTL_SECONDS: number;
  TENANT_REFRESH_TOKEN_TTL_DAYS: number;
  AUTH_RATE_LIMIT: number;
  AUTH_RATE_WINDOW_SECONDS: number;
  /** Background jobs (e.g. subscription renewal). Disabled in tests. */
  JOBS_ENABLED: boolean;
  /** Browser origins allowed to call the API (exact match). Empty = CORS off. */
  CORS_ORIGINS: string[];
}

const MIN_JWT_SECRET_LENGTH = 32;

function positiveInt(raw: unknown, name: string, fallback: number): number {
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function bool(raw: unknown, name: string, fallback: boolean): boolean {
  if (raw === undefined || raw === '') return fallback;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new Error(`${name} must be "true" or "false"`);
}

/**
 * Comma-separated list of exact origins, e.g.
 * "https://admin.drivingschoolhq.lk,http://localhost:5173". Wildcards are
 * rejected so a misconfiguration can never open the API to every site.
 */
function origins(raw: unknown, name: string): string[] {
  if (raw === undefined || raw === '') return [];
  if (typeof raw !== 'string') throw new Error(`${name} must be a string`);
  const values = raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value !== '');
  for (const value of values) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error(`${name} contains an invalid origin: ${value}`);
    }
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.origin !== value
    ) {
      throw new Error(
        `${name} entries must be exact origins like https://admin.example.com (no path or trailing slash): ${value}`,
      );
    }
  }
  return [...new Set(values)];
}

/** Validates process environment at boot; used by ConfigModule.forRoot. */
export function validateEnv(raw: Record<string, unknown>): Env {
  const databaseUrl = raw.DATABASE_URL;
  if (typeof databaseUrl !== 'string' || !databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }
  const jwtSecret = raw.PLATFORM_JWT_SECRET;
  if (
    typeof jwtSecret !== 'string' ||
    jwtSecret.length < MIN_JWT_SECRET_LENGTH
  ) {
    throw new Error(
      `PLATFORM_JWT_SECRET is required and must be at least ${MIN_JWT_SECRET_LENGTH} characters`,
    );
  }
  const tenantJwtSecret = raw.TENANT_JWT_SECRET;
  if (
    typeof tenantJwtSecret !== 'string' ||
    tenantJwtSecret.length < MIN_JWT_SECRET_LENGTH
  ) {
    throw new Error(
      `TENANT_JWT_SECRET is required and must be at least ${MIN_JWT_SECRET_LENGTH} characters`,
    );
  }
  if (tenantJwtSecret === jwtSecret) {
    throw new Error('TENANT_JWT_SECRET must differ from PLATFORM_JWT_SECRET');
  }
  return {
    DATABASE_URL: databaseUrl,
    PLATFORM_JWT_SECRET: jwtSecret,
    PLATFORM_ACCESS_TOKEN_TTL_SECONDS: positiveInt(
      raw.PLATFORM_ACCESS_TOKEN_TTL_SECONDS,
      'PLATFORM_ACCESS_TOKEN_TTL_SECONDS',
      900,
    ),
    PLATFORM_REFRESH_TOKEN_TTL_DAYS: positiveInt(
      raw.PLATFORM_REFRESH_TOKEN_TTL_DAYS,
      'PLATFORM_REFRESH_TOKEN_TTL_DAYS',
      7,
    ),
    TENANT_JWT_SECRET: tenantJwtSecret,
    TENANT_ACCESS_TOKEN_TTL_SECONDS: positiveInt(
      raw.TENANT_ACCESS_TOKEN_TTL_SECONDS,
      'TENANT_ACCESS_TOKEN_TTL_SECONDS',
      900,
    ),
    TENANT_REFRESH_TOKEN_TTL_DAYS: positiveInt(
      raw.TENANT_REFRESH_TOKEN_TTL_DAYS,
      'TENANT_REFRESH_TOKEN_TTL_DAYS',
      7,
    ),
    AUTH_RATE_LIMIT: positiveInt(raw.AUTH_RATE_LIMIT, 'AUTH_RATE_LIMIT', 5),
    AUTH_RATE_WINDOW_SECONDS: positiveInt(
      raw.AUTH_RATE_WINDOW_SECONDS,
      'AUTH_RATE_WINDOW_SECONDS',
      60,
    ),
    JOBS_ENABLED: bool(raw.JOBS_ENABLED, 'JOBS_ENABLED', true),
    CORS_ORIGINS: origins(raw.CORS_ORIGINS, 'CORS_ORIGINS'),
  };
}
