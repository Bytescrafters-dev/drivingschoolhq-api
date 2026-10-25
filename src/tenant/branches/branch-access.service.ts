import { Inject, Injectable } from '@nestjs/common';
import { BranchStatus } from '../../generated/prisma/enums.js';
import type { AuthenticatedTenantUser } from '../auth/interfaces/authenticated-tenant-user.js';
import {
  BRANCH_REPOSITORY,
  type Branch,
  type BranchRepository,
  type BranchViewer,
} from './interfaces/branch.repository.js';

export interface MyBranches {
  /** ACTIVE branches the user may work in, oldest first. */
  branches: Branch[];
  /**
   * The stored default if it is still workable, otherwise the first workable
   * branch; null when the user cannot work in any branch.
   */
  defaultBranchId: string | null;
}

export function viewerOf(
  user: Pick<AuthenticatedTenantUser, 'id' | 'tenantId' | 'branchAccess'>,
): BranchViewer {
  return {
    tenantId: user.tenantId,
    userId: user.id,
    branchAccess: user.branchAccess,
  };
}

/**
 * The single answer to "may this user work in this branch?": the branch
 * belongs to the user's tenant, is ACTIVE, and the user has ALL access or is
 * assigned to it.
 */
@Injectable()
export class BranchAccessService {
  constructor(
    @Inject(BRANCH_REPOSITORY) private readonly branches: BranchRepository,
  ) {}

  /** The branch if the user may work in it right now, else null. */
  async findWorkable(
    user: AuthenticatedTenantUser,
    branchId: string,
  ): Promise<Branch | null> {
    const branch = await this.branches.findAccessible(viewerOf(user), branchId);
    return branch?.status === BranchStatus.ACTIVE ? branch : null;
  }

  async myBranches(user: AuthenticatedTenantUser): Promise<MyBranches> {
    const branches = await this.branches.listAccessible(viewerOf(user), {
      includeClosed: false,
    });
    const stored = branches.find((b) => b.id === user.defaultBranchId);
    return {
      branches,
      defaultBranchId: stored?.id ?? branches[0]?.id ?? null,
    };
  }
}
