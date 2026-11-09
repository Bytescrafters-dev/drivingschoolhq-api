import type { DrivingSchoolGrade } from '../../generated/prisma/enums.js';
import type { VehicleClass } from './interfaces/vehicle-class.repository.js';

export interface VehicleClassResponse {
  code: string;
  name: string;
  description: string;
  permittedGrades: DrivingSchoolGrade[];
}

export function toVehicleClassResponse(c: VehicleClass): VehicleClassResponse {
  return {
    code: c.code,
    name: c.name,
    description: c.description,
    permittedGrades: c.permittedGrades,
  };
}
