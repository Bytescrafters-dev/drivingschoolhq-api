-- CreateEnum
CREATE TYPE "TenantUserBranchAccess" AS ENUM ('ALL', 'SELECTED');

-- CreateEnum
CREATE TYPE "BranchStatus" AS ENUM ('ACTIVE', 'CLOSED');

-- MULTI_BRANCH is dropped: MAX_BRANCHES alone decides how many branches a
-- plan allows. Remove plan rows that still grant it before narrowing the enum.
DELETE FROM "plan_features" WHERE "code" = 'MULTI_BRANCH';

-- AlterEnum
BEGIN;
CREATE TYPE "PlanFeatureCode_new" AS ENUM ('SMS_NOTIFICATIONS', 'ADVANCED_REPORTING', 'API_ACCESS');
ALTER TABLE "plan_features" ALTER COLUMN "code" TYPE "PlanFeatureCode_new" USING ("code"::text::"PlanFeatureCode_new");
ALTER TYPE "PlanFeatureCode" RENAME TO "PlanFeatureCode_old";
ALTER TYPE "PlanFeatureCode_new" RENAME TO "PlanFeatureCode";
DROP TYPE "public"."PlanFeatureCode_old";
COMMIT;

-- AlterTable
ALTER TABLE "tenant_audit_logs" ADD COLUMN     "branchId" UUID;

-- AlterTable
ALTER TABLE "tenant_users" ADD COLUMN     "branchAccess" "TenantUserBranchAccess" NOT NULL DEFAULT 'SELECTED',
ADD COLUMN     "defaultBranchId" UUID;

-- CreateTable
CREATE TABLE "branches" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "district" "District" NOT NULL,
    "phone" TEXT NOT NULL,
    "status" "BranchStatus" NOT NULL DEFAULT 'ACTIVE',
    "closedAt" TIMESTAMP(3),
    "createdByPlatformAdminId" UUID,
    "createdByTenantUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_user_branches" (
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_user_branches_pkey" PRIMARY KEY ("userId","branchId")
);

-- CreateIndex
CREATE INDEX "branches_tenantId_status_idx" ON "branches"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "branches_tenantId_id_key" ON "branches"("tenantId", "id");

-- CreateIndex
CREATE INDEX "tenant_user_branches_tenantId_branchId_idx" ON "tenant_user_branches"("tenantId", "branchId");

-- CreateIndex
CREATE INDEX "tenant_audit_logs_tenantId_branchId_createdAt_idx" ON "tenant_audit_logs"("tenantId", "branchId", "createdAt");

-- CreateIndex
CREATE INDEX "tenant_users_tenantId_defaultBranchId_idx" ON "tenant_users"("tenantId", "defaultBranchId");

-- AddForeignKey
ALTER TABLE "tenant_users" ADD CONSTRAINT "tenant_users_tenantId_defaultBranchId_fkey" FOREIGN KEY ("tenantId", "defaultBranchId") REFERENCES "branches"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_createdByPlatformAdminId_fkey" FOREIGN KEY ("createdByPlatformAdminId") REFERENCES "platform_admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_tenantId_createdByTenantUserId_fkey" FOREIGN KEY ("tenantId", "createdByTenantUserId") REFERENCES "tenant_users"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_user_branches" ADD CONSTRAINT "tenant_user_branches_tenantId_userId_fkey" FOREIGN KEY ("tenantId", "userId") REFERENCES "tenant_users"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_user_branches" ADD CONSTRAINT "tenant_user_branches_tenantId_branchId_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "branches"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_audit_logs" ADD CONSTRAINT "tenant_audit_logs_tenantId_branchId_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "branches"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- -----------------------------------------------------------------------------
-- Hand-written constraints
-- -----------------------------------------------------------------------------

ALTER TABLE "branches" ADD CONSTRAINT "branches_name_chk"
  CHECK ("name" = btrim("name") AND "name" <> '');
ALTER TABLE "branches" ADD CONSTRAINT "branches_phone_format_chk"
  CHECK ("phone" ~ '^\+94[0-9]{9}$');
ALTER TABLE "branches" ADD CONSTRAINT "branches_closed_chk"
  CHECK (("status" = 'CLOSED') = ("closedAt" IS NOT NULL));
ALTER TABLE "branches" ADD CONSTRAINT "branches_single_creator_chk"
  CHECK (num_nonnulls("createdByPlatformAdminId", "createdByTenantUserId") = 1);

-- Branch names are unique within a tenant, ignoring case.
CREATE UNIQUE INDEX "branches_tenantId_lower_name_key"
  ON "branches" ("tenantId", lower("name"));

-- -----------------------------------------------------------------------------
-- Backfill: every existing tenant gets its "Main Branch" (from the tenant
-- profile, created by the admin who created the tenant). Every user gets it as
-- default branch; the OWNER gets ALL access, other users are assigned to it.
-- -----------------------------------------------------------------------------

INSERT INTO "branches" ("id", "tenantId", "name", "address", "district", "phone",
                        "createdByPlatformAdminId", "updatedAt")
SELECT gen_random_uuid(), t."id", 'Main Branch', t."address", t."district", t."phone",
       t."createdById", CURRENT_TIMESTAMP
FROM "tenants" t;

UPDATE "tenant_users" u
SET "defaultBranchId" = b."id"
FROM "branches" b
WHERE b."tenantId" = u."tenantId";

UPDATE "tenant_users" SET "branchAccess" = 'ALL' WHERE "role" = 'OWNER';

INSERT INTO "tenant_user_branches" ("tenantId", "userId", "branchId")
SELECT u."tenantId", u."id", u."defaultBranchId"
FROM "tenant_users" u
WHERE u."branchAccess" = 'SELECTED';

ALTER TABLE "tenant_users" ALTER COLUMN "defaultBranchId" SET NOT NULL;

-- The OWNER always works across all branches.
ALTER TABLE "tenant_users" ADD CONSTRAINT "tenant_users_owner_all_branches_chk"
  CHECK ("role" <> 'OWNER' OR "branchAccess" = 'ALL');

-- Platform audit entries about a branch must name the tenant as well.
ALTER TABLE "platform_audit_logs" DROP CONSTRAINT "platform_audit_logs_tenant_target_chk";
ALTER TABLE "platform_audit_logs" ADD CONSTRAINT "platform_audit_logs_tenant_target_chk"
  CHECK (
    "targetType" IS NULL
    OR "targetType" NOT IN ('TENANT', 'TENANT_SUBSCRIPTION', 'TENANT_USER', 'BRANCH')
    OR "tenantId" IS NOT NULL
  );
