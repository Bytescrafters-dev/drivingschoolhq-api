import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
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
import { Trim } from '../../../common/validation/validation-pipe.js';

export class UpdateTenantOwnerDto {
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
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? (normalizeSriLankanPhone(value) ?? value)
      : value,
  )
  @IsString()
  @Matches(SRI_LANKAN_PHONE_PATTERN, {
    message:
      'phone must be a valid Sri Lankan number, e.g. 0771234567 or +94771234567',
  })
  phone?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? (normalizeNic(value) ?? value) : value,
  )
  @IsString()
  @Matches(NIC_PATTERN, {
    message: 'nic must be 9 digits followed by V/X, or 12 digits',
  })
  nic?: string;
}

export class ResetTenantOwnerPasswordDto {
  @IsString()
  @Length(PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH)
  temporaryPassword!: string;
}
