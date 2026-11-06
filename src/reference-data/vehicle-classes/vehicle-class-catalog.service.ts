import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error.js';
import type { DrivingSchoolGrade } from '../../generated/prisma/enums.js';
import {
  VEHICLE_CLASS_REPOSITORY,
  type VehicleClass,
  type VehicleClassRepository,
} from './interfaces/vehicle-class.repository.js';

/**
 * Read-only access to the DMT vehicle classes and the grade → permitted-class
 * matrix. The matrix is data (seeded by migration), so a regulation change
 * never requires code changes in the modules using it.
 */
@Injectable()
export class VehicleClassCatalogService {
  constructor(
    @Inject(VEHICLE_CLASS_REPOSITORY)
    private readonly classes: VehicleClassRepository,
  ) {}

  list(): Promise<VehicleClass[]> {
    return this.classes.listAll();
  }

  /** Classes a school of this grade may teach, in DMT order. */
  async permittedFor(grade: DrivingSchoolGrade): Promise<VehicleClass[]> {
    return (await this.classes.listAll()).filter((c) =>
      c.permittedGrades.includes(grade),
    );
  }

  /**
   * Resolves codes (case-insensitive, duplicates ignored) to classes in DMT
   * order. Throws 400 UNKNOWN_VEHICLE_CLASS naming the codes that don't exist.
   */
  async resolveCodes(codes: string[]): Promise<VehicleClass[]> {
    const wanted = new Set(codes.map((code) => code.trim().toUpperCase()));
    const all = await this.classes.listAll();
    const unknown = [...wanted].filter((code) =>
      all.every((c) => c.code !== code),
    );
    if (unknown.length > 0) {
      throw new AppError(
        'BAD_REQUEST',
        'UNKNOWN_VEHICLE_CLASS',
        `Unknown vehicle class: ${unknown.join(', ')}`,
      );
    }
    return all.filter((c) => wanted.has(c.code));
  }
}
