import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Trim } from '../../../common/validation/validation-pipe.js';
import { LKR_AMOUNT_PATTERN } from '../../plans/common/money.js';
import { MAX_GRACE_PERIOD_DAYS } from '../../subscriptions/subscriptions.service.js';

/** A plan change taking effect at the next renewal date (no trial). */
export class ScheduleSubscriptionChangeDto {
  @IsUUID()
  planPriceId!: string;

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

  /** Defaults to the current subscription's grace period. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_GRACE_PERIOD_DAYS)
  gracePeriodDays?: number;
}

export class CancelScheduledChangeDto {
  @Trim()
  @IsString()
  @Length(1, 500)
  reason!: string;
}

export class ChangeGracePeriodDto {
  @IsInt()
  @Min(0)
  @Max(MAX_GRACE_PERIOD_DAYS)
  gracePeriodDays!: number;
}
