import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import {
  ReqMeta,
  type RequestMeta,
} from '../../../common/http/request-meta.js';
import { VehicleClassCatalogService } from '../../../reference-data/vehicle-classes/vehicle-class-catalog.service.js';
import {
  CurrentTenantUser,
  RequireTenantPermissions,
  TenantAuth,
} from '../../auth/common/decorators.js';
import type { AuthenticatedTenantUser } from '../../auth/interfaces/authenticated-tenant-user.js';
import { TenantPermission } from '../../permissions/tenant-permission.js';
import {
  BranchProfileService,
  type LicenceChangeResult,
} from './branch-profile.service.js';
import {
  CorrectBranchLicenceDto,
  RecordBranchLicenceDto,
  SetBranchVehicleClassesDto,
} from './dto/branch-profile.dto.js';
import {
  type BranchProfileResponse,
  toBranchProfileResponse,
  toVehicleClassResponse,
} from './interfaces/branch-profile.response.js';

@Controller('tenant/branches/:id')
@TenantAuth()
export class BranchProfileController {
  constructor(private readonly profiles: BranchProfileService) {}

  /** Licence, licence history, permitted/offered classes and readiness. */
  @Get('profile')
  async get(
    @CurrentTenantUser() actor: AuthenticatedTenantUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<BranchProfileResponse> {
    return toBranchProfileResponse(await this.profiles.get(actor, id));
  }

  /** Records the first licence or a renewal. */
  @Post('licence')
  @RequireTenantPermissions(TenantPermission.BRANCHES_MANAGE)
  async recordLicence(
    @CurrentTenantUser() actor: AuthenticatedTenantUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RecordBranchLicenceDto,
    @ReqMeta() meta: RequestMeta,
  ) {
    return toChangeResponse(
      await this.profiles.recordLicence(actor, id, body, meta),
    );
  }

  /** Corrects the current licence. */
  @Patch('licence')
  @RequireTenantPermissions(TenantPermission.BRANCHES_MANAGE)
  async correctLicence(
    @CurrentTenantUser() actor: AuthenticatedTenantUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CorrectBranchLicenceDto,
    @ReqMeta() meta: RequestMeta,
  ) {
    return toChangeResponse(
      await this.profiles.correctLicence(actor, id, body, meta),
    );
  }

  @Put('vehicle-classes')
  @RequireTenantPermissions(TenantPermission.BRANCHES_MANAGE)
  async setVehicleClasses(
    @CurrentTenantUser() actor: AuthenticatedTenantUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SetBranchVehicleClassesDto,
    @ReqMeta() meta: RequestMeta,
  ): Promise<BranchProfileResponse> {
    return toBranchProfileResponse(
      await this.profiles.setOfferedClasses(actor, id, body.codes, meta),
    );
  }
}

/** DMT vehicle classes and the grades permitted to teach each. */
@Controller('tenant/vehicle-classes')
@TenantAuth()
export class TenantVehicleClassesController {
  constructor(private readonly catalog: VehicleClassCatalogService) {}

  @Get()
  async list() {
    return {
      items: (await this.catalog.list()).map(toVehicleClassResponse),
    };
  }
}

function toChangeResponse(result: LicenceChangeResult) {
  return {
    ...toBranchProfileResponse(result.profile),
    /** Offered classes dropped because the new grade does not permit them. */
    removedVehicleClasses: result.removedVehicleClasses,
  };
}
