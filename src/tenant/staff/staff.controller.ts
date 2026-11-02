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
  Put,
  Query,
} from '@nestjs/common';
import { ReqMeta, type RequestMeta } from '../../common/http/request-meta.js';
import {
  CurrentTenantUser,
  RequireTenantPermissions,
  TenantAuth,
} from '../auth/common/decorators.js';
import type { AuthenticatedTenantUser } from '../auth/interfaces/authenticated-tenant-user.js';
import { toBranchResponse } from '../branches/interfaces/branch.response.js';
import { TenantPermission } from '../permissions/tenant-permission.js';
import {
  ChangeStaffRoleDto,
  CreateStaffDto,
  ListStaffQuery,
  ResetStaffPasswordDto,
  StaffAccessDto,
  UpdateStaffDto,
} from './dto/staff.dto.js';
import { toStaffResponse } from './interfaces/staff.response.js';
import { StaffService, type StaffView } from './staff.service.js';

const toResponse = ({ member, canManage }: StaffView) => ({
  ...toStaffResponse(member),
  canManage,
});

/** Staff management. Not branch-scoped: staff belong to the whole school. */
@Controller('tenant/staff')
@TenantAuth()
@RequireTenantPermissions(TenantPermission.STAFF_MANAGE)
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  /** What this user may grant: roles, ALL access, branches. */
  @Get('options')
  async options(@CurrentTenantUser() actor: AuthenticatedTenantUser) {
    const options = await this.staff.options(actor);
    return {
      roles: options.roles,
      canGrantAll: options.canGrantAll,
      branches: options.branches.map(toBranchResponse),
    };
  }

  @Get()
  async list(
    @CurrentTenantUser() actor: AuthenticatedTenantUser,
    @Query() query: ListStaffQuery,
  ) {
    const { page, pageSize, ...filter } = query;
    const { items, total } = await this.staff.list(actor, filter, {
      page,
      pageSize,
    });
    return { items: items.map(toResponse), total, page, pageSize };
  }

  @Get(':id')
  async get(
    @CurrentTenantUser() actor: AuthenticatedTenantUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return toResponse(await this.staff.get(actor, id));
  }

  @Post()
  async create(
    @CurrentTenantUser() actor: AuthenticatedTenantUser,
    @Body() body: CreateStaffDto,
    @ReqMeta() meta: RequestMeta,
  ) {
    return toResponse(await this.staff.create(actor, body, meta));
  }

  @Patch(':id')
  async update(
    @CurrentTenantUser() actor: AuthenticatedTenantUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateStaffDto,
    @ReqMeta() meta: RequestMeta,
  ) {
    return toResponse(await this.staff.updateProfile(actor, id, body, meta));
  }

  @Patch(':id/role')
  async changeRole(
    @CurrentTenantUser() actor: AuthenticatedTenantUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ChangeStaffRoleDto,
    @ReqMeta() meta: RequestMeta,
  ) {
    return toResponse(await this.staff.changeRole(actor, id, body.role, meta));
  }

  @Put(':id/branches')
  async setBranches(
    @CurrentTenantUser() actor: AuthenticatedTenantUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: StaffAccessDto,
    @ReqMeta() meta: RequestMeta,
  ) {
    return toResponse(await this.staff.setAccess(actor, id, body, meta));
  }

  @Post(':id/reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(
    @CurrentTenantUser() actor: AuthenticatedTenantUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ResetStaffPasswordDto,
    @ReqMeta() meta: RequestMeta,
  ) {
    return toResponse(
      await this.staff.resetPassword(actor, id, body.temporaryPassword, meta),
    );
  }

  @Post(':id/disable')
  @HttpCode(HttpStatus.OK)
  async disable(
    @CurrentTenantUser() actor: AuthenticatedTenantUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ReqMeta() meta: RequestMeta,
  ) {
    return toResponse(await this.staff.disable(actor, id, meta));
  }

  @Post(':id/enable')
  @HttpCode(HttpStatus.OK)
  async enable(
    @CurrentTenantUser() actor: AuthenticatedTenantUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ReqMeta() meta: RequestMeta,
  ) {
    return toResponse(await this.staff.enable(actor, id, meta));
  }
}
