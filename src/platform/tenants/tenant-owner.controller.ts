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
} from '@nestjs/common';
import { ReqMeta, type RequestMeta } from '../../common/http/request-meta.js';
import {
  CurrentPlatformAdmin,
  PlatformAuth,
  RequirePlatformPermissions,
} from '../admin-auth/common/decorators.js';
import type { AuthenticatedPlatformAdmin } from '../admin-auth/interfaces/authenticated-platform-admin.js';
import { PlatformPermission } from '../permissions/platform-permission.js';
import {
  ResetTenantOwnerPasswordDto,
  UpdateTenantOwnerDto,
} from './dto/tenant-owner.dto.js';
import {
  type TenantOwnerResponse,
  toOwnerResponse,
} from './interfaces/tenant.response.js';
import { TenantOwnerAdminService } from './tenant-owner-admin.service.js';

@Controller('platform/tenants/:tenantId/owner')
@PlatformAuth()
export class TenantOwnerController {
  constructor(private readonly owners: TenantOwnerAdminService) {}

  @Get()
  @RequirePlatformPermissions(PlatformPermission.TENANTS_READ)
  async get(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
  ): Promise<TenantOwnerResponse> {
    return toOwnerResponse(await this.owners.get(tenantId));
  }

  @Patch()
  @RequirePlatformPermissions(PlatformPermission.TENANTS_MANAGE)
  async update(
    @CurrentPlatformAdmin() actor: AuthenticatedPlatformAdmin,
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() body: UpdateTenantOwnerDto,
    @ReqMeta() meta: RequestMeta,
  ): Promise<TenantOwnerResponse> {
    return toOwnerResponse(
      await this.owners.updateProfile(actor, tenantId, body, meta),
    );
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @RequirePlatformPermissions(PlatformPermission.TENANTS_MANAGE)
  async resetPassword(
    @CurrentPlatformAdmin() actor: AuthenticatedPlatformAdmin,
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() body: ResetTenantOwnerPasswordDto,
    @ReqMeta() meta: RequestMeta,
  ): Promise<TenantOwnerResponse> {
    return toOwnerResponse(
      await this.owners.resetPassword(
        actor,
        tenantId,
        body.temporaryPassword,
        meta,
      ),
    );
  }

  @Post('disable')
  @HttpCode(HttpStatus.OK)
  @RequirePlatformPermissions(PlatformPermission.TENANTS_MANAGE)
  async disable(
    @CurrentPlatformAdmin() actor: AuthenticatedPlatformAdmin,
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @ReqMeta() meta: RequestMeta,
  ): Promise<TenantOwnerResponse> {
    return toOwnerResponse(await this.owners.disable(actor, tenantId, meta));
  }

  @Post('enable')
  @HttpCode(HttpStatus.OK)
  @RequirePlatformPermissions(PlatformPermission.TENANTS_MANAGE)
  async enable(
    @CurrentPlatformAdmin() actor: AuthenticatedPlatformAdmin,
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @ReqMeta() meta: RequestMeta,
  ): Promise<TenantOwnerResponse> {
    return toOwnerResponse(await this.owners.enable(actor, tenantId, meta));
  }
}
