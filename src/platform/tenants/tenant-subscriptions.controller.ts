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
  CancelScheduledChangeDto,
  ChangeGracePeriodDto,
  ScheduleSubscriptionChangeDto,
} from './dto/tenant-subscription.dto.js';
import {
  type TenantSubscriptionsViewResponse,
  toSubscriptionResponse,
  toTenantSubscriptionsViewResponse,
} from './interfaces/tenant.response.js';
import { TenantSubscriptionsService } from './tenant-subscriptions.service.js';

@Controller('platform/tenants/:tenantId')
@PlatformAuth()
export class TenantSubscriptionsController {
  constructor(private readonly subscriptions: TenantSubscriptionsService) {}

  /** Full subscription history, newest first. */
  @Get('subscriptions')
  @RequirePlatformPermissions(PlatformPermission.SUBSCRIPTIONS_READ)
  async history(@Param('tenantId', ParseUUIDPipe) tenantId: string) {
    const items = await this.subscriptions.listHistory(tenantId);
    return { items: items.map(toSubscriptionResponse) };
  }

  /** Current ACTIVE subscription (with billing period) and scheduled change. */
  @Get('subscription')
  @RequirePlatformPermissions(PlatformPermission.SUBSCRIPTIONS_READ)
  async current(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
  ): Promise<TenantSubscriptionsViewResponse> {
    return toTenantSubscriptionsViewResponse(
      await this.subscriptions.current(tenantId),
    );
  }

  @Post('subscription/scheduled-change')
  @HttpCode(HttpStatus.OK)
  @RequirePlatformPermissions(PlatformPermission.SUBSCRIPTIONS_MANAGE)
  async scheduleChange(
    @CurrentPlatformAdmin() actor: AuthenticatedPlatformAdmin,
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() body: ScheduleSubscriptionChangeDto,
    @ReqMeta() meta: RequestMeta,
  ): Promise<TenantSubscriptionsViewResponse> {
    return toTenantSubscriptionsViewResponse(
      await this.subscriptions.scheduleChange(actor, tenantId, body, meta),
    );
  }

  @Post('subscription/scheduled-change/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePlatformPermissions(PlatformPermission.SUBSCRIPTIONS_MANAGE)
  async cancelScheduledChange(
    @CurrentPlatformAdmin() actor: AuthenticatedPlatformAdmin,
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() body: CancelScheduledChangeDto,
    @ReqMeta() meta: RequestMeta,
  ): Promise<TenantSubscriptionsViewResponse> {
    return toTenantSubscriptionsViewResponse(
      await this.subscriptions.cancelScheduledChange(
        actor,
        tenantId,
        body.reason,
        meta,
      ),
    );
  }

  @Patch('subscription/grace-period')
  @RequirePlatformPermissions(PlatformPermission.SUBSCRIPTIONS_MANAGE)
  async changeGracePeriod(
    @CurrentPlatformAdmin() actor: AuthenticatedPlatformAdmin,
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() body: ChangeGracePeriodDto,
    @ReqMeta() meta: RequestMeta,
  ): Promise<TenantSubscriptionsViewResponse> {
    return toTenantSubscriptionsViewResponse(
      await this.subscriptions.changeGracePeriod(
        actor,
        tenantId,
        body.gracePeriodDays,
        meta,
      ),
    );
  }
}
