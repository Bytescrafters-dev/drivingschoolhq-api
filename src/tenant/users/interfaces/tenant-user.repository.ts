import type {
  TenantRole,
  TenantUserStatus,
} from '../../../generated/prisma/enums.js';

export const TENANT_USER_REPOSITORY = Symbol('TENANT_USER_REPOSITORY');

/** A tenant user without credential material. */
export interface TenantUser {
  id: string;
  tenantId: string;
  email: string;
  fullName: string;
  phone: string | null;
  nic: string | null;
  role: TenantRole;
  status: TenantUserStatus;
  mustChangePassword: boolean;
  passwordChangedAt: Date | null;
  lastLoginAt: Date | null;
  disabledAt: Date | null;
  createdByPlatformAdminId: string | null;
  createdByTenantUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TenantUserCredentials {
  user: TenantUser;
  passwordHash: string;
}

export interface NewTenantOwner {
  tenantId: string;
  email: string;
  fullName: string;
  phone: string;
  nic: string;
  passwordHash: string;
  createdByPlatformAdminId: string;
}

export interface TenantOwnerProfileChange {
  email?: string;
  fullName?: string;
  phone?: string;
  nic?: string;
}

/**
 * Every operation is scoped to a tenant. Owner operations additionally only
 * ever match the row with role OWNER.
 */
export interface TenantUserRepository {
  /** Throws AppError TENANT_OWNER_EXISTS if the tenant already has an owner. */
  createOwner(owner: NewTenantOwner): Promise<TenantUser>;
  findOwner(tenantId: string): Promise<TenantUser | null>;
  /** Locks the tenant's OWNER row (FOR UPDATE) and returns it. */
  lockOwner(tenantId: string): Promise<TenantUser | null>;
  /**
   * Throws AppError TENANT_USER_EMAIL_TAKEN / TENANT_USER_NIC_TAKEN when
   * another user of the tenant already uses the email / NIC.
   */
  updateOwnerProfile(
    tenantId: string,
    change: TenantOwnerProfileChange,
  ): Promise<TenantUser>;
  setOwnerPassword(tenantId: string, passwordHash: string): Promise<TenantUser>;
  disableOwner(tenantId: string, at: Date): Promise<TenantUser>;
  enableOwner(tenantId: string): Promise<TenantUser>;

  // --- authentication (any role, always tenant-scoped) ---
  findCredentialsByEmail(
    tenantId: string,
    email: string,
  ): Promise<TenantUserCredentials | null>;
  findCredentialsById(
    tenantId: string,
    id: string,
  ): Promise<TenantUserCredentials | null>;
  recordLogin(tenantId: string, id: string, at: Date): Promise<void>;
  /** The user's own password change: clears mustChangePassword. */
  setOwnPassword(
    tenantId: string,
    id: string,
    passwordHash: string,
    at: Date,
  ): Promise<void>;
}
