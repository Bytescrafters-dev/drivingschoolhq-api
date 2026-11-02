import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ReqMeta, type RequestMeta } from '../../common/http/request-meta.js';
import {
  CurrentTenantUser,
  RequireTenantPermissions,
  TenantAuth,
} from '../auth/common/decorators.js';
import type { AuthenticatedTenantUser } from '../auth/interfaces/authenticated-tenant-user.js';
import { TenantPermission } from '../permissions/tenant-permission.js';
import { BranchesService } from './branches.service.js';
import { BranchScoped, CurrentBranch } from './common/decorators.js';
import {
  CreateBranchDto,
  ListBranchesQuery,
  SetDefaultBranchDto,
  UpdateBranchDto,
} from './dto/branch.dto.js';
import {
  type BranchResponse,
  toBranchResponse,
} from './interfaces/branch.response.js';
import type { WorkingBranch } from './interfaces/working-branch.js';

@Controller('tenant/branches')
@TenantAuth()
export class BranchesController {
  constructor(private readonly branches: BranchesService) {}

  /** Branches the current user can access (ACTIVE only unless includeClosed). */
  @Get()
  async list(
    @CurrentTenantUser() actor: AuthenticatedTenantUser,
    @Query() query: ListBranchesQuery,
  ) {
    const items = await this.branches.list(actor, query.includeClosed);
    return {
      items: items.map(({ branch, isDefault }) => ({
        ...toBranchResponse(branch),
        isDefault,
      })),
    };
  }

  @Get(':id')
  async get(
    @CurrentTenantUser() actor: AuthenticatedTenantUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<BranchResponse> {
    return toBranchResponse(await this.branches.get(actor, id));
  }

  @Post()
  @RequireTenantPermissions(TenantPermission.BRANCHES_MANAGE)
  async create(
    @CurrentTenantUser() actor: AuthenticatedTenantUser,
    @Body() body: CreateBranchDto,
    @ReqMeta() meta: RequestMeta,
  ): Promise<BranchResponse> {
    return toBranchResponse(await this.branches.create(actor, body, meta));
  }

  @Patch(':id')
  @RequireTenantPermissions(TenantPermission.BRANCHES_MANAGE)
  async update(
    @CurrentTenantUser() actor: AuthenticatedTenantUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateBranchDto,
    @ReqMeta() meta: RequestMeta,
  ): Promise<BranchResponse> {
    return toBranchResponse(await this.branches.update(actor, id, body, meta));
  }

  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  @RequireTenantPermissions(TenantPermission.BRANCHES_MANAGE)
  async close(
    @CurrentTenantUser() actor: AuthenticatedTenantUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ReqMeta() meta: RequestMeta,
  ) {
    const { branch, lockedOutStaff } = await this.branches.close(
      actor,
      id,
      meta,
    );
    return {
      ...toBranchResponse(branch),
      /** Staff signed out because this was their only active branch. */
      lockedOutStaff,
    };
  }

  @Post(':id/reopen')
  @HttpCode(HttpStatus.OK)
  @RequireTenantPermissions(TenantPermission.BRANCHES_MANAGE)
  async reopen(
    @CurrentTenantUser() actor: AuthenticatedTenantUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ReqMeta() meta: RequestMeta,
  ): Promise<BranchResponse> {
    return toBranchResponse(await this.branches.reopen(actor, id, meta));
  }
}

@Controller('tenant/me')
@TenantAuth()
export class MyDefaultBranchController {
  constructor(private readonly branches: BranchesService) {}

  @Patch('default-branch')
  async setDefault(
    @CurrentTenantUser() actor: AuthenticatedTenantUser,
    @Body() body: SetDefaultBranchDto,
    @ReqMeta() meta: RequestMeta,
  ): Promise<BranchResponse> {
    return toBranchResponse(
      await this.branches.setMyDefault(actor, body.branchId, meta),
    );
  }
}

/** Lets the client check a stored branch selection (X-Branch-Id). */
@Controller('tenant/branch-context')
@TenantAuth()
export class BranchContextController {
  @Get()
  @BranchScoped()
  current(@CurrentBranch() branch: WorkingBranch) {
    return { branch: { id: branch.id, name: branch.name } };
  }
}
