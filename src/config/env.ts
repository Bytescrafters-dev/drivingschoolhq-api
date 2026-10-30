import { isIP } from 'node:net';

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
  /**
   * Which reverse proxies (e.g. the Next.js BFFs) are trusted to report the
   * client IP via X-Forwarded-For: false (default), a hop count, or a list of
   * proxy addresses/subnets. Rate limiting and audit IPs depend on it.
   */
  TRUST_PROXY: TrustProxy;
}

export type TrustProxy = false | number | string[];

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

const NAMED_SUBNETS = new Set(['loopback', 'linklocal', 'uniquelocal']);

function isAddressOrSubnet(value: string): boolean {
  if (NAMED_SUBNETS.has(value)) return true;
  const [address, prefix, extra] = value.split('/');
  if (extra !== undefined || !address) return false;
  const version = isIP(address);
  if (version === 0) return false;
  if (prefix === undefined) return true;
  if (!/^[0-9]{1,3}$/.test(prefix)) return false;
  return Number(prefix) <= (version === 4 ? 32 : 128);
}

/**
 * "false"/empty: trust no proxy (request.ip is the socket address).
 * "1", "2": trust that many proxy hops in front of the API.
 * "10.0.0.5,10.1.0.0/16,loopback": trust only these proxy addresses.
 * "true" (trust everyone) is rejected: any client could then spoof its IP
 * and escape rate limiting.
 */
function trustProxy(raw: unknown, name: string): TrustProxy {
  if (raw === undefined || raw === '' || raw === 'false') return false;
  if (typeof raw !== 'string') throw new Error(`${name} must be a string`);
  const value = raw.trim();
  if (/^[0-9]+$/.test(value)) {
    const hops = Number(value);
    if (hops > 0) return hops;
    return false;
  }
  if (value === 'true') {
    throw new Error(
      `${name}=true would trust any client's X-Forwarded-For; use a hop count or proxy addresses`,
    );
  }
  const entries = value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
  for (const entry of entries) {
    if (!isAddressOrSubnet(entry)) {
      throw new Error(
        `${name} must be false, a hop count, or a comma-separated list of IP addresses/subnets: ${entry}`,
      );
    }
  }
  return entries.length > 0 ? [...new Set(entries)] : false;
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
    TRUST_PROXY: trustProxy(raw.TRUST_PROXY, 'TRUST_PROXY'),
  };
}
