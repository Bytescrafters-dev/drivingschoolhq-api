import { IsOptional, IsString, Length } from 'class-validator';
import { IsSriLankanPhone } from '../../../common/validation/sri-lanka-validators.js';
import { Trim } from '../../../common/validation/validation-pipe.js';

/** What a signed-in user may change about themselves. */
export class UpdateMyProfileDto {
  @IsOptional()
  @Trim()
  @IsString()
  @Length(1, 200)
  fullName?: string;

  /** null removes the phone (not allowed for the owner). */
  @IsOptional()
  @IsSriLankanPhone()
  phone?: string | null;
}
