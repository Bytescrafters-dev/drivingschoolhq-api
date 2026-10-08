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
import type { AuthenticatedPlatformAdmin } from '../admin-auth/interfaces/authenticated-platform-admin.js';
import {
  CurrentPlatformAdmin,
  PlatformAuth,
  RequirePlatformPermissions,
} from '../admin-auth/common/decorators.js';
import { PlatformPermission } from '../permissions/platform-permission.js';
import {
  ChangePlatformAdminRoleDto,
  CreatePlatformAdminDto,
  ListPlatformAdminsQuery,
  ResetPlatformAdminPasswordDto,
  UpdatePlatformAdminDto,
} from './dto/platform-admin.dto.js';
import {
  type PlatformAdminResponse,
  toPlatformAdminResponse,
} from './interfaces/platform-admin.response.js';
import { PlatformAdminsService } from './platform-admins.service.js';

@Controller('platform/admins')
@PlatformAuth()
export class PlatformAdminsController {
  constructor(private readonly admins: PlatformAdminsService) {}

  @Get()
  @RequirePlatformPermissions(PlatformPermission.PLATFORM_ADMINS_READ)
  async list(@Query() query: ListPlatformAdminsQuery) {
    const { page, pageSize, ...filter } = query;
    const result = await this.admins.list(filter, { page, pageSize });
    return {
      items: result.items.map(toPlatformAdminResponse),
      total: result.total,
      page,
      pageSize,
    };
  }

  @Get(':id')
  @RequirePlatformPermissions(PlatformPermission.PLATFORM_ADMINS_READ)
  async get(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PlatformAdminResponse> {
    return toPlatformAdminResponse(await this.admins.get(id));
  }

  @Post()
  @RequirePlatformPermissions(PlatformPermission.PLATFORM_ADMINS_MANAGE)
  async create(
    @CurrentPlatformAdmin() actor: AuthenticatedPlatformAdmin,
    @Body() body: CreatePlatformAdminDto,
    @ReqMeta() meta: RequestMeta,
  ): Promise<PlatformAdminResponse> {
    return toPlatformAdminResponse(
      await this.admins.createAdmin(actor, body, meta),
    );
  }

  @Patch(':id')
  @RequirePlatformPermissions(PlatformPermission.PLATFORM_ADMINS_MANAGE)
  async update(
    @CurrentPlatformAdmin() actor: AuthenticatedPlatformAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdatePlatformAdminDto,
    @ReqMeta() meta: RequestMeta,
  ): Promise<PlatformAdminResponse> {
    return toPlatformAdminResponse(
      await this.admins.updateFullName(actor, id, body.fullName, meta),
    );
  }

  @Patch(':id/role')
  @RequirePlatformPermissions(PlatformPermission.PLATFORM_ADMINS_MANAGE)
  async changeRole(
    @CurrentPlatformAdmin() actor: AuthenticatedPlatformAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ChangePlatformAdminRoleDto,
    @ReqMeta() meta: RequestMeta,
  ): Promise<PlatformAdminResponse> {
    return toPlatformAdminResponse(
      await this.admins.changeRole(actor, id, body.role, meta),
    );
  }

  @Post(':id/disable')
  @HttpCode(HttpStatus.OK)
  @RequirePlatformPermissions(PlatformPermission.PLATFORM_ADMINS_MANAGE)
  async disable(
    @CurrentPlatformAdmin() actor: AuthenticatedPlatformAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @ReqMeta() meta: RequestMeta,
  ): Promise<PlatformAdminResponse> {
    return toPlatformAdminResponse(await this.admins.disable(actor, id, meta));
  }

  @Post(':id/enable')
  @HttpCode(HttpStatus.OK)
  @RequirePlatformPermissions(PlatformPermission.PLATFORM_ADMINS_MANAGE)
  async enable(
    @CurrentPlatformAdmin() actor: AuthenticatedPlatformAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @ReqMeta() meta: RequestMeta,
  ): Promise<PlatformAdminResponse> {
    return toPlatformAdminResponse(await this.admins.enable(actor, id, meta));
  }

  @Post(':id/reset-password')
  @HttpCode(HttpStatus.OK)
  @RequirePlatformPermissions(PlatformPermission.PLATFORM_ADMINS_MANAGE)
  async resetPassword(
    @CurrentPlatformAdmin() actor: AuthenticatedPlatformAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ResetPlatformAdminPasswordDto,
    @ReqMeta() meta: RequestMeta,
  ): Promise<PlatformAdminResponse> {
    return toPlatformAdminResponse(
      await this.admins.resetPassword(actor, id, body.temporaryPassword, meta),
    );
  }
}
