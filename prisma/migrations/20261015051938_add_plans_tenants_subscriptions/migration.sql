-- CreateEnum
CREATE TYPE "PricePlanStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "BillingPeriod" AS ENUM ('MONTHLY', 'QUARTERLY', 'ANNUAL');

-- CreateEnum
CREATE TYPE "PlanPriceStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "PlanLimitCode" AS ENUM ('MAX_STAFF_USERS', 'MAX_BRANCHES', 'MAX_INSTRUCTORS', 'MAX_VEHICLES');

-- CreateEnum
CREATE TYPE "PlanFeatureCode" AS ENUM ('MULTI_BRANCH', 'SMS_NOTIFICATIONS', 'ADVANCED_REPORTING', 'API_ACCESS');

-- CreateEnum
CREATE TYPE "District" AS ENUM ('AMPARA', 'ANURADHAPURA', 'BADULLA', 'BATTICALOA', 'COLOMBO', 'GALLE', 'GAMPAHA', 'HAMBANTOTA', 'JAFFNA', 'KALUTARA', 'KANDY', 'KEGALLE', 'KILINOCHCHI', 'KURUNEGALA', 'MANNAR', 'MATALE', 'MATARA', 'MONARAGALA', 'MULLAITIVU', 'NUWARA_ELIYA', 'POLONNARUWA', 'PUTTALAM', 'RATNAPURA', 'TRINCOMALEE', 'VAVUNIYA');

-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "TenantSubscriptionStatus" AS ENUM ('SCHEDULED', 'ACTIVE', 'ENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TenantAccessStatus" AS ENUM ('ACTIVE', 'GRACE_PERIOD', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "TenantRole" AS ENUM ('OWNER', 'ADMIN', 'BRANCH_MANAGER', 'FRONT_DESK', 'INSTRUCTOR', 'ACCOUNTANT');

-- CreateEnum
CREATE TYPE "TenantUserStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateTable
CREATE TABLE "price_plans" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "PricePlanStatus" NOT NULL DEFAULT 'DRAFT',
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "price_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_prices" (
    "id" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "billingPeriod" "BillingPeriod" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "PlanPriceStatus" NOT NULL DEFAULT 'ACTIVE',
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plan_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_limits" (
    "id" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "code" "PlanLimitCode" NOT NULL,
    "value" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plan_limits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_features" (
    "id" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "code" "PlanFeatureCode" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_features_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "dsCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "district" "District" NOT NULL,
    "phone" TEXT NOT NULL,
    "status" "TenantStatus" NOT NULL DEFAULT 'ACTIVE',
    "closedAt" TIMESTAMP(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_subscriptions" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "planPriceId" UUID NOT NULL,
    "planCode" TEXT NOT NULL,
    "planName" TEXT NOT NULL,
    "billingPeriod" "BillingPeriod" NOT NULL,
    "listAmount" DECIMAL(12,2) NOT NULL,
    "agreedAmount" DECIMAL(12,2) NOT NULL,
    "discountReason" TEXT,
    "gracePeriodDays" INTEGER NOT NULL,
    "status" "TenantSubscriptionStatus" NOT NULL,
    "startDate" DATE NOT NULL,
    "trialEndDate" DATE,
    "endDate" DATE,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" UUID,
    "cancellationReason" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_access" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "status" "TenantAccessStatus" NOT NULL DEFAULT 'ACTIVE',
    "statusChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_access_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_users" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT,
    "nic" TEXT,
    "passwordHash" TEXT NOT NULL,
    "role" "TenantRole" NOT NULL,
    "status" "TenantUserStatus" NOT NULL DEFAULT 'ACTIVE',
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT true,
    "passwordChangedAt" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "disabledAt" TIMESTAMP(3),
    "createdByPlatformAdminId" UUID,
    "createdByTenantUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "price_plans_code_key" ON "price_plans"("code");

-- CreateIndex
CREATE INDEX "price_plans_status_sortOrder_idx" ON "price_plans"("status", "sortOrder");

-- CreateIndex
CREATE INDEX "plan_prices_planId_status_idx" ON "plan_prices"("planId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "plan_prices_planId_id_key" ON "plan_prices"("planId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "plan_limits_planId_code_key" ON "plan_limits"("planId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "plan_features_planId_code_key" ON "plan_features"("planId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_dsCode_key" ON "tenants"("dsCode");

-- CreateIndex
CREATE INDEX "tenants_status_idx" ON "tenants"("status");

-- CreateIndex
CREATE INDEX "tenants_district_idx" ON "tenants"("district");

-- CreateIndex
CREATE INDEX "tenant_subscriptions_tenantId_status_idx" ON "tenant_subscriptions"("tenantId", "status");

-- CreateIndex
CREATE INDEX "tenant_subscriptions_tenantId_startDate_idx" ON "tenant_subscriptions"("tenantId", "startDate");

-- CreateIndex
CREATE INDEX "tenant_subscriptions_planId_planPriceId_idx" ON "tenant_subscriptions"("planId", "planPriceId");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_access_tenantId_key" ON "tenant_access"("tenantId");

-- CreateIndex
CREATE INDEX "tenant_users_tenantId_role_status_idx" ON "tenant_users"("tenantId", "role", "status");

-- CreateIndex
CREATE INDEX "tenant_users_createdByPlatformAdminId_idx" ON "tenant_users"("createdByPlatformAdminId");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_users_tenantId_id_key" ON "tenant_users"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_users_tenantId_email_key" ON "tenant_users"("tenantId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_users_tenantId_nic_key" ON "tenant_users"("tenantId", "nic");

-- AddForeignKey
ALTER TABLE "price_plans" ADD CONSTRAINT "price_plans_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "platform_admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_prices" ADD CONSTRAINT "plan_prices_planId_fkey" FOREIGN KEY ("planId") REFERENCES "price_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_limits" ADD CONSTRAINT "plan_limits_planId_fkey" FOREIGN KEY ("planId") REFERENCES "price_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_features" ADD CONSTRAINT "plan_features_planId_fkey" FOREIGN KEY ("planId") REFERENCES "price_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "platform_admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_subscriptions" ADD CONSTRAINT "tenant_subscriptions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_subscriptions" ADD CONSTRAINT "tenant_subscriptions_planId_fkey" FOREIGN KEY ("planId") REFERENCES "price_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_subscriptions" ADD CONSTRAINT "tenant_subscriptions_planId_planPriceId_fkey" FOREIGN KEY ("planId", "planPriceId") REFERENCES "plan_prices"("planId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_subscriptions" ADD CONSTRAINT "tenant_subscriptions_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "platform_admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_subscriptions" ADD CONSTRAINT "tenant_subscriptions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "platform_admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_access" ADD CONSTRAINT "tenant_access_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_users" ADD CONSTRAINT "tenant_users_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_users" ADD CONSTRAINT "tenant_users_createdByPlatformAdminId_fkey" FOREIGN KEY ("createdByPlatformAdminId") REFERENCES "platform_admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_users" ADD CONSTRAINT "tenant_users_tenantId_createdByTenantUserId_fkey" FOREIGN KEY ("tenantId", "createdByTenantUserId") REFERENCES "tenant_users"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written (not expressible in Prisma schema) ---------------------------

-- price_plans ---------------------------------------------------------------
ALTER TABLE "price_plans" ADD CONSTRAINT "price_plans_code_format_chk"
  CHECK ("code" ~ '^[A-Z0-9_]+$');
ALTER TABLE "price_plans" ADD CONSTRAINT "price_plans_archived_chk"
  CHECK (("status" = 'ARCHIVED') = ("archivedAt" IS NOT NULL));

-- plan_prices ---------------------------------------------------------------
ALTER TABLE "plan_prices" ADD CONSTRAINT "plan_prices_amount_chk"
  CHECK ("amount" >= 0);
ALTER TABLE "plan_prices" ADD CONSTRAINT "plan_prices_archived_chk"
  CHECK (("status" = 'ARCHIVED') = ("archivedAt" IS NOT NULL));
-- At most one ACTIVE price per plan and billing period.
CREATE UNIQUE INDEX "plan_prices_one_active_per_period_key"
  ON "plan_prices"("planId", "billingPeriod")
  WHERE "status" = 'ACTIVE';

-- plan_limits ---------------------------------------------------------------
ALTER TABLE "plan_limits" ADD CONSTRAINT "plan_limits_value_chk"
  CHECK ("value" IS NULL OR "value" >= 0);

-- tenants -------------------------------------------------------------------
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_ds_code_normalised_chk"
  CHECK ("dsCode" = upper(btrim("dsCode")) AND "dsCode" <> '');
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_phone_format_chk"
  CHECK ("phone" ~ '^\+94[0-9]{9}$');
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_closed_chk"
  CHECK (("status" = 'CLOSED') = ("closedAt" IS NOT NULL));

-- tenant_subscriptions ------------------------------------------------------
ALTER TABLE "tenant_subscriptions" ADD CONSTRAINT "tenant_subscriptions_amounts_chk"
  CHECK ("listAmount" >= 0 AND "agreedAmount" >= 0);
-- A discount (or any deviation from list price) must be justified.
ALTER TABLE "tenant_subscriptions" ADD CONSTRAINT "tenant_subscriptions_discount_reason_chk"
  CHECK ("agreedAmount" = "listAmount" OR btrim(coalesce("discountReason", '')) <> '');
ALTER TABLE "tenant_subscriptions" ADD CONSTRAINT "tenant_subscriptions_grace_chk"
  CHECK ("gracePeriodDays" >= 0);
ALTER TABLE "tenant_subscriptions" ADD CONSTRAINT "tenant_subscriptions_trial_chk"
  CHECK ("trialEndDate" IS NULL OR "trialEndDate" >= "startDate");
ALTER TABLE "tenant_subscriptions" ADD CONSTRAINT "tenant_subscriptions_end_chk"
  CHECK ("endDate" IS NULL OR "endDate" >= "startDate");
ALTER TABLE "tenant_subscriptions" ADD CONSTRAINT "tenant_subscriptions_ended_chk"
  CHECK ("status" <> 'ENDED' OR "endDate" IS NOT NULL);
ALTER TABLE "tenant_subscriptions" ADD CONSTRAINT "tenant_subscriptions_cancelled_chk"
  CHECK (("status" = 'CANCELLED') = ("cancelledAt" IS NOT NULL)
     AND ("cancelledAt" IS NULL) = ("cancelledById" IS NULL));
-- At most one current and one scheduled subscription per tenant.
CREATE UNIQUE INDEX "tenant_subscriptions_one_active_per_tenant_key"
  ON "tenant_subscriptions"("tenantId") WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "tenant_subscriptions_one_scheduled_per_tenant_key"
  ON "tenant_subscriptions"("tenantId") WHERE "status" = 'SCHEDULED';

-- tenant_users --------------------------------------------------------------
ALTER TABLE "tenant_users" ADD CONSTRAINT "tenant_users_email_normalised_chk"
  CHECK ("email" = lower(btrim("email")));
ALTER TABLE "tenant_users" ADD CONSTRAINT "tenant_users_phone_format_chk"
  CHECK ("phone" IS NULL OR "phone" ~ '^\+94[0-9]{9}$');
ALTER TABLE "tenant_users" ADD CONSTRAINT "tenant_users_nic_format_chk"
  CHECK ("nic" IS NULL OR "nic" ~ '^([0-9]{9}[VX]|[0-9]{12})$');
ALTER TABLE "tenant_users" ADD CONSTRAINT "tenant_users_disabled_chk"
  CHECK (("status" = 'DISABLED') = ("disabledAt" IS NOT NULL));
ALTER TABLE "tenant_users" ADD CONSTRAINT "tenant_users_single_creator_chk"
  CHECK (num_nonnulls("createdByPlatformAdminId", "createdByTenantUserId") = 1);
-- An OWNER must have the contact/identity details platform admins collect.
ALTER TABLE "tenant_users" ADD CONSTRAINT "tenant_users_owner_details_chk"
  CHECK ("role" <> 'OWNER' OR ("phone" IS NOT NULL AND "nic" IS NOT NULL));
-- Exactly one OWNER per tenant.
CREATE UNIQUE INDEX "tenant_users_one_owner_per_tenant_key"
  ON "tenant_users"("tenantId") WHERE "role" = 'OWNER';
