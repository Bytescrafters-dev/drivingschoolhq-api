import type {
  BranchStatus,
  TenantRole,
  TenantUserBranchAccess,
  TenantUserStatus,
} from '../../../generated/prisma/enums.js';
import { hasActiveBranch } from '../staff.service.js';
import type { StaffMember } from './staff.repository.js';

export interface StaffResponse {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  nic: string | null;
  role: TenantRole;
  status: TenantUserStatus;
  mustChangePassword: boolean;
  lastLoginAt: Date | null;
  disabledAt: Date | null;
  branchAccess: TenantUserBranchAccess;
  /** Assigned branches (SELECTED; any status). Empty for ALL. */
  branches: { id: string; name: string; status: BranchStatus }[];
  defaultBranchId: string;
  /** False when none of a SELECTED user's branches is open: they cannot sign in. */
  hasActiveBranch: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export function toStaffResponse(member: StaffMember): StaffResponse {
  return {
    id: member.id,
    email: member.email,
    fullName: member.fullName,
    phone: member.phone,
    nic: member.nic,
    role: member.role,
    status: member.status,
    mustChangePassword: member.mustChangePassword,
    lastLoginAt: member.lastLoginAt,
    disabledAt: member.disabledAt,
    branchAccess: member.branchAccess,
    branches: member.branches.map(({ id, name, status }) => ({
      id,
      name,
      status,
    })),
    defaultBranchId: member.defaultBranchId,
    hasActiveBranch: hasActiveBranch(member),
    createdAt: member.createdAt,
    updatedAt: member.updatedAt,
  };
}
