/**
 * Seeds the bootstrap platform SUPER_ADMIN.
 *
 * Idempotent: if a platform admin with the configured email already exists,
 * nothing is changed (password and role are never overwritten).
 *
 * Required env vars:
 *   SEED_SUPER_ADMIN_EMAIL
 *   SEED_SUPER_ADMIN_NAME
 *   SEED_SUPER_ADMIN_PASSWORD  (temporary; must be changed on first login)
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  PlatformAdminStatus,
  PlatformRole,
  PrismaClient,
} from '../src/generated/prisma/client.js';
import { PasswordHasher } from '../src/common/security/password-hasher.js';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from '../src/common/security/password-policy.js';
import { normalizeEmail } from '../src/common/text/email.js';

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function seedSuperAdmin(prisma: PrismaClient): Promise<void> {
  const email = normalizeEmail(requireEnv('SEED_SUPER_ADMIN_EMAIL'));
  const fullName = requireEnv('SEED_SUPER_ADMIN_NAME');
  const password = requireEnv('SEED_SUPER_ADMIN_PASSWORD');

  if (
    password.length < PASSWORD_MIN_LENGTH ||
    password.length > PASSWORD_MAX_LENGTH
  ) {
    throw new Error(
      `SEED_SUPER_ADMIN_PASSWORD must be ${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} characters`,
    );
  }

  const existing = await prisma.platformAdminUser.findUnique({
    where: { email },
    select: { id: true },
  });
  if (existing) {
    console.log(`Platform super admin already exists (${email}); skipping.`);
    return;
  }

  const passwordHash = await new PasswordHasher().hash(password);

  await prisma.platformAdminUser.create({
    data: {
      email,
      fullName,
      passwordHash,
      role: PlatformRole.SUPER_ADMIN,
      status: PlatformAdminStatus.ACTIVE,
      mustChangePassword: true,
    },
  });
  console.log(`Created platform super admin (${email}).`);
}

async function main(): Promise<void> {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  try {
    await seedSuperAdmin(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
