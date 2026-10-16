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
  CurrentPlatformAdmin,
  PlatformAuth,
  RequirePlatformPermissions,
} from '../admin-auth/common/decorators.js';
import type { AuthenticatedPlatformAdmin } from '../admin-auth/interfaces/authenticated-platform-admin.js';
import { PlatformPermission } from '../permissions/platform-permission.js';
import {
  CloseTenantDto,
  CreateTenantDto,
  ListTenantsQuery,
  SubscriptionTermsDto,
  UpdateTenantDto,
} from './dto/tenant.dto.js';
import {
  type TenantDetailsResponse,
  toTenantDetailsResponse,
  toTenantListItemResponse,
} from './interfaces/tenant.response.js';
import { TenantsService } from './tenants.service.js';

@Controller('platform/tenants')
@PlatformAuth()
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Get()
  @RequirePlatformPermissions(PlatformPermission.TENANTS_READ)
  async list(@Query() query: ListTenantsQuery) {
    const { page, pageSize, ...filter } = query;
    const result = await this.tenants.list(filter, { page, pageSize });
    return {
      items: result.items.map(toTenantListItemResponse),
      total: result.total,
      page,
      pageSize,
    };
  }

  @Get(':id')
  @RequirePlatformPermissions(PlatformPermission.TENANTS_READ)
  async get(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TenantDetailsResponse> {
    return toTenantDetailsResponse(await this.tenants.get(id));
  }

  @Post()
  @RequirePlatformPermissions(
    PlatformPermission.TENANTS_MANAGE,
    PlatformPermission.SUBSCRIPTIONS_MANAGE,
  )
  async create(
    @CurrentPlatformAdmin() actor: AuthenticatedPlatformAdmin,
    @Body() body: CreateTenantDto,
    @ReqMeta() meta: RequestMeta,
  ): Promise<TenantDetailsResponse> {
    return toTenantDetailsResponse(
      await this.tenants.createTenant(actor, body, meta),
    );
  }

  @Patch(':id')
  @RequirePlatformPermissions(PlatformPermission.TENANTS_MANAGE)
  async update(
    @CurrentPlatformAdmin() actor: AuthenticatedPlatformAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateTenantDto,
    @ReqMeta() meta: RequestMeta,
  ): Promise<TenantDetailsResponse> {
    return toTenantDetailsResponse(
      await this.tenants.updateProfile(actor, id, body, meta),
    );
  }

  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  @RequirePlatformPermissions(
    PlatformPermission.TENANTS_MANAGE,
    PlatformPermission.SUBSCRIPTIONS_MANAGE,
  )
  async close(
    @CurrentPlatformAdmin() actor: AuthenticatedPlatformAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CloseTenantDto,
    @ReqMeta() meta: RequestMeta,
  ): Promise<TenantDetailsResponse> {
    return toTenantDetailsResponse(
      await this.tenants.close(actor, id, body.reason, meta),
    );
  }

  @Post(':id/reopen')
  @HttpCode(HttpStatus.OK)
  @RequirePlatformPermissions(
    PlatformPermission.TENANTS_MANAGE,
    PlatformPermission.SUBSCRIPTIONS_MANAGE,
  )
  async reopen(
    @CurrentPlatformAdmin() actor: AuthenticatedPlatformAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SubscriptionTermsDto,
    @ReqMeta() meta: RequestMeta,
  ): Promise<TenantDetailsResponse> {
    return toTenantDetailsResponse(
      await this.tenants.reopen(actor, id, body, meta),
    );
  }
}
