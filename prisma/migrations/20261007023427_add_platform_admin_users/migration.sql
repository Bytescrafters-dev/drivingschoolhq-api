-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('SUPER_ADMIN', 'OPERATIONS_ADMIN', 'BILLING_ADMIN', 'SUPPORT');

-- CreateEnum
CREATE TYPE "PlatformAdminStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateTable
CREATE TABLE "platform_admin_users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "PlatformRole" NOT NULL,
    "status" "PlatformAdminStatus" NOT NULL DEFAULT 'ACTIVE',
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT true,
    "passwordChangedAt" TIMESTAMP(3),
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "lastLoginAt" TIMESTAMP(3),
    "disabledAt" TIMESTAMP(3),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_admin_users_email_key" ON "platform_admin_users"("email");

-- CreateIndex
CREATE INDEX "platform_admin_users_role_status_idx" ON "platform_admin_users"("role", "status");

-- CreateIndex
CREATE INDEX "platform_admin_users_createdById_idx" ON "platform_admin_users"("createdById");

-- AddForeignKey
ALTER TABLE "platform_admin_users" ADD CONSTRAINT "platform_admin_users_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "platform_admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Enforce normalised emails so the unique index is effectively case-insensitive.
-- (Hand-written: Prisma schema cannot express CHECK constraints.)
ALTER TABLE "platform_admin_users" ADD CONSTRAINT "platform_admin_users_email_normalised_chk" CHECK ("email" = lower(btrim("email")));
