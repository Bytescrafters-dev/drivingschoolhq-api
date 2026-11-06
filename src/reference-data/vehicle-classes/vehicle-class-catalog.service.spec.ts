import { InMemoryVehicleClassRepository } from '../../../test/support/branch-profile-fakes.js';
import { expectAppError } from '../../../test/support/fakes.js';
import { DrivingSchoolGrade } from '../../generated/prisma/enums.js';
import { VehicleClassCatalogService } from './vehicle-class-catalog.service.js';

describe('VehicleClassCatalogService', () => {
  const catalog = new VehicleClassCatalogService(
    new InMemoryVehicleClassRepository(),
  );

  it('lists grade-permitted classes in DMT order', async () => {
    const codes = async (grade: DrivingSchoolGrade) =>
      (await catalog.permittedFor(grade)).map((c) => c.code);
    expect(await codes(DrivingSchoolGrade.A)).toHaveLength(13);
    expect(await codes(DrivingSchoolGrade.B)).toEqual([
      'A1',
      'A',
      'B1',
      'B',
      'C1',
      'C',
      'D1',
      'D',
      'G1',
      'G',
      'J',
    ]);
    expect(await codes(DrivingSchoolGrade.C)).toEqual([
      'A1',
      'A',
      'B1',
      'B',
      'G',
    ]);
  });

  it('resolves codes case-insensitively, without duplicates, in DMT order', async () => {
    const resolved = await catalog.resolveCodes(['b', ' A1 ', 'B']);
    expect(resolved.map((c) => c.code)).toEqual(['A1', 'B']);
  });

  it('rejects unknown codes', async () => {
    const error = await expectAppError(
      catalog.resolveCodes(['B', 'Z9']),
      'UNKNOWN_VEHICLE_CLASS',
    );
    expect(error.message).toContain('Z9');
  });
});
