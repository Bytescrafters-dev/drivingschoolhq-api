import { Transform, Type } from 'class-transformer';
import {
  IsDefined,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  District,
  TenantAccessStatus,
  TenantStatus,
} from '../../../generated/prisma/enums.js';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from '../../../common/security/password-policy.js';
import {
  NIC_PATTERN,
  SRI_LANKAN_PHONE_PATTERN,
  normalizeNic,
  normalizeSriLankanPhone,
} from '../../../common/text/sri-lanka.js';
import { ISO_DATE_PATTERN } from '../../../common/time/calendar-date.js';
import { Trim } from '../../../common/validation/validation-pipe.js';
import { LKR_AMOUNT_PATTERN } from '../../plans/common/money.js';
import { DS_CODE_MESSAGE, DS_CODE_PATTERN } from '../common/ds-code.js';
import { MAX_GRACE_PERIOD_DAYS } from '../../subscriptions/subscriptions.service.js';

/** Normalises to +94XXXXXXXXX when possible; invalid input fails @Matches. */
const SriLankanPhone = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? (normalizeSriLankanPhone(value) ?? value)
      : value,
  );

const Nic = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? (normalizeNic(value) ?? value) : value,
  );

const UpperTrim = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  );

const PHONE_MESSAGE =
  'phone must be a valid Sri Lankan number, e.g. 0771234567 or +94771234567';

export class TenantProfileDto {
  @UpperTrim()
  @IsString()
  @Matches(DS_CODE_PATTERN, { message: DS_CODE_MESSAGE })
  dsCode!: string;

  @Trim()
  @IsString()
  @Length(1, 200)
  name!: string;

  @Trim()
  @IsString()
  @Length(1, 100)
  displayName!: string;

  @Trim()
  @IsString()
  @Length(1, 500)
  address!: string;

  @IsEnum(District)
  district!: District;

  @SriLankanPhone()
  @IsString()
  @Matches(SRI_LANKAN_PHONE_PATTERN, { message: PHONE_MESSAGE })
  phone!: string;
}

export class SubscriptionTermsDto {
  @IsUUID()
  planPriceId!: string;

  /** "YYYY-MM-DD" in Asia/Colombo; omit for no trial. */
  @IsOptional()
  @IsString()
  @Matches(ISO_DATE_PATTERN, { message: 'trialEndDate must be YYYY-MM-DD' })
  trialEndDate?: string | null;

  @IsOptional()
  @IsString()
  @Matches(LKR_AMOUNT_PATTERN, {
    message:
      'agreedAmount must be a decimal string in LKR with at most 2 decimals',
  })
  agreedAmount?: string;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(500)
  discountReason?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_GRACE_PERIOD_DAYS)
  gracePeriodDays?: number;
}

export class TenantOwnerDto {
  @Trim()
  @IsString()
  @Length(1, 200)
  fullName!: string;

  @Trim()
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @SriLankanPhone()
  @IsString()
  @Matches(SRI_LANKAN_PHONE_PATTERN, { message: PHONE_MESSAGE })
  phone!: string;

  @Nic()
  @IsString()
  @Matches(NIC_PATTERN, {
    message: 'nic must be 9 digits followed by V/X, or 12 digits',
  })
  nic!: string;

  @IsString()
  @Length(PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH)
  temporaryPassword!: string;
}

export class CreateTenantDto {
  @IsDefined()
  @ValidateNested()
  @Type(() => TenantProfileDto)
  tenant!: TenantProfileDto;

  @IsDefined()
  @ValidateNested()
  @Type(() => SubscriptionTermsDto)
  subscription!: SubscriptionTermsDto;

  @IsDefined()
  @ValidateNested()
  @Type(() => TenantOwnerDto)
  owner!: TenantOwnerDto;
}

export class UpdateTenantDto {
  @IsOptional()
  @UpperTrim()
  @IsString()
  @Matches(DS_CODE_PATTERN, { message: DS_CODE_MESSAGE })
  dsCode?: string;

  @IsOptional()
  @Trim()
  @IsString()
  @Length(1, 200)
  name?: string;

  @IsOptional()
  @Trim()
  @IsString()
  @Length(1, 100)
  displayName?: string;

  @IsOptional()
  @Trim()
  @IsString()
  @Length(1, 500)
  address?: string;

  @IsOptional()
  @IsEnum(District)
  district?: District;

  @IsOptional()
  @SriLankanPhone()
  @IsString()
  @Matches(SRI_LANKAN_PHONE_PATTERN, { message: PHONE_MESSAGE })
  phone?: string;
}

export class CloseTenantDto {
  @Trim()
  @IsString()
  @Length(1, 500)
  reason!: string;
}

export class ListTenantsQuery {
  @IsOptional()
  @IsEnum(TenantStatus)
  status?: TenantStatus;

  @IsOptional()
  @IsEnum(District)
  district?: District;

  @IsOptional()
  @IsEnum(TenantAccessStatus)
  accessStatus?: TenantAccessStatus;

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
