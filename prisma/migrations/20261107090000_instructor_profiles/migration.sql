-- Chunk 8b: instructor profiles (any staff member may hold one), instructor
-- licences with history and qualified vehicle classes. Additive only.

-- CreateEnum
CREATE TYPE "InstructorProfileStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateTable
CREATE TABLE "instructor_profiles" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "tenantUserId" UUID NOT NULL,
    "status" "InstructorProfileStatus" NOT NULL DEFAULT 'ACTIVE',
    "inactivatedAt" TIMESTAMP(3),
    "currentLicenceId" UUID,
    "createdByTenantUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "instructor_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instructor_licences" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "instructorProfileId" UUID NOT NULL,
    "licenceNumber" TEXT NOT NULL,
    "grade" "DrivingSchoolGrade" NOT NULL,
    "issuedOn" DATE NOT NULL,
    "expiresOn" DATE NOT NULL,
    "recordedByTenantUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "instructor_licences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instructor_vehicle_classes" (
    "tenantId" UUID NOT NULL,
    "instructorProfileId" UUID NOT NULL,
    "vehicleClassId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "instructor_vehicle_classes_pkey" PRIMARY KEY ("instructorProfileId","vehicleClassId")
);

-- CreateIndex
CREATE UNIQUE INDEX "instructor_profiles_currentLicenceId_key" ON "instructor_profiles"("currentLicenceId");

-- CreateIndex
CREATE INDEX "instructor_profiles_tenantId_status_idx" ON "instructor_profiles"("tenantId", "status");

-- CreateIndex
CREATE INDEX "instructor_profiles_tenantId_createdByTenantUserId_idx" ON "instructor_profiles"("tenantId", "createdByTenantUserId");

-- CreateIndex
CREATE UNIQUE INDEX "instructor_profiles_tenantId_id_key" ON "instructor_profiles"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "instructor_profiles_tenantId_tenantUserId_key" ON "instructor_profiles"("tenantId", "tenantUserId");

-- CreateIndex
CREATE INDEX "instructor_licences_tenantId_instructorProfileId_createdAt_idx" ON "instructor_licences"("tenantId", "instructorProfileId", "createdAt");

-- CreateIndex
CREATE INDEX "instructor_licences_tenantId_recordedByTenantUserId_idx" ON "instructor_licences"("tenantId", "recordedByTenantUserId");

-- CreateIndex
CREATE UNIQUE INDEX "instructor_licences_tenantId_instructorProfileId_id_key" ON "instructor_licences"("tenantId", "instructorProfileId", "id");

-- CreateIndex
CREATE INDEX "instructor_vehicle_classes_tenantId_instructorProfileId_idx" ON "instructor_vehicle_classes"("tenantId", "instructorProfileId");

-- CreateIndex
CREATE INDEX "instructor_vehicle_classes_vehicleClassId_idx" ON "instructor_vehicle_classes"("vehicleClassId");

-- AddForeignKey
ALTER TABLE "instructor_profiles" ADD CONSTRAINT "instructor_profiles_tenantId_tenantUserId_fkey" FOREIGN KEY ("tenantId", "tenantUserId") REFERENCES "tenant_users"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instructor_profiles" ADD CONSTRAINT "instructor_profiles_tenantId_id_currentLicenceId_fkey" FOREIGN KEY ("tenantId", "id", "currentLicenceId") REFERENCES "instructor_licences"("tenantId", "instructorProfileId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instructor_profiles" ADD CONSTRAINT "instructor_profiles_tenantId_createdByTenantUserId_fkey" FOREIGN KEY ("tenantId", "createdByTenantUserId") REFERENCES "tenant_users"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instructor_licences" ADD CONSTRAINT "instructor_licences_tenantId_instructorProfileId_fkey" FOREIGN KEY ("tenantId", "instructorProfileId") REFERENCES "instructor_profiles"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instructor_licences" ADD CONSTRAINT "instructor_licences_tenantId_recordedByTenantUserId_fkey" FOREIGN KEY ("tenantId", "recordedByTenantUserId") REFERENCES "tenant_users"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instructor_vehicle_classes" ADD CONSTRAINT "instructor_vehicle_classes_tenantId_instructorProfileId_fkey" FOREIGN KEY ("tenantId", "instructorProfileId") REFERENCES "instructor_profiles"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instructor_vehicle_classes" ADD CONSTRAINT "instructor_vehicle_classes_vehicleClassId_fkey" FOREIGN KEY ("vehicleClassId") REFERENCES "vehicle_classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
