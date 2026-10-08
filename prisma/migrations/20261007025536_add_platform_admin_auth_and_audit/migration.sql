/*
  Warnings:

  - You are about to drop the column `tokenVersion` on the `platform_admin_users` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "PlatformSessionRevokedReason" AS ENUM ('LOGOUT', 'ROTATED', 'PASSWORD_CHANGED', 'PASSWORD_RESET', 'ROLE_CHANGED', 'ADMIN_DISABLED', 'REFRESH_TOKEN_REUSE');

-- AlterTable
ALTER TABLE "platform_admin_users" DROP COLUMN "tokenVersion";

-- CreateTable
CREATE TABLE "platform_admin_sessions" (
    "id" UUID NOT NULL,
    "adminId" UUID NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" "PlatformSessionRevokedReason",
    "replacedById" UUID,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_admin_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_audit_logs" (
    "id" UUID NOT NULL,
    "actorAdminId" UUID,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_admin_sessions_refreshTokenHash_key" ON "platform_admin_sessions"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "platform_admin_sessions_adminId_revokedAt_idx" ON "platform_admin_sessions"("adminId", "revokedAt");

-- CreateIndex
CREATE INDEX "platform_audit_logs_createdAt_idx" ON "platform_audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "platform_audit_logs_actorAdminId_createdAt_idx" ON "platform_audit_logs"("actorAdminId", "createdAt");

-- CreateIndex
CREATE INDEX "platform_audit_logs_targetType_targetId_createdAt_idx" ON "platform_audit_logs"("targetType", "targetId", "createdAt");

-- CreateIndex
CREATE INDEX "platform_audit_logs_action_createdAt_idx" ON "platform_audit_logs"("action", "createdAt");

-- AddForeignKey
ALTER TABLE "platform_admin_sessions" ADD CONSTRAINT "platform_admin_sessions_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "platform_admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_audit_logs" ADD CONSTRAINT "platform_audit_logs_actorAdminId_fkey" FOREIGN KEY ("actorAdminId") REFERENCES "platform_admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written (not expressible in Prisma schema) ---------------------------

-- A session is revoked exactly when it has a revocation reason.
ALTER TABLE "platform_admin_sessions" ADD CONSTRAINT "platform_admin_sessions_revocation_chk"
  CHECK (("revokedAt" IS NULL) = ("revokedReason" IS NULL));

-- Platform audit log is append-only: reject UPDATE and DELETE on any row.
CREATE FUNCTION platform_audit_logs_prevent_modification() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'platform_audit_logs is append-only (% rejected)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER platform_audit_logs_append_only
  BEFORE UPDATE OR DELETE ON "platform_audit_logs"
  FOR EACH ROW EXECUTE FUNCTION platform_audit_logs_prevent_modification();
