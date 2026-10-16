import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import type { Env } from '../../config/env.js';
import { BUSINESS_TIME_ZONE } from '../../common/time/calendar-date.js';
import { SubscriptionsService } from '../subscriptions/subscriptions.service.js';
import { TenantSubscriptionsService } from './tenant-subscriptions.service.js';

const BATCH_SIZE = 100;

/**
 * Activates scheduled plan changes on their renewal date. Runs daily at 00:05
 * Asia/Colombo and once at boot to catch up after downtime. Each tenant is
 * processed in its own transaction under the tenant row lock, so concurrent
 * runs (several app instances) are safe and the job is idempotent.
 */
@Injectable()
export class SubscriptionRenewalJob implements OnApplicationBootstrap {
  private readonly logger = new Logger(SubscriptionRenewalJob.name);
  private running = false;

  constructor(
    private readonly subscriptions: SubscriptionsService,
    private readonly tenantSubscriptions: TenantSubscriptionsService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.enabled()) return;
    void this.run().catch((error: unknown) =>
      this.logger.error('Boot catch-up failed', error),
    );
  }

  @Cron('5 0 * * *', {
    name: 'subscription-renewal',
    timeZone: BUSINESS_TIME_ZONE,
  })
  async onSchedule(): Promise<void> {
    if (!this.enabled()) return;
    await this.run();
  }

  /** Activates every due scheduled change. Returns how many were activated. */
  async run(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let activated = 0;
    const failed = new Set<string>();
    try {
      for (;;) {
        const due = (
          await this.subscriptions.findTenantIdsWithDueChanges(
            BATCH_SIZE + failed.size,
          )
        ).filter((id) => !failed.has(id));
        if (due.length === 0) break;
        for (const tenantId of due) {
          try {
            if (await this.tenantSubscriptions.activateDueChange(tenantId)) {
              activated++;
            } else {
              // Not activatable (e.g. CLOSED tenant): do not retry this run.
              failed.add(tenantId);
            }
          } catch (error) {
            failed.add(tenantId);
            this.logger.error(
              `Activating scheduled subscription change failed for tenant ${tenantId}`,
              error,
            );
          }
        }
      }
    } finally {
      this.running = false;
    }
    if (activated > 0) {
      this.logger.log(
        `Activated ${activated} scheduled subscription change(s)`,
      );
    }
    return activated;
  }

  private enabled(): boolean {
    return this.config.get('JOBS_ENABLED', { infer: true });
  }
}
