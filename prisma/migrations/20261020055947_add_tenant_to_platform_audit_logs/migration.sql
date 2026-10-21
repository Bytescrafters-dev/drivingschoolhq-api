-- AlterTable
ALTER TABLE "platform_audit_logs" ADD COLUMN     "tenantId" UUID;

-- CreateIndex
CREATE INDEX "platform_audit_logs_tenantId_createdAt_idx" ON "platform_audit_logs"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "platform_audit_logs" ADD CONSTRAINT "platform_audit_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill tenantId for existing tenant-related entries. Only the new column is
-- written; the append-only trigger is suspended for this one-off statement.
ALTER TABLE "platform_audit_logs" DISABLE TRIGGER platform_audit_logs_append_only;

UPDATE "platform_audit_logs" a
SET "tenantId" = t."id"
FROM "tenants" t
WHERE a."tenantId" IS NULL
  AND (
    (a."targetType" = 'TENANT' AND a."targetId" = t."id"::text)
    OR (
      a."targetType" IN ('TENANT_SUBSCRIPTION', 'TENANT_USER')
      AND a."metadata" ->> 'tenantId' = t."id"::text
    )
  );

ALTER TABLE "platform_audit_logs" ENABLE TRIGGER platform_audit_logs_append_only;

-- Every entry about a tenant, its subscriptions or its users names the tenant,
-- so filtering by tenant can never miss one.
ALTER TABLE "platform_audit_logs" ADD CONSTRAINT "platform_audit_logs_tenant_target_chk"
  CHECK (
    "targetType" IS NULL
    OR "targetType" NOT IN ('TENANT', 'TENANT_SUBSCRIPTION', 'TENANT_USER')
    OR "tenantId" IS NOT NULL
  );
