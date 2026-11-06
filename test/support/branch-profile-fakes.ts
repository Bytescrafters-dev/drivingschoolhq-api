import { randomUUID } from 'node:crypto';
import { DrivingSchoolGrade } from '../../src/generated/prisma/enums.js';
import type {
  VehicleClass,
  VehicleClassRepository,
} from '../../src/reference-data/vehicle-classes/interfaces/vehicle-class.repository.js';
import type {
  BranchProfileRepository,
  BranchProfileState,
  BranchSchoolLicence,
  LicenceDetails,
  NewBranchLicence,
} from '../../src/tenant/branches/profile/interfaces/branch-profile.repository.js';

/** The seeded DMT matrix (same as the migration). */
export const DMT_CODES = [
  'A1',
  'A',
  'B1',
  'B',
  'C1',
  'C',
  'CE',
  'D1',
  'D',
  'DE',
  'G1',
  'G',
  'J',
] as const;
const GRADE_B = ['A1', 'A', 'B1', 'B', 'C1', 'C', 'D1', 'D', 'G1', 'G', 'J'];
const GRADE_C = ['A1', 'A', 'B1', 'B', 'G'];

export class InMemoryVehicleClassRepository implements VehicleClassRepository {
  readonly rows: VehicleClass[] = DMT_CODES.map((code, index) => ({
    id: randomUUID(),
    code,
    name: `Class ${code}`,
    description: `Vehicle class ${code}`,
    sortOrder: index + 1,
    permittedGrades: [
      DrivingSchoolGrade.A,
      ...(GRADE_B.includes(code) ? [DrivingSchoolGrade.B] : []),
      ...(GRADE_C.includes(code) ? [DrivingSchoolGrade.C] : []),
    ],
  }));

  async listAll() {
    return this.rows.map((c) => ({
      ...c,
      permittedGrades: [...c.permittedGrades],
    }));
  }

  idOf(code: string): string {
    const row = this.rows.find((c) => c.code === code);
    if (!row) throw new Error(`unknown class ${code}`);
    return row.id;
  }
}

/** In-memory licences + offerings. Returns copies, like Prisma. */
export class InMemoryBranchProfileRepository implements BranchProfileRepository {
  readonly licences: BranchSchoolLicence[] = [];
  readonly current = new Map<string, string>();
  readonly offered = new Map<string, string[]>();
  private tick = 0;

  async states(tenantId: string, branchIds: string[]) {
    const result = new Map<string, BranchProfileState>();
    for (const branchId of branchIds) {
      const licence = this.licences.find(
        (l) =>
          l.tenantId === tenantId &&
          l.branchId === branchId &&
          l.id === this.current.get(branchId),
      );
      result.set(branchId, {
        currentLicence: licence ? { ...licence } : null,
        offeredVehicleClassIds: [...(this.offered.get(branchId) ?? [])],
      });
    }
    return result;
  }

  async listLicences(tenantId: string, branchId: string) {
    return this.licences
      .filter((l) => l.tenantId === tenantId && l.branchId === branchId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((l) => ({ ...l }));
  }

  async recordLicence(input: NewBranchLicence) {
    const createdAt = new Date(Date.UTC(2026, 0, 1) + this.tick++ * 1000);
    const licence: BranchSchoolLicence = {
      ...input,
      id: randomUUID(),
      createdAt,
      updatedAt: createdAt,
    };
    this.licences.push(licence);
    this.current.set(input.branchId, licence.id);
    return { ...licence };
  }

  async correctLicence(
    tenantId: string,
    branchId: string,
    licenceId: string,
    change: Partial<LicenceDetails>,
  ) {
    const row = this.licences.find(
      (l) =>
        l.tenantId === tenantId &&
        l.branchId === branchId &&
        l.id === licenceId,
    );
    if (!row) throw new Error(`licence ${licenceId} not found`);
    Object.assign(row, change, { updatedAt: new Date() });
    return { ...row };
  }

  async replaceOfferedClasses(
    _tenantId: string,
    branchId: string,
    vehicleClassIds: string[],
  ) {
    this.offered.set(branchId, [...vehicleClassIds]);
  }
}
