import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  BillingPeriod,
  PlanFeatureCode,
  PlanLimitCode,
  PricePlanStatus,
} from '../../../generated/prisma/enums.js';
import { Trim } from '../../../common/validation/validation-pipe.js';
import { LKR_AMOUNT_PATTERN } from '../common/money.js';

const AMOUNT_MESSAGE =
  'amount must be a decimal string in LKR with at most 2 decimals, e.g. "5000.00"';

/** Parses "true"/"false" query strings; anything else is left for validation to reject. */
const QueryBoolean = () =>
  Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  );

export class PlanPriceDto {
  @IsEnum(BillingPeriod)
  billingPeriod!: BillingPeriod;

  @IsString()
  @Matches(LKR_AMOUNT_PATTERN, { message: AMOUNT_MESSAGE })
  amount!: string;
}

export class PlanLimitDto {
  @IsEnum(PlanLimitCode)
  code!: PlanLimitCode;

  /** null = unlimited. */
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  value!: number | null;
}

export class CreatePlanDto {
  @Trim()
  @IsString()
  @Matches(/^[A-Za-z0-9_]{2,50}$/, {
    message: 'code must be 2-50 characters of letters, digits or underscores',
  })
  code!: string;

  @Trim()
  @IsString()
  @Length(1, 100)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  sortOrder?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => PlanPriceDto)
  prices?: PlanPriceDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PlanLimitDto)
  limits?: PlanLimitDto[];

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsEnum(PlanFeatureCode, { each: true })
  features?: PlanFeatureCode[];
}

export class UpdatePlanDto {
  @IsOptional()
  @Trim()
  @IsString()
  @Length(1, 100)
  name?: string;

  /** null clears the description. */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  sortOrder?: number;
}

export class SetPlanPriceDto {
  @IsString()
  @Matches(LKR_AMOUNT_PATTERN, { message: AMOUNT_MESSAGE })
  amount!: string;
}

export class SetPlanLimitsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PlanLimitDto)
  limits!: PlanLimitDto[];
}

export class SetPlanFeaturesDto {
  @IsArray()
  @ArrayUnique()
  @IsEnum(PlanFeatureCode, { each: true })
  features!: PlanFeatureCode[];
}

export class ListPlansQuery {
  @IsOptional()
  @IsEnum(PricePlanStatus)
  status?: PricePlanStatus;

  @IsOptional()
  @QueryBoolean()
  @IsBoolean()
  isPublic?: boolean;

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

export class ListPlanPricesQuery {
  @IsOptional()
  @QueryBoolean()
  @IsBoolean()
  includeArchived: boolean = false;
}
