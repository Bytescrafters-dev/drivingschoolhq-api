import { IsEmail, IsString, Length, MaxLength } from 'class-validator';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from '../../../common/security/password-policy.js';
import { Trim } from '../../../common/validation/validation-pipe.js';

export class PlatformLoginDto {
  @Trim()
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @Length(1, PASSWORD_MAX_LENGTH)
  password!: string;
}

export class PlatformRefreshDto {
  @IsString()
  @Length(1, 200)
  refreshToken!: string;
}

export class PlatformChangePasswordDto {
  @IsString()
  @Length(1, PASSWORD_MAX_LENGTH)
  currentPassword!: string;

  @IsString()
  @Length(PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH)
  newPassword!: string;
}
