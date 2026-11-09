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
  CorrectLicenceDto,
  RecordLicenceDto,
  SetVehicleClassesDto,
} from '../../reference-data/vehicle-classes/dto/licence.dto.js';
import {
  CurrentTenantUser,
  RequireTenantPermissions,
  TenantAuth,
} from '../auth/common/decorators.js';
import type { AuthenticatedTenantUser } from '../auth/interfaces/authenticated-tenant-user.js';
import { BranchScoped, CurrentBranch } from '../branches/common/decorators.js';
import type { WorkingBranch } from '../branches/interfaces/working-branch.js';
import { TenantPermission } from '../permissions/tenant-permission.js';
import { ListInstructorsQueryDto } from './dto/instructors.dto.js';
import { InstructorsService } from './instructors.service.js';
import {
  type InstructorDetailResponse,
  toInstructorChangeResponse,
  toInstructorDetailResponse,
  toInstructorListItemResponse,
  toInstructorViewResponse,
} from './interfaces/instructor.response.js';

/**
 * Instructor profiles. Reads need INSTRUCTORS_VIEW (every role). Writes are
 * checked by instructor-policy.ts in the service: anyone may set up and edit
 * their own profile; managing others needs INSTRUCTORS_MANAGE.
 */
@Controller('tenant/instructors')
@TenantAuth()
export class InstructorsController {
  constructor(private readonly instructors: InstructorsService) {}

  /** Instructors who can work in the working branch (X-Branch-Id). */
  @Get()
  @BranchScoped()
  @RequireTenantPermissions(TenantPermission.INSTRUCTORS_VIEW)
  async list(
    @CurrentTenantUser() actor: AuthenticatedTenantUser,
    @CurrentBranch() branch: WorkingBranch,
    @Query() query: ListInstructorsQueryDto,
  ) {
    const items = await this.instructors.list(actor, branch, query);
    return { items: items.map(toInstructorListItemResponse) };
  }

  /** Staff of the working branch who can be given a profile. */
  @Get('candidates')
  @BranchScoped()
  @RequireTenantPermissions(TenantPermission.INSTRUCTORS_MANAGE)
  async candidates(
    @CurrentTenantUser() actor: AuthenticatedTenantUser,
    @CurrentBranch() branch: WorkingBranch,
  ) {
    const items = await this.instructors.candidates(actor, branch);
    return { items: items.map(toInstructorViewResponse) };
  }

  @Get(':userId')
  @RequireTenantPermissions(TenantPermission.INSTRUCTORS_VIEW)
  async get(
    @CurrentTenantUser() actor: AuthenticatedTenantUser,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<InstructorDetailResponse> {
    return toInstructorDetailResponse(
      await this.instructors.get(actor, userId),
    );
  }

  /** Creates the profile (ACTIVE) with the first licence. */
  @Post(':userId/profile')
  async create(
    @CurrentTenantUser() actor: AuthenticatedTenantUser,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() body: RecordLicenceDto,
    @ReqMeta() meta: RequestMeta,
  ): Promise<InstructorDetailResponse> {
    return toInstructorDetailResponse(
      await this.instructors.createProfile(actor, userId, body, meta),
    );
  }

  /** Records a licence renewal. */
  @Post(':userId/licence')
  async recordLicence(
    @CurrentTenantUser() actor: AuthenticatedTenantUser,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() body: RecordLicenceDto,
    @ReqMeta() meta: RequestMeta,
  ) {
    return toInstructorChangeResponse(
      await this.instructors.recordLicence(actor, userId, body, meta),
    );
  }

  /** Corrects the current licence. */
  @Patch(':userId/licence')
  async correctLicence(
    @CurrentTenantUser() actor: AuthenticatedTenantUser,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() body: CorrectLicenceDto,
    @ReqMeta() meta: RequestMeta,
  ) {
    return toInstructorChangeResponse(
      await this.instructors.correctLicence(actor, userId, body, meta),
    );
  }

  @Put(':userId/vehicle-classes')
  async setVehicleClasses(
    @CurrentTenantUser() actor: AuthenticatedTenantUser,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() body: SetVehicleClassesDto,
    @ReqMeta() meta: RequestMeta,
  ): Promise<InstructorDetailResponse> {
    return toInstructorDetailResponse(
      await this.instructors.setQualifiedClasses(
        actor,
        userId,
        body.codes,
        meta,
      ),
    );
  }

  @Post(':userId/inactivate')
  @HttpCode(HttpStatus.OK)
  async inactivate(
    @CurrentTenantUser() actor: AuthenticatedTenantUser,
    @Param('userId', ParseUUIDPipe) userId: string,
    @ReqMeta() meta: RequestMeta,
  ): Promise<InstructorDetailResponse> {
    return toInstructorDetailResponse(
      await this.instructors.inactivate(actor, userId, meta),
    );
  }

  @Post(':userId/reactivate')
  @HttpCode(HttpStatus.OK)
  async reactivate(
    @CurrentTenantUser() actor: AuthenticatedTenantUser,
    @Param('userId', ParseUUIDPipe) userId: string,
    @ReqMeta() meta: RequestMeta,
  ): Promise<InstructorDetailResponse> {
    return toInstructorDetailResponse(
      await this.instructors.reactivate(actor, userId, meta),
    );
  }
}

/** The signed-in user's own instructor profile (SETUP_REQUIRED without one). */
@Controller('tenant/me/instructor-profile')
@TenantAuth()
export class MyInstructorProfileController {
  constructor(private readonly instructors: InstructorsService) {}

  @Get()
  async get(
    @CurrentTenantUser() actor: AuthenticatedTenantUser,
  ): Promise<InstructorDetailResponse> {
    return toInstructorDetailResponse(await this.instructors.mine(actor));
  }
}
