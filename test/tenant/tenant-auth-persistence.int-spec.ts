import { Test, type TestingModule } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.js';
import { PasswordHasher } from '../../src/common/security/password-hasher.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { TenantRole } from '../../src/generated/prisma/enums.js';
import { TenantOwnerAdminService } from '../../src/platform/tenants/tenant-owner-admin.service.js';
import { TenantsService } from '../../src/platform/tenants/tenants.service.js';
import { TenantAuthService } from '../../src/tenant/auth/tenant-auth.service.js';
import { createTestPrisma, resetDatabase } from '../support/database.js';
import { META, actorFrom } from '../support/fakes.js';
import { createPlatformAdmin } from '../support/platform-fixtures.js';
import { createTenant, createTenantUser } from '../support/tenancy-fixtures.js';

const PASSWORD = 'Owner-Real-Pass-1';

describe('Tenant auth persistence (real database)', () => {
  let prisma: PrismaClient;
  let moduleRef: TestingModule;
  let auth: TenantAuthService;

  beforeAll(async () => {
    prisma = createTestPrisma();
    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    await moduleRef.init();
    auth = moduleRef.get(TenantAuthService);
  });

  afterAll(async () => {
    await moduleRef.close();
    await prisma.$disconnect();
  });

  beforeEach(() => resetDatabase(prisma));

  async function school(dsCode: string) {
    const admin = await createPlatformAdmin(prisma);
    const tenant = await createTenant(prisma, admin.id, { dsCode });
    const owner = await createTenantUser(prisma, {
      tenantId: tenant.id,
      role: TenantRole.OWNER,
      email: 'owner@school.lk',
      createdByPlatformAdminId: admin.id,
    });
    await prisma.tenantUser.update({
      where: { id: owner.id },
      data: {
        passwordHash: await new PasswordHasher().hash(PASSWORD),
        mustChangePassword: false,
      },
    });
    await prisma.tenantAccess.create({ data: { tenantId: tenant.id } });
    return { admin, tenant, owner };
  }

  it("rejects sessions and audit entries that point at another tenant's user", async () => {
    const a = await school('DS101');
    const b = await school('DS102');

    await expect(
      prisma.tenantUserSession.create({
        data: {
          tenantId: b.tenant.id,
          userId: a.owner.id,
          refreshTokenHash: 'x',
          expiresAt: new Date(Date.now() + 1000),
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.tenantAuditLog.create({
        data: {
          tenantId: b.tenant.id,
          actorTenantUserId: a.owner.id,
          action: 'LOGIN_SUCCEEDED',
        },
      }),
    ).rejects.toThrow();
  });

  it('keeps the tenant audit log append-only', async () => {
    const { tenant } = await school('DS101');
    const entry = await prisma.tenantAuditLog.create({
      data: { tenantId: tenant.id, action: 'LOGIN_FAILED' },
    });
    await expect(
      prisma.tenantAuditLog.update({
        where: { id: entry.id },
        data: { action: 'TAMPERED' },
      }),
    ).rejects.toThrow(/append-only/);
    await expect(
      prisma.tenantAuditLog.delete({ where: { id: entry.id } }),
    ).rejects.toThrow(/append-only/);
  });

  it('lets exactly one of two concurrent refreshes of the same token win', async () => {
    await school('DS101');
    const tokens = await auth.login('DS101', 'owner@school.lk', PASSWORD, META);

    const results = await Promise.allSettled([
      auth.refresh(tokens.refreshToken, META),
      auth.refresh(tokens.refreshToken, META),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      await prisma.tenantUserSession.count({ where: { revokedAt: null } }),
    ).toBe(1);
  });

  it('ends owner sessions on platform password reset, disable and tenant close', async () => {
    const { admin, tenant, owner } = await school('DS101');
    const actor = actorFrom(admin);
    const owners = moduleRef.get(TenantOwnerAdminService);
    const tenants = moduleRef.get(TenantsService);
    const active = () =>
      prisma.tenantUserSession.findMany({
        where: { userId: owner.id, revokedAt: null },
      });
    const lastReason = async () =>
      (
        await prisma.tenantUserSession.findFirstOrThrow({
          where: { userId: owner.id },
          orderBy: { createdAt: 'desc' },
        })
      ).revokedReason;

    await auth.login('DS101', 'owner@school.lk', PASSWORD, META);
    await owners.resetPassword(actor, tenant.id, 'Reset-Temp-Pass-1', META);
    expect(await active()).toHaveLength(0);
    expect(await lastReason()).toBe('PASSWORD_RESET');

    await auth.login('DS101', 'owner@school.lk', 'Reset-Temp-Pass-1', META);
    await owners.disable(actor, tenant.id, META);
    expect(await lastReason()).toBe('USER_DISABLED');
    await owners.enable(actor, tenant.id, META);

    await auth.login('DS101', 'owner@school.lk', 'Reset-Temp-Pass-1', META);
    await tenants.close(actor, tenant.id, 'Closing', META);
    expect(await active()).toHaveLength(0);
    expect(await lastReason()).toBe('TENANT_CLOSED');
  });
});
