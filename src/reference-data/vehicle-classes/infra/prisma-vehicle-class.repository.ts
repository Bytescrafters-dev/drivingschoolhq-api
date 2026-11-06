import { Injectable } from '@nestjs/common';
import { TransactionManager } from '../../../prisma/transaction-manager.js';
import type {
  VehicleClass,
  VehicleClassRepository,
} from '../interfaces/vehicle-class.repository.js';

@Injectable()
export class PrismaVehicleClassRepository implements VehicleClassRepository {
  constructor(private readonly tx: TransactionManager) {}

  async listAll(): Promise<VehicleClass[]> {
    const rows = await this.tx.client.vehicleClass.findMany({
      select: {
        id: true,
        code: true,
        name: true,
        description: true,
        sortOrder: true,
        permittedForGrades: { select: { grade: true } },
      },
      orderBy: { sortOrder: 'asc' },
    });
    return rows.map(({ permittedForGrades, ...row }) => ({
      ...row,
      permittedGrades: permittedForGrades.map((p) => p.grade).sort(),
    }));
  }
}
