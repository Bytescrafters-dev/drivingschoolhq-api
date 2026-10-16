import { Test, type TestingModule } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { TenantRole } from '../../src/generated/prisma/enums.js';
import { PLATFORM_AUDIT_REPOSITORY } from '../../src/platform/audit/interfaces/platform-audit.repository.js';
import { TenantOwnerAdminService } from '../../src/platform/tenants/tenant-owner-admin.service.js';
import { createTestPrisma, resetDatabase } from '../support/database.js';
import { META, actorFrom } from '../support/fakes.js';
import { createPlatformAdmin } from '../support/platform-fixtures.js';
import { createTenant, createTenantUser } from '../support/tenancy-fixtures.js';

describe('Tenant owner management (real database)', () => {
  let prisma: PrismaClient;
  let moduleRef: TestingModule;
  let service: TenantOwnerAdminService;

  beforeAll(async () => {
    prisma = createTestPrisma();
    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    await moduleRef.init();
    service = moduleRef.get(TenantOwnerAdminService);
  });

  afterAll(async () => {
    await moduleRef.close();
    await prisma.$disconnect();
  });

  beforeEach(() => resetDatabase(prisma));

  async function schoolWithOwnerAndStaff() {
    const admin = await createPlatformAdmin(prisma);
    const tenant = await createTenant(prisma, admin.id);
    const owner = await createTenantUser(prisma, {
      tenantId: tenant.id,
      role: TenantRole.OWNER,
      email: 'owner@school.lk',
      nic: '199012345678',
      createdByPlatformAdminId: admin.id,
    });
    const staff = await createTenantUser(prisma, {
      tenantId: tenant.id,
      email: 'staff@school.lk',
      nic: '901234567V',
      createdByTenantUserId: owner.id,
    });
    return { actor: actorFrom(admin), admin, tenant, owner, staff };
  }

  it('maps email and NIC conflicts within the tenant to specific codes', async () => {
    const { actor, tenant } = await schoolWithOwnerAndStaff();
    await expect(
      service.updateProfile(
        actor,
        tenant.id,
        { email: 'staff@school.lk' },
        META,
      ),
    ).rejects.toMatchObject({ code: 'TENANT_USER_EMAIL_TAKEN' });
    await expect(
      service.updateProfile(actor, tenant.id, { nic: '901234567v' }, META),
    ).rejects.toMatchObject({ code: 'TENANT_USER_NIC_TAKEN' });
  });

  it('allows an email or NIC already used in another tenant', async () => {
    const { actor, tenant } = await schoolWithOwnerAndStaff();
    const other = await schoolWithOwnerAndStaff();

    const updated = await service.updateProfile(
      actor,
      tenant.id,
      { email: 'other-owner@school.lk' },
      META,
    );
    expect(updated.email).toBe('other-owner@school.lk');
    await expect(
      service.updateProfile(
        other.actor,
        other.tenant.id,
        { email: 'other-owner@school.lk', nic: '199012345678' },
        META,
      ),
    ).resolves.toMatchObject({ email: 'other-owner@school.lk' });
  });

  it('only ever changes the OWNER row of the given tenant', async () => {
    const a = await schoolWithOwnerAndStaff();
    const b = await schoolWithOwnerAndStaff();

    await service.disable(a.actor, a.tenant.id, META);
    await service.resetPassword(a.actor, a.tenant.id, 'Brand-New-Pass-1', META);

    const rows = await prisma.tenantUser.findMany();
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(a.owner.id)).toMatchObject({
      status: 'DISABLED',
      mustChangePassword: true,
    });
    expect(byId.get(a.owner.id)!.passwordHash).toMatch(/^\$argon2id\$/);
    for (const untouched of [a.staff, b.owner, b.staff]) {
      expect(byId.get(untouched.id)).toMatchObject({
        status: 'ACTIVE',
        passwordHash: untouched.passwordHash,
      });
    }
  });

  it('rolls back the change when the audit write fails', async () => {
    const { actor, tenant, owner } = await schoolWithOwnerAndStaff();
    const failing = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PLATFORM_AUDIT_REPOSITORY)
      .useValue({
        append: async () => {
          throw new Error('audit store unavailable');
        },
        listNewestFirst: async () => [],
      })
      .compile();
    await failing.init();
    try {
      await expect(
        failing.get(TenantOwnerAdminService).disable(actor, tenant.id, META),
      ).rejects.toThrow('audit store unavailable');
    } finally {
      await failing.close();
    }
    expect(
      (await prisma.tenantUser.findUniqueOrThrow({ where: { id: owner.id } }))
        .status,
    ).toBe('ACTIVE');
  });
});
