import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ReqMeta, type RequestMeta } from '../../common/http/request-meta.js';
import { BillingPeriod } from '../../generated/prisma/enums.js';
import {
  CurrentPlatformAdmin,
  PlatformAuth,
  RequirePlatformPermissions,
} from '../admin-auth/common/decorators.js';
import type { AuthenticatedPlatformAdmin } from '../admin-auth/interfaces/authenticated-platform-admin.js';
import { PlatformPermission } from '../permissions/platform-permission.js';
import {
  CreatePlanDto,
  ListPlanPricesQuery,
  ListPlansQuery,
  SetPlanFeaturesDto,
  SetPlanLimitsDto,
  SetPlanPriceDto,
  UpdatePlanDto,
} from './dto/plan.dto.js';
import {
  type PlanDetailsResponse,
  toPlanDetailsResponse,
  toPlanPriceResponse,
  toPlanResponse,
} from './interfaces/plan.response.js';
import { PlansService } from './plans.service.js';

@Controller('platform/plans')
@PlatformAuth()
export class PlansController {
  constructor(private readonly plans: PlansService) {}

  @Get()
  @RequirePlatformPermissions(PlatformPermission.PLANS_READ)
  async list(@Query() query: ListPlansQuery) {
    const { page, pageSize, ...filter } = query;
    const result = await this.plans.list(filter, { page, pageSize });
    return {
      items: result.items.map(toPlanResponse),
      total: result.total,
      page,
      pageSize,
    };
  }

  @Get(':id')
  @RequirePlatformPermissions(PlatformPermission.PLANS_READ)
  async get(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PlanDetailsResponse> {
    return toPlanDetailsResponse(await this.plans.get(id));
  }

  @Get(':id/prices')
  @RequirePlatformPermissions(PlatformPermission.PLANS_READ)
  async listPrices(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListPlanPricesQuery,
  ) {
    const prices = await this.plans.listPrices(id, query.includeArchived);
    return { items: prices.map(toPlanPriceResponse) };
  }

  @Post()
  @RequirePlatformPermissions(PlatformPermission.PLANS_MANAGE)
  async create(
    @CurrentPlatformAdmin() actor: AuthenticatedPlatformAdmin,
    @Body() body: CreatePlanDto,
    @ReqMeta() meta: RequestMeta,
  ): Promise<PlanDetailsResponse> {
    return toPlanDetailsResponse(
      await this.plans.createPlan(actor, body, meta),
    );
  }

  @Patch(':id')
  @RequirePlatformPermissions(PlatformPermission.PLANS_MANAGE)
  async update(
    @CurrentPlatformAdmin() actor: AuthenticatedPlatformAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdatePlanDto,
    @ReqMeta() meta: RequestMeta,
  ): Promise<PlanDetailsResponse> {
    return toPlanDetailsResponse(
      await this.plans.updatePlan(actor, id, body, meta),
    );
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @RequirePlatformPermissions(PlatformPermission.PLANS_MANAGE)
  async activate(
    @CurrentPlatformAdmin() actor: AuthenticatedPlatformAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @ReqMeta() meta: RequestMeta,
  ): Promise<PlanDetailsResponse> {
    return toPlanDetailsResponse(await this.plans.activate(actor, id, meta));
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @RequirePlatformPermissions(PlatformPermission.PLANS_MANAGE)
  async archive(
    @CurrentPlatformAdmin() actor: AuthenticatedPlatformAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @ReqMeta() meta: RequestMeta,
  ): Promise<PlanDetailsResponse> {
    return toPlanDetailsResponse(await this.plans.archive(actor, id, meta));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePlatformPermissions(PlatformPermission.PLANS_MANAGE)
  async remove(
    @CurrentPlatformAdmin() actor: AuthenticatedPlatformAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @ReqMeta() meta: RequestMeta,
  ): Promise<void> {
    await this.plans.deletePlan(actor, id, meta);
  }

  @Put(':id/prices/:billingPeriod')
  @RequirePlatformPermissions(PlatformPermission.PLANS_MANAGE)
  async setPrice(
    @CurrentPlatformAdmin() actor: AuthenticatedPlatformAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('billingPeriod', new ParseEnumPipe(BillingPeriod))
    billingPeriod: BillingPeriod,
    @Body() body: SetPlanPriceDto,
    @ReqMeta() meta: RequestMeta,
  ): Promise<PlanDetailsResponse> {
    return toPlanDetailsResponse(
      await this.plans.setPrice(actor, id, billingPeriod, body.amount, meta),
    );
  }

  @Post(':id/prices/:priceId/archive')
  @HttpCode(HttpStatus.OK)
  @RequirePlatformPermissions(PlatformPermission.PLANS_MANAGE)
  async archivePrice(
    @CurrentPlatformAdmin() actor: AuthenticatedPlatformAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('priceId', ParseUUIDPipe) priceId: string,
    @ReqMeta() meta: RequestMeta,
  ): Promise<PlanDetailsResponse> {
    return toPlanDetailsResponse(
      await this.plans.archivePrice(actor, id, priceId, meta),
    );
  }

  @Put(':id/limits')
  @RequirePlatformPermissions(PlatformPermission.PLANS_MANAGE)
  async setLimits(
    @CurrentPlatformAdmin() actor: AuthenticatedPlatformAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SetPlanLimitsDto,
    @ReqMeta() meta: RequestMeta,
  ): Promise<PlanDetailsResponse> {
    return toPlanDetailsResponse(
      await this.plans.setLimits(actor, id, body.limits, meta),
    );
  }

  @Put(':id/features')
  @RequirePlatformPermissions(PlatformPermission.PLANS_MANAGE)
  async setFeatures(
    @CurrentPlatformAdmin() actor: AuthenticatedPlatformAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SetPlanFeaturesDto,
    @ReqMeta() meta: RequestMeta,
  ): Promise<PlanDetailsResponse> {
    return toPlanDetailsResponse(
      await this.plans.setFeatures(actor, id, body.features, meta),
    );
  }
}
