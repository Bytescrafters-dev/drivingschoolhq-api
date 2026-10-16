-- CreateEnum
CREATE TYPE "TenantSessionRevokedReason" AS ENUM ('LOGOUT', 'ROTATED', 'PASSWORD_CHANGED', 'PASSWORD_RESET', 'USER_DISABLED', 'EMAIL_CHANGED', 'TENANT_CLOSED', 'REFRESH_TOKEN_REUSE');

-- CreateTable
CREATE TABLE "tenant_user_sessions" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" "TenantSessionRevokedReason",
    "replacedById" UUID,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_audit_logs" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "actorTenantUserId" UUID,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_user_sessions_refreshTokenHash_key" ON "tenant_user_sessions"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "tenant_user_sessions_userId_revokedAt_idx" ON "tenant_user_sessions"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "tenant_user_sessions_tenantId_revokedAt_idx" ON "tenant_user_sessions"("tenantId", "revokedAt");

-- CreateIndex
CREATE INDEX "tenant_audit_logs_tenantId_createdAt_idx" ON "tenant_audit_logs"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "tenant_audit_logs_tenantId_actorTenantUserId_createdAt_idx" ON "tenant_audit_logs"("tenantId", "actorTenantUserId", "createdAt");

-- CreateIndex
CREATE INDEX "tenant_audit_logs_tenantId_targetType_targetId_createdAt_idx" ON "tenant_audit_logs"("tenantId", "targetType", "targetId", "createdAt");

-- AddForeignKey
ALTER TABLE "tenant_user_sessions" ADD CONSTRAINT "tenant_user_sessions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_user_sessions" ADD CONSTRAINT "tenant_user_sessions_tenantId_userId_fkey" FOREIGN KEY ("tenantId", "userId") REFERENCES "tenant_users"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_audit_logs" ADD CONSTRAINT "tenant_audit_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_audit_logs" ADD CONSTRAINT "tenant_audit_logs_tenantId_actorTenantUserId_fkey" FOREIGN KEY ("tenantId", "actorTenantUserId") REFERENCES "tenant_users"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written (not expressible in Prisma schema) ---------------------------

-- A session is revoked exactly when it has a revocation reason.
ALTER TABLE "tenant_user_sessions" ADD CONSTRAINT "tenant_user_sessions_revocation_chk"
  CHECK (("revokedAt" IS NULL) = ("revokedReason" IS NULL));

-- Tenant audit log is append-only: reject UPDATE and DELETE on any row.
CREATE FUNCTION tenant_audit_logs_prevent_modification() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'tenant_audit_logs is append-only (% rejected)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tenant_audit_logs_append_only
  BEFORE UPDATE OR DELETE ON "tenant_audit_logs"
  FOR EACH ROW EXECUTE FUNCTION tenant_audit_logs_prevent_modification();
