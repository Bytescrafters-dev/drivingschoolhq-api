import { Module } from '@nestjs/common';
import { PrismaVehicleClassRepository } from './infra/prisma-vehicle-class.repository.js';
import { VEHICLE_CLASS_REPOSITORY } from './interfaces/vehicle-class.repository.js';
import { VehicleClassCatalogService } from './vehicle-class-catalog.service.js';

/**
 * DMT vehicle classes and driving-school grades: global reference data shared
 * by branches, instructors, vehicles and licence applications. Depends on
 * nothing in the platform or tenant domains.
 */
@Module({
  providers: [
    VehicleClassCatalogService,
    {
      provide: VEHICLE_CLASS_REPOSITORY,
      useClass: PrismaVehicleClassRepository,
    },
  ],
  exports: [VehicleClassCatalogService],
})
export class VehicleClassesModule {}
