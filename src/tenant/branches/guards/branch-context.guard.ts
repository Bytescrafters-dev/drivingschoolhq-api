import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error.js';
import { BranchAccessService } from '../branch-access.service.js';
import type { BranchScopedRequest } from '../interfaces/working-branch.js';

export const BRANCH_HEADER = 'x-branch-id';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolves the working branch from the X-Branch-Id header. Runs after
 * TenantAuthGuard. Unknown, foreign, closed and inaccessible branches get the
 * same answer so branch ids cannot be probed.
 */
@Injectable()
export class BranchContextGuard implements CanActivate {
  constructor(private readonly access: BranchAccessService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<BranchScopedRequest>();
    const user = request.tenantUser;
    if (!user) {
      throw new AppError(
        'UNAUTHORIZED',
        'AUTHENTICATION_REQUIRED',
        'Authentication required',
      );
    }
    const header = request.headers[BRANCH_HEADER];
    const branchId = Array.isArray(header) ? undefined : header?.trim();
    if (!branchId) {
      throw new AppError(
        'BAD_REQUEST',
        'BRANCH_REQUIRED',
        'Select a branch (X-Branch-Id header)',
      );
    }
    const branch = UUID_PATTERN.test(branchId)
      ? await this.access.findWorkable(user, branchId)
      : null;
    if (!branch) {
      throw new AppError(
        'FORBIDDEN',
        'BRANCH_ACCESS_DENIED',
        'You cannot work in this branch',
      );
    }
    request.branch = {
      id: branch.id,
      tenantId: branch.tenantId,
      name: branch.name,
    };
    return true;
  }
}
