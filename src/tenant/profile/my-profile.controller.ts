import { Body, Controller, Patch } from '@nestjs/common';
import { ReqMeta, type RequestMeta } from '../../common/http/request-meta.js';
import { CurrentTenantUser, TenantAuth } from '../auth/common/decorators.js';
import type { AuthenticatedTenantUser } from '../auth/interfaces/authenticated-tenant-user.js';
import { UpdateMyProfileDto } from './dto/my-profile.dto.js';
import { MyProfileService } from './my-profile.service.js';

@Controller('tenant/me')
@TenantAuth()
export class MyProfileController {
  constructor(private readonly profile: MyProfileService) {}

  /** Own name and phone. Email/NIC are managed by others; see the service. */
  @Patch()
  async update(
    @CurrentTenantUser() actor: AuthenticatedTenantUser,
    @Body() body: UpdateMyProfileDto,
    @ReqMeta() meta: RequestMeta,
  ) {
    const user = await this.profile.update(actor, body, meta);
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      phone: user.phone,
      nic: user.nic,
      role: user.role,
    };
  }
}
