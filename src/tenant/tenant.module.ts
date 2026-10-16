import { Module } from '@nestjs/common';
import { TenantAuthModule } from './auth/tenant-auth.module.js';

/** Root of the driving-school (tenant) domain. */
@Module({
  imports: [TenantAuthModule],
})
export class TenantModule {}
