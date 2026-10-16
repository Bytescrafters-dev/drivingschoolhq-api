export const TenantAuditAction = {
  LOGIN_SUCCEEDED: 'LOGIN_SUCCEEDED',
  LOGIN_FAILED: 'LOGIN_FAILED',
  LOGOUT: 'LOGOUT',
  PASSWORD_CHANGED: 'PASSWORD_CHANGED',
  REFRESH_TOKEN_REUSE_DETECTED: 'REFRESH_TOKEN_REUSE_DETECTED',
} as const;

export type TenantAuditAction =
  (typeof TenantAuditAction)[keyof typeof TenantAuditAction];

export const TenantAuditTarget = {
  TENANT_USER: 'TENANT_USER',
} as const;

export type TenantAuditTarget =
  (typeof TenantAuditTarget)[keyof typeof TenantAuditTarget];
