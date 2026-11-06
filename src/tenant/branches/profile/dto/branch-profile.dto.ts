import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';
import { DrivingSchoolGrade } from '../../../../generated/prisma/enums.js';
import { ISO_DATE_PATTERN } from '../../../../common/time/calendar-date.js';
import { Trim } from '../../../../common/validation/validation-pipe.js';

export class RecordBranchLicenceDto {
  @Trim()
  @IsString()
  @Length(1, 100)
  licenceNumber!: string;

  @IsEnum(DrivingSchoolGrade)
  grade!: DrivingSchoolGrade;

  @Matches(ISO_DATE_PATTERN, { message: 'issuedOn must be YYYY-MM-DD' })
  issuedOn!: string;

  @Matches(ISO_DATE_PATTERN, { message: 'expiresOn must be YYYY-MM-DD' })
  expiresOn!: string;
}

export class CorrectBranchLicenceDto {
  @IsOptional()
  @Trim()
  @IsString()
  @Length(1, 100)
  licenceNumber?: string;

  @IsOptional()
  @IsEnum(DrivingSchoolGrade)
  grade?: DrivingSchoolGrade;

  @IsOptional()
  @Matches(ISO_DATE_PATTERN, { message: 'issuedOn must be YYYY-MM-DD' })
  issuedOn?: string;

  @IsOptional()
  @Matches(ISO_DATE_PATTERN, { message: 'expiresOn must be YYYY-MM-DD' })
  expiresOn?: string;
}

export class SetBranchVehicleClassesDto {
  /** Vehicle class codes, e.g. ["A1", "B"]; empty offers nothing. */
  @IsArray()
  @ArrayMaxSize(50)
  @Transform(({ value }: { value: unknown }) =>
    Array.isArray(value)
      ? value.map((v) => (typeof v === 'string' ? v.trim().toUpperCase() : v))
      : value,
  )
  @IsString({ each: true })
  @Length(1, 10, { each: true })
  codes!: string[];
}
