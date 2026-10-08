import type {
  PlatformAdminStatus,
  PlatformRole,
} from '../../../generated/prisma/enums.js';

export const PLATFORM_ADMIN_USER_REPOSITORY = Symbol(
  'PLATFORM_ADMIN_USER_REPOSITORY',
);

export interface PlatformAdmin {
  id: string;
  email: string;
  fullName: string;
  role: PlatformRole;
  status: PlatformAdminStatus;
  mustChangePassword: boolean;
  passwordChangedAt: Date | null;
  lastLoginAt: Date | null;
  disabledAt: Date | null;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PlatformAdminCredentials {
  admin: PlatformAdmin;
  passwordHash: string;
}

export interface NewPlatformAdmin {
  email: string;
  fullName: string;
  role: PlatformRole;
  passwordHash: string;
  createdById: string;
}

export interface PlatformAdminListFilter {
  role?: PlatformRole;
  status?: PlatformAdminStatus;
  /** Case-insensitive match on email or full name. */
  search?: string;
}

export interface PlatformAdminUserRepository {
  findById(id: string): Promise<PlatformAdmin | null>;
  findCredentialsByEmail(
    email: string,
  ): Promise<PlatformAdminCredentials | null>;
  findCredentialsById(id: string): Promise<PlatformAdminCredentials | null>;
  list(
    filter: PlatformAdminListFilter,
    page: { skip: number; take: number },
  ): Promise<{ items: PlatformAdmin[]; total: number }>;
  /** Throws AppError PLATFORM_ADMIN_EMAIL_TAKEN when the email is already used. */
  create(admin: NewPlatformAdmin): Promise<PlatformAdmin>;
  updateFullName(id: string, fullName: string): Promise<PlatformAdmin>;
  changeRole(id: string, role: PlatformRole): Promise<PlatformAdmin>;
  disable(id: string, at: Date): Promise<PlatformAdmin>;
  enable(id: string): Promise<PlatformAdmin>;
  setPassword(
    id: string,
    change: {
      passwordHash: string;
      mustChangePassword: boolean;
      passwordChangedAt?: Date;
    },
  ): Promise<PlatformAdmin>;
  recordLogin(id: string, at: Date): Promise<void>;
  /**
   * Locks all ACTIVE SUPER_ADMIN rows (SELECT ... FOR UPDATE) and returns their
   * ids. Must be called inside a transaction; serializes "last super admin" checks.
   */
  lockActiveSuperAdminIds(): Promise<string[]>;
}
