import { Transform } from 'class-transformer';
import { IsEmail, IsString, Length, MaxLength } from 'class-validator';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from '../../../common/security/password-policy.js';
import { Trim } from '../../../common/validation/validation-pipe.js';

export class TenantLoginDto {
  /** The driving school's DS code (case-insensitive). */
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @Length(1, 30)
  dsCode!: string;

  @Trim()
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @Length(1, PASSWORD_MAX_LENGTH)
  password!: string;
}

export class TenantRefreshDto {
  @IsString()
  @Length(1, 200)
  refreshToken!: string;
}

export class TenantChangePasswordDto {
  @IsString()
  @Length(1, PASSWORD_MAX_LENGTH)
  currentPassword!: string;

  @IsString()
  @Length(PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH)
  newPassword!: string;
}
