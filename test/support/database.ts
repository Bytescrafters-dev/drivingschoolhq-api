import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import { assertTestDatabase } from './test-env.js';

export function createTestPrisma(): PrismaClient {
  const url = process.env.DATABASE_URL!;
  assertTestDatabase(url);
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
}

/** TRUNCATE bypasses the audit log's row-level append-only trigger by design. */
export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  assertTestDatabase(process.env.DATABASE_URL!);
  await prisma.$executeRawUnsafe(
    `TRUNCATE
       tenant_audit_logs, tenant_user_sessions,
       tenant_users, tenant_access, tenant_subscriptions, tenants,
       plan_features, plan_limits, plan_prices, price_plans,
       platform_audit_logs, platform_admin_sessions, platform_admin_users
     CASCADE`,
  );
}
