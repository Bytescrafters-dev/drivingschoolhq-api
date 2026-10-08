export const PlatformAuditAction = {
  LOGIN_SUCCEEDED: 'LOGIN_SUCCEEDED',
  LOGIN_FAILED: 'LOGIN_FAILED',
  LOGOUT: 'LOGOUT',
  PASSWORD_CHANGED: 'PASSWORD_CHANGED',
  REFRESH_TOKEN_REUSE_DETECTED: 'REFRESH_TOKEN_REUSE_DETECTED',
  ADMIN_CREATED: 'ADMIN_CREATED',
  ADMIN_UPDATED: 'ADMIN_UPDATED',
  ADMIN_ROLE_CHANGED: 'ADMIN_ROLE_CHANGED',
  ADMIN_DISABLED: 'ADMIN_DISABLED',
  ADMIN_ENABLED: 'ADMIN_ENABLED',
  ADMIN_PASSWORD_RESET: 'ADMIN_PASSWORD_RESET',
} as const;

export type PlatformAuditAction =
  (typeof PlatformAuditAction)[keyof typeof PlatformAuditAction];

export const PlatformAuditTarget = {
  PLATFORM_ADMIN: 'PLATFORM_ADMIN',
} as const;

export type PlatformAuditTarget =
  (typeof PlatformAuditTarget)[keyof typeof PlatformAuditTarget];
