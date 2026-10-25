import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
} from 'class-validator';
import { District } from '../../../generated/prisma/enums.js';
import {
  SRI_LANKAN_PHONE_PATTERN,
  normalizeSriLankanPhone,
} from '../../../common/text/sri-lanka.js';
import { Trim } from '../../../common/validation/validation-pipe.js';

/** Normalises to +94XXXXXXXXX when possible; invalid input fails @Matches. */
const SriLankanPhone = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? (normalizeSriLankanPhone(value) ?? value)
      : value,
  );

const PHONE_MESSAGE =
  'phone must be a valid Sri Lankan number, e.g. 0771234567 or +94771234567';

export class CreateBranchDto {
  @Trim()
  @IsString()
  @Length(1, 100)
  name!: string;

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

export class UpdateBranchDto {
  @IsOptional()
  @Trim()
  @IsString()
  @Length(1, 100)
  name?: string;

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

export class ListBranchesQuery {
  /** Include CLOSED branches (to review or reopen them). */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  includeClosed: boolean = false;
}

export class SetDefaultBranchDto {
  @IsUUID()
  branchId!: string;
}
