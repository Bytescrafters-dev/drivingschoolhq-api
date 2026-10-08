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
import type { AuthenticatedPlatformAdmin } from './interfaces/authenticated-platform-admin.js';
import {
  AllowPasswordChangeRequired,
  CurrentPlatformAdmin,
  PlatformAuth,
} from './common/decorators.js';
import {
  PlatformChangePasswordDto,
  PlatformLoginDto,
  PlatformRefreshDto,
} from './dto/platform-auth.dto.js';
import {
  PlatformAdminAuthService,
  type PlatformAuthTokens,
} from './platform-admin-auth.service.js';

@Controller('platform/auth')
export class PlatformAdminAuthController {
  constructor(private readonly auth: PlatformAdminAuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  login(
    @Body() body: PlatformLoginDto,
    @ReqMeta() meta: RequestMeta,
  ): Promise<PlatformAuthTokens> {
    return this.auth.login(body.email, body.password, meta);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  refresh(
    @Body() body: PlatformRefreshDto,
    @ReqMeta() meta: RequestMeta,
  ): Promise<PlatformAuthTokens> {
    return this.auth.refresh(body.refreshToken, meta);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @PlatformAuth()
  @AllowPasswordChangeRequired()
  logout(
    @CurrentPlatformAdmin() actor: AuthenticatedPlatformAdmin,
    @ReqMeta() meta: RequestMeta,
  ): Promise<void> {
    return this.auth.logout(actor, meta);
  }

  @Post('change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @PlatformAuth()
  @AllowPasswordChangeRequired()
  changePassword(
    @CurrentPlatformAdmin() actor: AuthenticatedPlatformAdmin,
    @Body() body: PlatformChangePasswordDto,
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
  @PlatformAuth()
  @AllowPasswordChangeRequired()
  me(@CurrentPlatformAdmin() actor: AuthenticatedPlatformAdmin) {
    return {
      id: actor.id,
      email: actor.email,
      fullName: actor.fullName,
      role: actor.role,
      mustChangePassword: actor.mustChangePassword,
      permissions: actor.permissions,
    };
  }
}
