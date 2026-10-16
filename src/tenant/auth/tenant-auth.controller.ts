import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ReqMeta, type RequestMeta } from '../../common/http/request-meta.js';
import {
  CurrentTenantUser,
  TenantAllowPasswordChangeRequired,
  TenantAuth,
} from './common/decorators.js';
import {
  TenantChangePasswordDto,
  TenantLoginDto,
  TenantRefreshDto,
} from './dto/tenant-auth.dto.js';
import type { AuthenticatedTenantUser } from './interfaces/authenticated-tenant-user.js';
import {
  TenantAuthService,
  type TenantAuthTokens,
} from './tenant-auth.service.js';

@Controller('tenant/auth')
export class TenantAuthController {
  constructor(private readonly auth: TenantAuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  login(
    @Body() body: TenantLoginDto,
    @ReqMeta() meta: RequestMeta,
  ): Promise<TenantAuthTokens> {
    return this.auth.login(body.dsCode, body.email, body.password, meta);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  refresh(
    @Body() body: TenantRefreshDto,
    @ReqMeta() meta: RequestMeta,
  ): Promise<TenantAuthTokens> {
    return this.auth.refresh(body.refreshToken, meta);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @TenantAuth()
  @TenantAllowPasswordChangeRequired()
  logout(
    @CurrentTenantUser() actor: AuthenticatedTenantUser,
    @ReqMeta() meta: RequestMeta,
  ): Promise<void> {
    return this.auth.logout(actor, meta);
  }

  @Post('change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @TenantAuth()
  @TenantAllowPasswordChangeRequired()
  changePassword(
    @CurrentTenantUser() actor: AuthenticatedTenantUser,
    @Body() body: TenantChangePasswordDto,
    @ReqMeta() meta: RequestMeta,
  ): Promise<void> {
    return this.auth.changePassword(
      actor,
      body.currentPassword,
      body.newPassword,
      meta,
    );
  }

  @Get('me')
  @TenantAuth()
  @TenantAllowPasswordChangeRequired()
  async me(@CurrentTenantUser() actor: AuthenticatedTenantUser) {
    const { user, tenant } = await this.auth.me(actor);
    return {
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        mustChangePassword: user.mustChangePassword,
      },
      tenant: {
        id: tenant.id,
        dsCode: tenant.dsCode,
        displayName: tenant.displayName,
        accessStatus: tenant.accessStatus,
      },
    };
  }
}
