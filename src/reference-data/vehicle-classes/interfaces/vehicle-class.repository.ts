import type { DrivingSchoolGrade } from '../../../generated/prisma/enums.js';

export const VEHICLE_CLASS_REPOSITORY = Symbol('VEHICLE_CLASS_REPOSITORY');

/** A DMT licence vehicle class with the school grades allowed to teach it. */
export interface VehicleClass {
  id: string;
  code: string;
  name: string;
  description: string;
  sortOrder: number;
  permittedGrades: DrivingSchoolGrade[];
}

/** Global reference data (not tenant-owned), seeded by migration. */
export interface VehicleClassRepository {
  /** Every class in DMT order (sortOrder). */
  listAll(): Promise<VehicleClass[]>;
}
