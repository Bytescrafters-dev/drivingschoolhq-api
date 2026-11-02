import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from '../../../common/security/password-policy.js';
import {
  IsNic,
  IsSriLankanPhone,
} from '../../../common/validation/sri-lanka-validators.js';
import { Trim } from '../../../common/validation/validation-pipe.js';
import {
  TenantRole,
  TenantUserBranchAccess,
  TenantUserStatus,
} from '../../../generated/prisma/enums.js';

export class StaffAccessDto {
  @IsEnum(TenantUserBranchAccess)
  branchAccess!: TenantUserBranchAccess;

  /** Required (non-empty) for SELECTED; must be empty or omitted for ALL. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  branchIds?: string[];

  @IsUUID()
  defaultBranchId!: string;
}

export class CreateStaffDto extends StaffAccessDto {
  @Trim()
  @IsString()
  @Length(1, 200)
  fullName!: string;

  @Trim()
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsOptional()
  @IsSriLankanPhone()
  phone?: string | null;

  @IsOptional()
  @IsNic()
  nic?: string | null;

  /** Any role below the actor's (never OWNER). */
  @IsEnum(TenantRole)
  role!: TenantRole;

  @IsString()
  @Length(PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH)
  temporaryPassword!: string;
}

/** Omitted fields stay; null clears phone/NIC. */
export class UpdateStaffDto {
  @IsOptional()
  @Trim()
  @IsString()
  @Length(1, 200)
  fullName?: string;

  @IsOptional()
  @Trim()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @IsOptional()
  @IsSriLankanPhone()
  phone?: string | null;

  @IsOptional()
  @IsNic()
  nic?: string | null;
}

export class ChangeStaffRoleDto {
  @IsEnum(TenantRole)
  role!: TenantRole;
}

export class ResetStaffPasswordDto {
  @IsString()
  @Length(PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH)
  temporaryPassword!: string;
}

export class ListStaffQuery {
  @IsOptional()
  @IsEnum(TenantUserStatus)
  status?: TenantUserStatus;

  @IsOptional()
  @IsEnum(TenantRole)
  role?: TenantRole;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @Trim()
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
