import { Type } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  PlatformAdminStatus,
  PlatformRole,
} from '../../../generated/prisma/enums.js';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from '../../admin-auth/common/password-policy.js';
import { Trim } from '../../../common/validation/validation-pipe.js';

export class CreatePlatformAdminDto {
  @Trim()
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @Trim()
  @IsString()
  @Length(1, 200)
  fullName!: string;

  @IsEnum(PlatformRole)
  role!: PlatformRole;

  @IsString()
  @Length(PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH)
  temporaryPassword!: string;
}

export class UpdatePlatformAdminDto {
  @Trim()
  @IsString()
  @Length(1, 200)
  fullName!: string;
}

export class ChangePlatformAdminRoleDto {
  @IsEnum(PlatformRole)
  role!: PlatformRole;
}

export class ResetPlatformAdminPasswordDto {
  @IsString()
  @Length(PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH)
  temporaryPassword!: string;
}

export class ListPlatformAdminsQuery {
  @IsOptional()
  @IsEnum(PlatformRole)
  role?: PlatformRole;

  @IsOptional()
  @IsEnum(PlatformAdminStatus)
  status?: PlatformAdminStatus;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 20;
}
