import {
  BranchStatus,
  DrivingSchoolGrade,
  TenantRole,
  TenantUserBranchAccess,
  TenantUserStatus,
} from '../../../generated/prisma/enums.js';
import { InMemoryBranchRepository } from '../../../../test/support/branch-fakes.js';
import {
  InMemoryBranchProfileRepository,
  InMemoryVehicleClassRepository,
} from '../../../../test/support/branch-profile-fakes.js';
import {
  FixedClock,
  META,
  expectAppError,
  passthroughTx,
} from '../../../../test/support/fakes.js';
import { FakeTenantAuditRepository } from '../../../../test/support/tenant-auth-fakes.js';
import { InMemoryTenantUserRepository } from '../../../../test/support/tenancy-fakes.js';
import { VehicleClassCatalogService } from '../../../reference-data/vehicle-classes/vehicle-class-catalog.service.js';
import { TenantAuditService } from '../../audit/tenant-audit.service.js';
import type { AuthenticatedTenantUser } from '../../auth/interfaces/authenticated-tenant-user.js';
import { BranchCapabilityService } from './branch-capability.service.js';
import { BranchProfileReader } from './branch-profile-reader.service.js';
import { BranchProfileService } from './branch-profile.service.js';

const GRADE_A_LICENCE = {
  licenceNumber: ' DS/WP/0042 ',
  grade: DrivingSchoolGrade.A,
  issuedOn: '2026-01-15',
  expiresOn: '2027-01-14',
};

function setup() {
  const users = new InMemoryTenantUserRepository();
  const branches = new InMemoryBranchRepository(users);
  const profiles = new InMemoryBranchProfileRepository();
  const classes = new InMemoryVehicleClassRepository();
  const catalog = new VehicleClassCatalogService(classes);
  const auditRepo = new FakeTenantAuditRepository();
  const clock = new FixedClock(new Date('2026-11-04T04:00:00.000Z'));
  const reader = new BranchProfileReader(profiles, catalog, clock);
  const service = new BranchProfileService(
    branches,
    profiles,
    reader,
    catalog,
    new TenantAuditService(auditRepo),
    passthroughTx,
  );
  const capability = new BranchCapabilityService(profiles, catalog);
  const tenantId = crypto.randomUUID();
  const main = branches.seed({ tenantId, name: 'Main Branch' });

  function actor(
    overrides: {
      tenantId?: string;
      branchAccess?: TenantUserBranchAccess;
      branchIds?: string[];
    } = {},
  ): AuthenticatedTenantUser {
    const row = users.seedUser({
      tenantId: overrides.tenantId ?? tenantId,
      role: TenantRole.OWNER,
      branchAccess: overrides.branchAccess ?? TenantUserBranchAccess.ALL,
      defaultBranchId: main.id,
      status: TenantUserStatus.ACTIVE,
    });
    if (row.branchAccess === TenantUserBranchAccess.SELECTED) {
      branches.assign(row.tenantId, row.id, ...(overrides.branchIds ?? []));
    }
    return {
      id: row.id,
      tenantId: row.tenantId,
      email: row.email,
      fullName: row.fullName,
      role: row.role,
      sessionId: crypto.randomUUID(),
      mustChangePassword: false,
      branchAccess: row.branchAccess,
      defaultBranchId: row.defaultBranchId,
    };
  }

  const codes = (list: { code: string }[]) => list.map((c) => c.code);
  return {
    service,
    capability,
    branches,
    profiles,
    classes,
    auditRepo,
    tenantId,
    main,
    actor,
    codes,
  };
}

describe('BranchProfileService', () => {
  it('starts incomplete: no licence, nothing permitted or offered', async () => {
    const { service, main, actor } = setup();
    const profile = await service.get(actor(), main.id);
    expect(profile.currentLicence).toBeNull();
    expect(profile.permittedClasses).toEqual([]);
    expect(profile.offeredClasses).toEqual([]);
    expect(profile.readiness.blockers).toEqual([
      { code: 'BRANCH_LICENCE_MISSING' },
    ]);
  });

  describe('recordLicence', () => {
    it('pre-fills every permitted class on the first licence and audits it', async () => {
      const { service, main, actor, auditRepo, codes } = setup();
      const { profile, removedVehicleClasses } = await service.recordLicence(
        actor(),
        main.id,
        { ...GRADE_A_LICENCE, grade: DrivingSchoolGrade.C },
        META,
      );
      expect(profile.currentLicence).toMatchObject({
        licenceNumber: 'DS/WP/0042',
        grade: DrivingSchoolGrade.C,
      });
      expect(codes(profile.offeredClasses)).toEqual([
        'A1',
        'A',
        'B1',
        'B',
        'G',
      ]);
      expect(removedVehicleClasses).toEqual([]);
      expect(profile.readiness.operational).toBe(true);
      expect(auditRepo.entries).toHaveLength(1);
      expect(auditRepo.entries[0]).toMatchObject({
        action: 'BRANCH_LICENCE_RECORDED',
        branchId: main.id,
        metadata: {
          grade: 'C',
          issuedOn: '2026-01-15',
          expiresOn: '2027-01-14',
          previousGrade: null,
          prefilledVehicleClasses: ['A1', 'A', 'B1', 'B', 'G'],
          removedVehicleClasses: [],
        },
      });
    });

    it('keeps history on renewal and drops classes a lower grade does not permit', async () => {
      const { service, main, actor, auditRepo, codes } = setup();
      const owner = actor();
      await service.recordLicence(owner, main.id, GRADE_A_LICENCE, META);
      const renewed = await service.recordLicence(
        owner,
        main.id,
        {
          licenceNumber: 'DS/WP/0042',
          grade: DrivingSchoolGrade.B,
          issuedOn: '2027-01-15',
          expiresOn: '2028-01-14',
        },
        META,
      );
      expect(renewed.removedVehicleClasses).toEqual(['CE', 'DE']);
      expect(codes(renewed.profile.offeredClasses)).not.toContain('CE');
      expect(renewed.profile.offeredClasses).toHaveLength(11);
      expect(renewed.profile.licenceHistory).toHaveLength(2);
      expect(renewed.profile.licenceHistory[0]!.grade).toBe('B');
      expect(auditRepo.entries[1]!.metadata).toMatchObject({
        previousGrade: 'A',
        prefilledVehicleClasses: [],
        removedVehicleClasses: ['CE', 'DE'],
      });
    });

    it('adds nothing when a renewal raises the grade', async () => {
      const { service, main, actor, codes } = setup();
      const owner = actor();
      await service.recordLicence(
        owner,
        main.id,
        { ...GRADE_A_LICENCE, grade: DrivingSchoolGrade.C },
        META,
      );
      await service.setOfferedClasses(owner, main.id, ['B'], META);
      const { profile } = await service.recordLicence(
        owner,
        main.id,
        GRADE_A_LICENCE,
        META,
      );
      expect(codes(profile.offeredClasses)).toEqual(['B']);
      expect(profile.permittedClasses).toHaveLength(13);
    });

    it('records an expired licence (expiry only warns)', async () => {
      const { service, main, actor } = setup();
      const { profile } = await service.recordLicence(
        actor(),
        main.id,
        { ...GRADE_A_LICENCE, issuedOn: '2024-01-01', expiresOn: '2025-01-01' },
        META,
      );
      expect(profile.readiness.operational).toBe(true);
      expect(profile.readiness.warnings).toEqual([
        { code: 'BRANCH_LICENCE_EXPIRED', expiredOn: '2025-01-01' },
      ]);
    });

    it('rejects an expiry that is not after the issue date, and invalid dates', async () => {
      const { service, main, actor } = setup();
      await expectAppError(
        service.recordLicence(
          actor(),
          main.id,
          { ...GRADE_A_LICENCE, expiresOn: '2026-01-15' },
          META,
        ),
        'INVALID_LICENCE_DATES',
      );
      await expectAppError(
        service.recordLicence(
          actor(),
          main.id,
          { ...GRADE_A_LICENCE, issuedOn: '2026-02-30' },
          META,
        ),
        'INVALID_LICENCE_DATES',
      );
    });

    it('rejects closed branches and branches the user cannot access', async () => {
      const { service, branches, tenantId, main, actor } = setup();
      const closed = branches.seed({ tenantId, status: BranchStatus.CLOSED });
      await expectAppError(
        service.recordLicence(actor(), closed.id, GRADE_A_LICENCE, META),
        'BRANCH_CLOSED',
      );
      const other = branches.seed({ tenantId });
      const selected = actor({
        branchAccess: TenantUserBranchAccess.SELECTED,
        branchIds: [main.id],
      });
      await expectAppError(
        service.recordLicence(selected, other.id, GRADE_A_LICENCE, META),
        'BRANCH_NOT_FOUND',
      );
      const foreign = actor({ tenantId: crypto.randomUUID() });
      await expectAppError(
        service.recordLicence(foreign, main.id, GRADE_A_LICENCE, META),
        'BRANCH_NOT_FOUND',
      );
      await expectAppError(service.get(foreign, main.id), 'BRANCH_NOT_FOUND');
    });
  });

  describe('correctLicence', () => {
    it('edits the current licence in place and audits the diff', async () => {
      const { service, main, actor, auditRepo } = setup();
      const owner = actor();
      await service.recordLicence(owner, main.id, GRADE_A_LICENCE, META);
      const { profile } = await service.correctLicence(
        owner,
        main.id,
        { licenceNumber: 'DS/WP/0043', expiresOn: '2027-01-15' },
        META,
      );
      expect(profile.licenceHistory).toHaveLength(1);
      expect(profile.currentLicence!.licenceNumber).toBe('DS/WP/0043');
      expect(auditRepo.entries[1]).toMatchObject({
        action: 'BRANCH_LICENCE_CORRECTED',
        metadata: {
          changes: {
            licenceNumber: { from: 'DS/WP/0042', to: 'DS/WP/0043' },
            expiresOn: { from: '2027-01-14', to: '2027-01-15' },
          },
          removedVehicleClasses: [],
        },
      });
    });

    it('drops offerings when the grade is corrected downwards', async () => {
      const { service, main, actor, codes } = setup();
      const owner = actor();
      await service.recordLicence(owner, main.id, GRADE_A_LICENCE, META);
      const result = await service.correctLicence(
        owner,
        main.id,
        { grade: DrivingSchoolGrade.C },
        META,
      );
      expect(result.removedVehicleClasses).toEqual([
        'C1',
        'C',
        'CE',
        'D1',
        'D',
        'DE',
        'G1',
        'J',
      ]);
      expect(codes(result.profile.offeredClasses)).toEqual([
        'A1',
        'A',
        'B1',
        'B',
        'G',
      ]);
    });

    it('is a no-op without changes, and requires a licence', async () => {
      const { service, main, actor, auditRepo } = setup();
      const owner = actor();
      await expectAppError(
        service.correctLicence(owner, main.id, { grade: 'B' }, META),
        'BRANCH_LICENCE_MISSING',
      );
      await service.recordLicence(owner, main.id, GRADE_A_LICENCE, META);
      await service.correctLicence(
        owner,
        main.id,
        { licenceNumber: 'DS/WP/0042' },
        META,
      );
      expect(auditRepo.entries).toHaveLength(1);
    });

    it('checks the date order against the stored dates', async () => {
      const { service, main, actor } = setup();
      const owner = actor();
      await service.recordLicence(owner, main.id, GRADE_A_LICENCE, META);
      await expectAppError(
        service.correctLicence(
          owner,
          main.id,
          { expiresOn: '2025-12-31' },
          META,
        ),
        'INVALID_LICENCE_DATES',
      );
    });
  });

  describe('setOfferedClasses', () => {
    it('replaces the offered set and audits what changed', async () => {
      const { service, main, actor, auditRepo, codes } = setup();
      const owner = actor();
      await service.recordLicence(owner, main.id, GRADE_A_LICENCE, META);
      await service.setOfferedClasses(owner, main.id, ['B', 'A1'], META);
      const profile = await service.setOfferedClasses(
        owner,
        main.id,
        ['b', 'A1', 'CE'],
        META,
      );
      expect(codes(profile.offeredClasses)).toEqual(['A1', 'B', 'CE']);
      expect(auditRepo.entries[2]).toMatchObject({
        action: 'BRANCH_VEHICLE_CLASSES_CHANGED',
        metadata: { added: ['CE'], removed: [] },
      });
      // Same set again: no audit entry.
      await service.setOfferedClasses(owner, main.id, ['CE', 'B', 'A1'], META);
      expect(auditRepo.entries).toHaveLength(3);
    });

    it('allows offering nothing (the branch is then not operational)', async () => {
      const { service, main, actor } = setup();
      const owner = actor();
      await service.recordLicence(owner, main.id, GRADE_A_LICENCE, META);
      const profile = await service.setOfferedClasses(owner, main.id, [], META);
      expect(profile.readiness.blockers).toEqual([
        { code: 'NO_VEHICLE_CLASSES_OFFERED' },
      ]);
    });

    it('rejects classes the grade does not permit, unknown codes and missing licences', async () => {
      const { service, main, actor } = setup();
      const owner = actor();
      await expectAppError(
        service.setOfferedClasses(owner, main.id, ['B'], META),
        'BRANCH_LICENCE_MISSING',
      );
      await service.recordLicence(
        owner,
        main.id,
        { ...GRADE_A_LICENCE, grade: DrivingSchoolGrade.C },
        META,
      );
      const error = await expectAppError(
        service.setOfferedClasses(owner, main.id, ['B', 'CE'], META),
        'VEHICLE_CLASS_NOT_PERMITTED',
      );
      expect(error.message).toContain('CE');
      await expectAppError(
        service.setOfferedClasses(owner, main.id, ['XX'], META),
        'UNKNOWN_VEHICLE_CLASS',
      );
    });
  });
});

describe('BranchCapabilityService', () => {
  it('requires a licence and an offered class, but never a valid expiry', async () => {
    const { service, capability, tenantId, main, actor } = setup();
    await expectAppError(
      capability.assertCanServe(tenantId, main.id, 'B'),
      'BRANCH_PROFILE_INCOMPLETE',
    );
    const owner = actor();
    await service.recordLicence(
      owner,
      main.id,
      { ...GRADE_A_LICENCE, issuedOn: '2020-01-01', expiresOn: '2021-01-01' },
      META,
    );
    await service.setOfferedClasses(owner, main.id, ['B'], META);
    await expect(
      capability.assertCanServe(tenantId, main.id, 'B'),
    ).resolves.toBeUndefined();
    await expectAppError(
      capability.assertCanServe(tenantId, main.id, 'A'),
      'VEHICLE_CLASS_NOT_OFFERED',
    );
    await expectAppError(
      capability.assertCanServe(tenantId, main.id, 'Q'),
      'UNKNOWN_VEHICLE_CLASS',
    );
  });
});
