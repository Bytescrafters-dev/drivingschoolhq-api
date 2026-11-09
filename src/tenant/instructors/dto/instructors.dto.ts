import { IsIn, IsOptional } from 'class-validator';
import { InstructorProfileStatus } from '../../../generated/prisma/enums.js';
import type { InstructorProfileState } from '../instructor-readiness.js';

const PROFILE_STATES: InstructorProfileState[] = [
  'SETUP_REQUIRED',
  ...Object.values(InstructorProfileStatus),
];

export class ListInstructorsQueryDto {
  @IsOptional()
  @IsIn(PROFILE_STATES)
  profileStatus?: InstructorProfileState;
}
