import { Type } from 'class-transformer';
import {
  IsDate,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  PlatformAuditAction,
  PlatformAuditTarget,
} from '../common/platform-audit-action.js';

export class ListPlatformAuditLogsQuery {
  @IsOptional()
  @IsUUID()
  actorAdminId?: string;

  @IsOptional()
  @IsIn(Object.values(PlatformAuditAction))
  action?: string;

  @IsOptional()
  @IsIn(Object.values(PlatformAuditTarget))
  targetType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  targetId?: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 50;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  cursor?: string;
}
