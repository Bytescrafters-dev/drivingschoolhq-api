-- Vehicle classes (DMT reference data), driving-school grades and the branch
-- profile (licence history + offered classes). Additive only.

-- CreateEnum
CREATE TYPE "DrivingSchoolGrade" AS ENUM ('A', 'B', 'C');

-- AlterTable
ALTER TABLE "branches" ADD COLUMN     "currentLicenceId" UUID;

-- CreateTable
CREATE TABLE "vehicle_classes" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_classes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driving_school_grade_vehicle_classes" (
    "grade" "DrivingSchoolGrade" NOT NULL,
    "vehicleClassId" UUID NOT NULL,

    CONSTRAINT "driving_school_grade_vehicle_classes_pkey" PRIMARY KEY ("grade","vehicleClassId")
);

-- CreateTable
CREATE TABLE "branch_school_licences" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "licenceNumber" TEXT NOT NULL,
    "grade" "DrivingSchoolGrade" NOT NULL,
    "issuedOn" DATE NOT NULL,
    "expiresOn" DATE NOT NULL,
    "recordedByTenantUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "branch_school_licences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch_vehicle_classes" (
    "tenantId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "vehicleClassId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "branch_vehicle_classes_pkey" PRIMARY KEY ("branchId","vehicleClassId")
);

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_classes_code_key" ON "vehicle_classes"("code");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_classes_sortOrder_key" ON "vehicle_classes"("sortOrder");

-- CreateIndex
CREATE INDEX "driving_school_grade_vehicle_classes_vehicleClassId_idx" ON "driving_school_grade_vehicle_classes"("vehicleClassId");

-- CreateIndex
CREATE INDEX "branch_school_licences_tenantId_branchId_createdAt_idx" ON "branch_school_licences"("tenantId", "branchId", "createdAt");

-- CreateIndex
CREATE INDEX "branch_school_licences_tenantId_recordedByTenantUserId_idx" ON "branch_school_licences"("tenantId", "recordedByTenantUserId");

-- CreateIndex
CREATE UNIQUE INDEX "branch_school_licences_tenantId_branchId_id_key" ON "branch_school_licences"("tenantId", "branchId", "id");

-- CreateIndex
CREATE INDEX "branch_vehicle_classes_tenantId_branchId_idx" ON "branch_vehicle_classes"("tenantId", "branchId");

-- CreateIndex
CREATE INDEX "branch_vehicle_classes_vehicleClassId_idx" ON "branch_vehicle_classes"("vehicleClassId");

-- CreateIndex
CREATE UNIQUE INDEX "branches_currentLicenceId_key" ON "branches"("currentLicenceId");

-- AddForeignKey
ALTER TABLE "driving_school_grade_vehicle_classes" ADD CONSTRAINT "driving_school_grade_vehicle_classes_vehicleClassId_fkey" FOREIGN KEY ("vehicleClassId") REFERENCES "vehicle_classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_tenantId_id_currentLicenceId_fkey" FOREIGN KEY ("tenantId", "id", "currentLicenceId") REFERENCES "branch_school_licences"("tenantId", "branchId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_school_licences" ADD CONSTRAINT "branch_school_licences_tenantId_branchId_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "branches"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_school_licences" ADD CONSTRAINT "branch_school_licences_tenantId_recordedByTenantUserId_fkey" FOREIGN KEY ("tenantId", "recordedByTenantUserId") REFERENCES "tenant_users"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_vehicle_classes" ADD CONSTRAINT "branch_vehicle_classes_tenantId_branchId_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "branches"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_vehicle_classes" ADD CONSTRAINT "branch_vehicle_classes_vehicleClassId_fkey" FOREIGN KEY ("vehicleClassId") REFERENCES "vehicle_classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Seed: the 13 DMT licence vehicle classes.
INSERT INTO "vehicle_classes" ("id", "code", "name", "description", "sortOrder", "updatedAt") VALUES
  (gen_random_uuid(), 'A1', 'Light motorcycle', 'Motorcycles with an engine capacity up to 100 cc', 1, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'A', 'Motorcycle', 'Motorcycles with an engine capacity over 100 cc', 2, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'B1', 'Motor tricycle', 'Three-wheelers and motor tricycle vans', 3, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'B', 'Motor car / dual purpose vehicle', 'Motor cars and dual purpose vehicles up to 3,500 kg with up to 9 seats', 4, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'C1', 'Light motor lorry', 'Goods vehicles from 3,500 kg up to 17,000 kg', 5, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'C', 'Motor lorry', 'Goods vehicles over 17,000 kg', 6, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'CE', 'Heavy motor lorry combination', 'Class C vehicles with a trailer over 750 kg', 7, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'D1', 'Light motor coach', 'Passenger vehicles with up to 33 seats', 8, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'D', 'Motor coach', 'Passenger vehicles with more than 33 seats', 9, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'DE', 'Heavy motor coach combination', 'Class D vehicles with a trailer over 750 kg', 10, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'G1', 'Hand tractor', 'Two-wheel hand tractors', 11, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'G', 'Land vehicle', 'Agricultural tractors and land vehicles', 12, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'J', 'Special purpose vehicle', 'Special purpose vehicles such as construction machinery', 13, CURRENT_TIMESTAMP);

-- Seed: classes each driving-school grade may teach.
-- Grade A: all 13.
INSERT INTO "driving_school_grade_vehicle_classes" ("grade", "vehicleClassId")
SELECT 'A'::"DrivingSchoolGrade", "id" FROM "vehicle_classes";

-- Grade B: all except CE and DE.
INSERT INTO "driving_school_grade_vehicle_classes" ("grade", "vehicleClassId")
SELECT 'B'::"DrivingSchoolGrade", "id" FROM "vehicle_classes"
WHERE "code" IN ('A1', 'A', 'B1', 'B', 'C1', 'C', 'D1', 'D', 'G1', 'G', 'J');

-- Grade C: A1, A, B1, B, G.
INSERT INTO "driving_school_grade_vehicle_classes" ("grade", "vehicleClassId")
SELECT 'C'::"DrivingSchoolGrade", "id" FROM "vehicle_classes"
WHERE "code" IN ('A1', 'A', 'B1', 'B', 'G');
