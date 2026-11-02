import type {
  BranchStatus,
  TenantRole,
  TenantUserBranchAccess,
  TenantUserStatus,
} from '../../../generated/prisma/enums.js';
import type { TenantUser } from '../../users/interfaces/tenant-user.repository.js';

export const STAFF_REPOSITORY = Symbol('STAFF_REPOSITORY');

export interface StaffBranch {
  id: string;
  name: string;
  status: BranchStatus;
}

/** A tenant user with their branch assignments (empty for ALL access). */
export interface StaffMember extends TenantUser {
  /** Assigned branches of a SELECTED user (any status), oldest first. */
  branches: StaffBranch[];
}

/**
 * Who is looking. ALL viewers see every user of the tenant; SELECTED viewers
 * see users with ALL access and users sharing at least one of their branches.
 */
export interface StaffViewer {
  tenantId: string;
  branchAccess: TenantUserBranchAccess;
  /** The viewer's assigned branches (any status); ignored for ALL. */
  branchIds: readonly string[];
}

export interface StaffListFilter {
  status?: TenantUserStatus;
  role?: TenantRole;
  /** Users who can work in this branch: ALL access or assigned to it. */
  branchId?: string;
  /** Case-insensitive match on name or email. */
  search?: string;
}

export interface StaffAccess {
  branchAccess: TenantUserBranchAccess;
  /** Branches to assign (SELECTED); must be empty for ALL. */
  branchIds: readonly string[];
  defaultBranchId: string;
}

export interface NewStaffMember extends StaffAccess {
  tenantId: string;
  email: string;
  fullName: string;
  phone: string | null;
  nic: string | null;
  role: TenantRole;
  passwordHash: string;
  createdByTenantUserId: string;
}

export interface StaffProfileChange {
  email?: string;
  fullName?: string;
  phone?: string | null;
  nic?: string | null;
}

/**
 * Staff management persistence. Everything is tenant-scoped, and writes never
 * touch the OWNER row (owners are managed by the platform).
 */
export interface StaffRepository {
  listVisible(
    viewer: StaffViewer,
    filter: StaffListFilter,
    page: { page: number; pageSize: number },
  ): Promise<{ items: StaffMember[]; total: number }>;
  /** Every user of the tenant (platform view), owner first. */
  listForTenant(tenantId: string): Promise<StaffMember[]>;
  findVisible(viewer: StaffViewer, id: string): Promise<StaffMember | null>;
  /** Locks the user row (FOR UPDATE) and returns it if visible. */
  lockVisible(viewer: StaffViewer, id: string): Promise<StaffMember | null>;
  /** ACTIVE users including the owner (the MAX_STAFF_USERS seat count). */
  countActive(tenantId: string): Promise<number>;
  /** Throws TENANT_USER_EMAIL_TAKEN / TENANT_USER_NIC_TAKEN on duplicates. */
  create(member: NewStaffMember): Promise<StaffMember>;
  /** Throws TENANT_USER_EMAIL_TAKEN / TENANT_USER_NIC_TAKEN on duplicates. */
  updateProfile(
    tenantId: string,
    id: string,
    change: StaffProfileChange,
  ): Promise<StaffMember>;
  setRole(tenantId: string, id: string, role: TenantRole): Promise<StaffMember>;
  /**
   * ALL drops every assignment. SELECTED replaces the assignments to ACTIVE
   * branches with `branchIds` and keeps assignments to CLOSED branches, so a
   * reopened branch gives its staff their access back.
   */
  replaceAccess(
    tenantId: string,
    id: string,
    access: StaffAccess,
  ): Promise<StaffMember>;
  /** Sets a temporary password (mustChangePassword = true). */
  setPassword(
    tenantId: string,
    id: string,
    passwordHash: string,
  ): Promise<StaffMember>;
  setStatus(
    tenantId: string,
    id: string,
    status: TenantUserStatus,
    disabledAt: Date | null,
  ): Promise<StaffMember>;
}
