import type {
  BranchStatus,
  District,
  TenantUserBranchAccess,
} from '../../../generated/prisma/enums.js';

export const BRANCH_REPOSITORY = Symbol('BRANCH_REPOSITORY');

export interface Branch {
  id: string;
  tenantId: string;
  name: string;
  address: string;
  district: District;
  phone: string;
  status: BranchStatus;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface BranchDetails {
  name: string;
  address: string;
  district: District;
  phone: string;
}

export type NewBranch = BranchDetails & {
  tenantId: string;
} & (
    | { createdByPlatformAdminId: string; createdByTenantUserId?: never }
    | { createdByTenantUserId: string; createdByPlatformAdminId?: never }
  );

export type BranchDetailsChange = Partial<BranchDetails>;

/** Who is asking: decides which branches are visible/accessible. */
export interface BranchViewer {
  tenantId: string;
  userId: string;
  branchAccess: TenantUserBranchAccess;
}

/** An active staff member whose only ACTIVE branch is a given branch. */
export interface ExclusiveBranchUser {
  id: string;
  fullName: string;
  email: string;
}

/**
 * Every operation is scoped to a tenant. Lists are ordered by creation
 * (oldest first) so the Main Branch comes first.
 */
export interface BranchRepository {
  /** Throws AppError BRANCH_NAME_TAKEN for a duplicate name (any case). */
  create(branch: NewBranch): Promise<Branch>;
  listForTenant(
    tenantId: string,
    options: { includeClosed: boolean },
  ): Promise<Branch[]>;
  /** Branches the viewer may see: all of the tenant's (ALL) or assigned ones. */
  listAccessible(
    viewer: BranchViewer,
    options: { includeClosed: boolean },
  ): Promise<Branch[]>;
  /** The branch if the viewer may see it (any status), else null. */
  findAccessible(
    viewer: BranchViewer,
    branchId: string,
  ): Promise<Branch | null>;
  /** Locks the branch row (FOR UPDATE) if the viewer may see it. */
  lockAccessible(
    viewer: BranchViewer,
    branchId: string,
  ): Promise<Branch | null>;
  countActive(tenantId: string): Promise<number>;
  /** Whether the viewer can work in at least one ACTIVE branch. */
  hasActiveAccessible(viewer: BranchViewer): Promise<boolean>;
  /** Throws AppError BRANCH_NAME_TAKEN for a duplicate name (any case). */
  updateDetails(
    tenantId: string,
    branchId: string,
    change: BranchDetailsChange,
  ): Promise<Branch>;
  setStatus(
    tenantId: string,
    branchId: string,
    status: BranchStatus,
    closedAt: Date | null,
  ): Promise<Branch>;
  /** Adds a SELECTED user's assignment; no-op if it already exists. */
  assignUser(tenantId: string, userId: string, branchId: string): Promise<void>;
  /** ACTIVE SELECTED users whose only ACTIVE assigned branch is this one. */
  findExclusiveUsers(
    tenantId: string,
    branchId: string,
  ): Promise<ExclusiveBranchUser[]>;
  /**
   * Moves the default branch of users defaulting to `fromBranchId` to their
   * oldest other accessible ACTIVE branch (users with none keep it).
   * Returns how many users were moved.
   */
  reassignDefaults(tenantId: string, fromBranchId: string): Promise<number>;
  setUserDefault(
    tenantId: string,
    userId: string,
    branchId: string,
  ): Promise<void>;
}
