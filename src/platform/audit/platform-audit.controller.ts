import { Controller, Get, Query } from '@nestjs/common';
import {
  PlatformAuth,
  RequirePlatformPermissions,
} from '../admin-auth/common/decorators.js';
import { PlatformPermission } from '../permissions/platform-permission.js';
import { ListPlatformAuditLogsQuery } from './dto/list-platform-audit-logs.query.js';
import {
  PlatformAuditService,
  type PlatformAuditPage,
} from './platform-audit.service.js';

@Controller('platform/audit-logs')
@PlatformAuth()
export class PlatformAuditController {
  constructor(private readonly audit: PlatformAuditService) {}

  @Get()
  @RequirePlatformPermissions(PlatformPermission.PLATFORM_AUDIT_READ)
  list(@Query() query: ListPlatformAuditLogsQuery): Promise<PlatformAuditPage> {
    const { cursor, limit, ...filter } = query;
    return this.audit.list(filter, cursor, limit);
  }
}
