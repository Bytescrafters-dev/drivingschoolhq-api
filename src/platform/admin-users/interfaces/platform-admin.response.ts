import type {
  PlatformAdminStatus,
  PlatformRole,
} from '../../../generated/prisma/enums.js';
import type { PlatformAdmin } from './platform-admin-user.repository.js';

export interface PlatformAdminResponse {
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

/** Explicit allow-list so credential fields can never leak into responses. */
export function toPlatformAdminResponse(
  admin: PlatformAdmin,
): PlatformAdminResponse {
  return {
    id: admin.id,
    email: admin.email,
    fullName: admin.fullName,
    role: admin.role,
    status: admin.status,
    mustChangePassword: admin.mustChangePassword,
    passwordChangedAt: admin.passwordChangedAt,
    lastLoginAt: admin.lastLoginAt,
    disabledAt: admin.disabledAt,
    createdById: admin.createdById,
    createdAt: admin.createdAt,
    updatedAt: admin.updatedAt,
  };
}
