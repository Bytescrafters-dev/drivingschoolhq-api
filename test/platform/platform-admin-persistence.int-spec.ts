import { Test, type TestingModule } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.js';
import { AppError } from '../../src/common/errors/app-error.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import {
  PlatformAdminStatus,
  PlatformRole,
} from '../../src/generated/prisma/enums.js';
import { PlatformAdminsService } from '../../src/platform/admin-users/platform-admins.service.js';
import {
  PLATFORM_ADMIN_USER_REPOSITORY,
  type PlatformAdminUserRepository,
} from '../../src/platform/admin-users/interfaces/platform-admin-user.repository.js';
import { PLATFORM_AUDIT_REPOSITORY } from '../../src/platform/audit/interfaces/platform-audit.repository.js';
import { createTestPrisma, resetDatabase } from '../support/database.js';
import { META, actorFrom } from '../support/fakes.js';
import { createPlatformAdmin } from '../support/platform-fixtures.js';

describe('Platform admin persistence (real database)', () => {
  let prisma: PrismaClient;
  let moduleRef: TestingModule;
  let service: PlatformAdminsService;

  beforeAll(async () => {
    prisma = createTestPrisma();
    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    await moduleRef.init();
    service = moduleRef.get(PlatformAdminsService);
  });

  afterAll(async () => {
    await moduleRef.close();
    await prisma.$disconnect();
  });

  beforeEach(() => resetDatabase(prisma));

  it('keeps at least one active super admin when two super admins disable each other concurrently', async () => {
    const a = await createPlatformAdmin(prisma, {
      role: PlatformRole.SUPER_ADMIN,
    });
    const b = await createPlatformAdmin(prisma, {
      role: PlatformRole.SUPER_ADMIN,
    });

    const results = await Promise.allSettled([
      service.disable(actorFrom(a), b.id, META),
      service.disable(actorFrom(b), a.id, META),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBeInstanceOf(AppError);
    expect((rejected[0]!.reason as AppError).code).toBe(
      'PLATFORM_PERMISSION_DENIED',
    );

    const activeSuperAdmins = await prisma.platformAdminUser.count({
      where: {
        role: PlatformRole.SUPER_ADMIN,
        status: PlatformAdminStatus.ACTIVE,
      },
    });
    expect(activeSuperAdmins).toBe(1);
    expect(
      await prisma.platformAuditLog.count({
        where: { action: 'ADMIN_DISABLED' },
      }),
    ).toBe(1);
  });

  it('keeps at least one active super admin when two super admins demote each other concurrently', async () => {
    const a = await createPlatformAdmin(prisma, {
      role: PlatformRole.SUPER_ADMIN,
    });
    const b = await createPlatformAdmin(prisma, {
      role: PlatformRole.SUPER_ADMIN,
    });

    await Promise.allSettled([
      service.changeRole(actorFrom(a), b.id, PlatformRole.SUPPORT, META),
      service.changeRole(actorFrom(b), a.id, PlatformRole.SUPPORT, META),
    ]);

    expect(
      await prisma.platformAdminUser.count({
        where: {
          role: PlatformRole.SUPER_ADMIN,
          status: PlatformAdminStatus.ACTIVE,
        },
      }),
    ).toBe(1);
  });

  it('rolls back the admin change when writing the audit entry fails', async () => {
    const failingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PLATFORM_AUDIT_REPOSITORY)
      .useValue({
        append: async () => {
          throw new Error('audit store unavailable');
        },
        listNewestFirst: async () => [],
      })
      .compile();
    await failingModule.init();
    try {
      const actor = await createPlatformAdmin(prisma);
      const target = await createPlatformAdmin(prisma, {
        role: PlatformRole.SUPPORT,
      });
      const failingService = failingModule.get(PlatformAdminsService);

      await expect(
        failingService.createAdmin(
          actorFrom(actor),
          {
            email: 'rollback@test.lk',
            fullName: 'Rollback',
            role: PlatformRole.SUPPORT,
            temporaryPassword: 'Temp-Password-1',
          },
          META,
        ),
      ).rejects.toThrow('audit store unavailable');
      await expect(
        failingService.disable(actorFrom(actor), target.id, META),
      ).rejects.toThrow();

      expect(
        await prisma.platformAdminUser.findUnique({
          where: { email: 'rollback@test.lk' },
        }),
      ).toBeNull();
      expect(
        (
          await prisma.platformAdminUser.findUniqueOrThrow({
            where: { id: target.id },
          })
        ).status,
      ).toBe(PlatformAdminStatus.ACTIVE);
    } finally {
      await failingModule.close();
    }
  });

  it('rejects UPDATE and DELETE on audit log rows', async () => {
    const admin = await createPlatformAdmin(prisma);
    const entry = await prisma.platformAuditLog.create({
      data: { actorAdminId: admin.id, action: 'ADMIN_CREATED' },
    });

    await expect(
      prisma.platformAuditLog.update({
        where: { id: entry.id },
        data: { action: 'TAMPERED' },
      }),
    ).rejects.toThrow(/append-only/);
    await expect(
      prisma.platformAuditLog.delete({ where: { id: entry.id } }),
    ).rejects.toThrow(/append-only/);
    expect(
      (
        await prisma.platformAuditLog.findUniqueOrThrow({
          where: { id: entry.id },
        })
      ).action,
    ).toBe('ADMIN_CREATED');
  });

  it('rejects non-normalised emails at the database level', async () => {
    await expect(
      createPlatformAdmin(prisma, { email: 'Mixed@Test.lk' }),
    ).rejects.toThrow(/platform_admin_users_email_normalised_chk/);
  });

  it('maps duplicate emails to PLATFORM_ADMIN_EMAIL_TAKEN', async () => {
    const existing = await createPlatformAdmin(prisma, {
      email: 'dup@test.lk',
    });
    const repository = moduleRef.get<PlatformAdminUserRepository>(
      PLATFORM_ADMIN_USER_REPOSITORY,
    );

    await expect(
      repository.create({
        email: 'dup@test.lk',
        fullName: 'Dup',
        role: PlatformRole.SUPPORT,
        passwordHash: 'x',
        createdById: existing.id,
      }),
    ).rejects.toMatchObject({ code: 'PLATFORM_ADMIN_EMAIL_TAKEN' });
  });
});
