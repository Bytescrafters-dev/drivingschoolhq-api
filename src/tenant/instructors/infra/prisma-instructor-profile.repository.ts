import { Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error.js';
import type { Prisma } from '../../../generated/prisma/client.js';
import {
  InstructorProfileStatus,
  TenantRole,
  TenantUserBranchAccess,
  TenantUserStatus,
} from '../../../generated/prisma/enums.js';
import { violatedUniqueIndex } from '../../../prisma/prisma-errors.js';
import { TransactionManager } from '../../../prisma/transaction-manager.js';
import type { LicenceDetails } from '../../../reference-data/vehicle-classes/licence-details.js';
import type {
  InstructorLicence,
  InstructorPerson,
  InstructorProfile,
  InstructorProfileRepository,
  NewInstructorProfile,
} from '../interfaces/instructor-profile.repository.js';

const LICENCE_SELECT = {
  id: true,
  tenantId: true,
  instructorProfileId: true,
  licenceNumber: true,
  grade: true,
  issuedOn: true,
  expiresOn: true,
  recordedByTenantUserId: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.InstructorLicenceSelect;

const PROFILE_SELECT = {
  id: true,
  tenantId: true,
  tenantUserId: true,
  status: true,
  inactivatedAt: true,
  createdByTenantUserId: true,
  createdAt: true,
  updatedAt: true,
  currentLicence: { select: LICENCE_SELECT },
  qualifiedClasses: { select: { vehicleClassId: true } },
} as const satisfies Prisma.InstructorProfileSelect;

const USER_SELECT = {
  id: true,
  tenantId: true,
  fullName: true,
  email: true,
  phone: true,
  role: true,
  status: true,
  branchAccess: true,
  branchAssignments: {
    select: { branch: { select: { id: true, name: true, status: true } } },
    orderBy: [{ branch: { createdAt: 'asc' } }, { branchId: 'asc' }],
  },
  instructorProfile: { select: PROFILE_SELECT },
} as const satisfies Prisma.TenantUserSelect;

type ProfileRow = Prisma.InstructorProfileGetPayload<{
  select: typeof PROFILE_SELECT;
}>;
type UserRow = Prisma.TenantUserGetPayload<{ select: typeof USER_SELECT }>;

const PROFILE_PER_USER_INDEX = 'instructor_profiles_tenantId_tenantUserId_key';

function toProfile(row: ProfileRow): InstructorProfile {
  const { qualifiedClasses, ...profile } = row;
  return {
    ...profile,
    qualifiedVehicleClassIds: qualifiedClasses.map((c) => c.vehicleClassId),
  };
}

function toPerson(row: UserRow): InstructorPerson {
  const { branchAssignments, instructorProfile, ...user } = row;
  return {
    user: { ...user, branches: branchAssignments.map((a) => a.branch) },
    profile: instructorProfile ? toProfile(instructorProfile) : null,
  };
}

/** Users who can work in the branch: ALL access or assigned to it. */
function worksIn(branchId: string): Prisma.TenantUserWhereInput {
  return {
    OR: [
      { branchAccess: TenantUserBranchAccess.ALL },
      { branchAssignments: { some: { branchId } } },
    ],
  };
}

@Injectable()
export class PrismaInstructorProfileRepository implements InstructorProfileRepository {
  constructor(private readonly tx: TransactionManager) {}

  async listForBranch(
    tenantId: string,
    branchId: string,
  ): Promise<InstructorPerson[]> {
    const rows = await this.tx.client.tenantUser.findMany({
      where: {
        AND: [
          { tenantId },
          worksIn(branchId),
          {
            OR: [
              { instructorProfile: { isNot: null } },
              { role: TenantRole.INSTRUCTOR },
            ],
          },
        ],
      },
      select: USER_SELECT,
      orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toPerson);
  }

  async listCandidates(
    tenantId: string,
    branchId: string,
  ): Promise<InstructorPerson[]> {
    const rows = await this.tx.client.tenantUser.findMany({
      where: {
        AND: [
          { tenantId, status: TenantUserStatus.ACTIVE },
          worksIn(branchId),
          { instructorProfile: { is: null } },
        ],
      },
      select: USER_SELECT,
      orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toPerson);
  }

  async findByUserId(
    tenantId: string,
    tenantUserId: string,
  ): Promise<InstructorProfile | null> {
    const row = await this.tx.client.instructorProfile.findUnique({
      where: { tenantId_tenantUserId: { tenantId, tenantUserId } },
      select: PROFILE_SELECT,
    });
    return row ? toProfile(row) : null;
  }

  async lockByUserId(
    tenantId: string,
    tenantUserId: string,
  ): Promise<InstructorProfile | null> {
    await this.tx.client.$queryRaw`
      SELECT id FROM instructor_profiles
      WHERE "tenantId" = ${tenantId}::uuid
        AND "tenantUserId" = ${tenantUserId}::uuid
      FOR UPDATE`;
    return this.findByUserId(tenantId, tenantUserId);
  }

  async findPerson(
    tenantId: string,
    instructorProfileId: string,
  ): Promise<InstructorPerson | null> {
    const row = await this.tx.client.tenantUser.findFirst({
      where: { tenantId, instructorProfile: { id: instructorProfileId } },
      select: USER_SELECT,
    });
    return row ? toPerson(row) : null;
  }

  countActive(tenantId: string): Promise<number> {
    return this.tx.client.instructorProfile.count({
      where: { tenantId, status: InstructorProfileStatus.ACTIVE },
    });
  }

  async create(profile: NewInstructorProfile): Promise<InstructorProfile> {
    const { tenantId, tenantUserId, createdByTenantUserId } = profile;
    let id: string;
    try {
      ({ id } = await this.tx.client.instructorProfile.create({
        data: { tenantId, tenantUserId, createdByTenantUserId },
        select: { id: true },
      }));
    } catch (error) {
      if (violatedUniqueIndex(error, [PROFILE_PER_USER_INDEX])) {
        throw new AppError(
          'CONFLICT',
          'INSTRUCTOR_PROFILE_EXISTS',
          'This person already has an instructor profile',
        );
      }
      throw error;
    }
    await this.recordLicence(
      tenantId,
      id,
      profile.licence,
      createdByTenantUserId,
    );
    await this.replaceQualifiedClasses(tenantId, id, profile.vehicleClassIds);
    return (await this.findByUserId(tenantId, tenantUserId))!;
  }

  listLicences(
    tenantId: string,
    instructorProfileId: string,
  ): Promise<InstructorLicence[]> {
    return this.tx.client.instructorLicence.findMany({
      where: { tenantId, instructorProfileId },
      select: LICENCE_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  async recordLicence(
    tenantId: string,
    instructorProfileId: string,
    licence: LicenceDetails,
    recordedByTenantUserId: string,
  ): Promise<InstructorLicence> {
    const created = await this.tx.client.instructorLicence.create({
      data: {
        ...licence,
        tenantId,
        instructorProfileId,
        recordedByTenantUserId,
      },
      select: LICENCE_SELECT,
    });
    await this.tx.client.instructorProfile.update({
      where: { tenantId_id: { tenantId, id: instructorProfileId } },
      data: { currentLicenceId: created.id },
      select: { id: true },
    });
    return created;
  }

  correctLicence(
    tenantId: string,
    instructorProfileId: string,
    licenceId: string,
    change: Partial<LicenceDetails>,
  ): Promise<InstructorLicence> {
    return this.tx.client.instructorLicence.update({
      where: {
        tenantId_instructorProfileId_id: {
          tenantId,
          instructorProfileId,
          id: licenceId,
        },
      },
      data: change,
      select: LICENCE_SELECT,
    });
  }

  async replaceQualifiedClasses(
    tenantId: string,
    instructorProfileId: string,
    vehicleClassIds: string[],
  ): Promise<void> {
    await this.tx.client.instructorVehicleClass.deleteMany({
      where: {
        tenantId,
        instructorProfileId,
        vehicleClassId: { notIn: vehicleClassIds },
      },
    });
    if (vehicleClassIds.length > 0) {
      await this.tx.client.instructorVehicleClass.createMany({
        data: vehicleClassIds.map((vehicleClassId) => ({
          tenantId,
          instructorProfileId,
          vehicleClassId,
        })),
        skipDuplicates: true,
      });
    }
  }

  async setStatus(
    tenantId: string,
    instructorProfileId: string,
    status: InstructorProfileStatus,
    inactivatedAt: Date | null,
  ): Promise<InstructorProfile> {
    const row = await this.tx.client.instructorProfile.update({
      where: { tenantId_id: { tenantId, id: instructorProfileId } },
      data: { status, inactivatedAt },
      select: PROFILE_SELECT,
    });
    return toProfile(row);
  }
}
