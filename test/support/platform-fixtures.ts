import {
  PlatformAdminStatus,
  PlatformRole,
} from '../../src/generated/prisma/enums.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { PasswordHasher } from '../../src/common/security/password-hasher.js';

const hasher = new PasswordHasher();

export async function createPlatformAdmin(
  prisma: PrismaClient,
  overrides: {
    email?: string;
    role?: PlatformRole;
    status?: PlatformAdminStatus;
    password?: string;
    mustChangePassword?: boolean;
  } = {},
) {
  return prisma.platformAdminUser.create({
    data: {
      email: overrides.email ?? `${crypto.randomUUID().slice(0, 8)}@test.lk`,
      fullName: 'Fixture Admin',
      role: overrides.role ?? PlatformRole.SUPER_ADMIN,
      status: overrides.status ?? PlatformAdminStatus.ACTIVE,
      passwordHash: await hasher.hash(
        overrides.password ?? 'Fixture-Password-1',
      ),
      mustChangePassword: overrides.mustChangePassword ?? false,
    },
  });
}
