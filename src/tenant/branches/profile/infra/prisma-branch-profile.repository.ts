import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../../generated/prisma/client.js';
import { TransactionManager } from '../../../../prisma/transaction-manager.js';
import type {
  BranchProfileRepository,
  BranchProfileState,
  BranchSchoolLicence,
  LicenceDetails,
  NewBranchLicence,
} from '../interfaces/branch-profile.repository.js';

const LICENCE_SELECT = {
  id: true,
  tenantId: true,
  branchId: true,
  licenceNumber: true,
  grade: true,
  issuedOn: true,
  expiresOn: true,
  recordedByTenantUserId: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.BranchSchoolLicenceSelect;

@Injectable()
export class PrismaBranchProfileRepository implements BranchProfileRepository {
  constructor(private readonly tx: TransactionManager) {}

  async states(
    tenantId: string,
    branchIds: string[],
  ): Promise<Map<string, BranchProfileState>> {
    if (branchIds.length === 0) return new Map();
    const rows = await this.tx.client.branch.findMany({
      where: { tenantId, id: { in: branchIds } },
      select: {
        id: true,
        currentLicence: { select: LICENCE_SELECT },
        offeredClasses: { select: { vehicleClassId: true } },
      },
    });
    return new Map(
      rows.map((row) => [
        row.id,
        {
          currentLicence: row.currentLicence,
          offeredVehicleClassIds: row.offeredClasses.map(
            (o) => o.vehicleClassId,
          ),
        },
      ]),
    );
  }

  listLicences(
    tenantId: string,
    branchId: string,
  ): Promise<BranchSchoolLicence[]> {
    return this.tx.client.branchSchoolLicence.findMany({
      where: { tenantId, branchId },
      select: LICENCE_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  async recordLicence(licence: NewBranchLicence): Promise<BranchSchoolLicence> {
    const created = await this.tx.client.branchSchoolLicence.create({
      data: licence,
      select: LICENCE_SELECT,
    });
    await this.tx.client.branch.update({
      where: {
        tenantId_id: { tenantId: licence.tenantId, id: licence.branchId },
      },
      data: { currentLicenceId: created.id },
      select: { id: true },
    });
    return created;
  }

  correctLicence(
    tenantId: string,
    branchId: string,
    licenceId: string,
    change: Partial<LicenceDetails>,
  ): Promise<BranchSchoolLicence> {
    return this.tx.client.branchSchoolLicence.update({
      where: { tenantId_branchId_id: { tenantId, branchId, id: licenceId } },
      data: change,
      select: LICENCE_SELECT,
    });
  }

  async replaceOfferedClasses(
    tenantId: string,
    branchId: string,
    vehicleClassIds: string[],
  ): Promise<void> {
    await this.tx.client.branchVehicleClass.deleteMany({
      where: { tenantId, branchId, vehicleClassId: { notIn: vehicleClassIds } },
    });
    if (vehicleClassIds.length > 0) {
      await this.tx.client.branchVehicleClass.createMany({
        data: vehicleClassIds.map((vehicleClassId) => ({
          tenantId,
          branchId,
          vehicleClassId,
        })),
        skipDuplicates: true,
      });
    }
  }
}
