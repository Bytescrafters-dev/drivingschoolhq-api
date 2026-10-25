import {
  applyDecorators,
  createParamDecorator,
  ExecutionContext,
  UseGuards,
} from '@nestjs/common';
import { BranchContextGuard } from '../guards/branch-context.guard.js';
import type {
  BranchScopedRequest,
  WorkingBranch,
} from '../interfaces/working-branch.js';

/**
 * Requires a verified working branch (X-Branch-Id). Use on handlers of a
 * controller (or after) @TenantAuth(), so authentication runs first.
 */
export const BranchScoped = () =>
  applyDecorators(UseGuards(BranchContextGuard));

export const CurrentBranch = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): WorkingBranch => {
    const request = ctx.switchToHttp().getRequest<BranchScopedRequest>();
    if (!request.branch) {
      throw new Error('CurrentBranch used on a route without BranchScoped()');
    }
    return request.branch;
  },
);
