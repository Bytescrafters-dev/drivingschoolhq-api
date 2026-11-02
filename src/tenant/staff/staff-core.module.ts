import { Module } from '@nestjs/common';
import { PrismaStaffRepository } from './infra/prisma-staff.repository.js';
import { STAFF_REPOSITORY } from './interfaces/staff.repository.js';

/** Staff persistence, shared with the platform's read-only staff view. */
@Module({
  providers: [{ provide: STAFF_REPOSITORY, useClass: PrismaStaffRepository }],
  exports: [STAFF_REPOSITORY],
})
export class StaffCoreModule {}
