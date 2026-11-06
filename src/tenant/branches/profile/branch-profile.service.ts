import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error.js';
import type { RequestMeta } from '../../../common/http/request-meta.js';
import { parseIsoDate, toIsoDate } from '../../../common/time/calendar-date.js';
import {
  BranchStatus,
  type DrivingSchoolGrade,
} from '../../../generated/prisma/enums.js';
import { TransactionManager } from '../../../prisma/transaction-manager.js';
import type { VehicleClass } from '../../../reference-data/vehicle-classes/interfaces/vehicle-class.repository.js';
import { VehicleClassCatalogService } from '../../../reference-data/vehicle-classes/vehicle-class-catalog.service.js';
import {
  TenantAuditAction,
  TenantAuditTarget,
} from '../../audit/common/tenant-audit-action.js';
import { TenantAuditService } from '../../audit/tenant-audit.service.js';
import type { AuthenticatedTenantUser } from '../../auth/interfaces/authenticated-tenant-user.js';
import { viewerOf } from '../branch-access.service.js';
import {
  BRANCH_REPOSITORY,
  type Branch,
  type BranchRepository,
} from '../interfaces/branch.repository.js';
import { offeringsForLicence } from './branch-offerings.js';
import {
  type BranchProfile,
  BranchProfileReader,
} from './branch-profile-reader.service.js';
import {
  BRANCH_PROFILE_REPOSITORY,
  type BranchProfileRepository,
  type BranchSchoolLicence,
  type LicenceDetails,
} from './interfaces/branch-profile.repository.js';

/** Licence fields as received (calendar dates as YYYY-MM-DD). */
export interface LicenceInput {
  licenceNumber: string;
  grade: DrivingSchoolGrade;
  issuedOn: string;
  expiresOn: string;
}

export interface LicenceChangeResult {
  profile: BranchProfile;
  /** Offered classes dropped because the new grade does not permit them. */
  removedVehicleClasses: string[];
}

/**
 * Branch profile use cases (OWNER/ADMIN via BRANCHES_MANAGE):
 * - the licence is data entry only; its validity is the school's
 *   responsibility, so expiry never blocks anything;
 * - offered classes ⊆ classes the current grade permits: the first licence
 *   pre-fills every permitted class, a lower grade drops the rest
 *   (audited), a higher grade adds nothing;
 * - closed branches cannot be edited.
 * Writes lock the branch row and are audited in the same transaction.
 * Existing operational records reference VehicleClass, not the offering, so
 * dropping an offering only stops new work for that class.
 */
@Injectable()
export class BranchProfileService {
  constructor(
    @Inject(BRANCH_REPOSITORY) private readonly branches: BranchRepository,
    @Inject(BRANCH_PROFILE_REPOSITORY)
    private readonly profiles: BranchProfileRepository,
    private readonly reader: BranchProfileReader,
    private readonly catalog: VehicleClassCatalogService,
    private readonly audit: TenantAuditService,
    private readonly tx: TransactionManager,
  ) {}

  async get(
    actor: AuthenticatedTenantUser,
    branchId: string,
  ): Promise<BranchProfile> {
    const branch = await this.branches.findAccessible(
      viewerOf(actor),
      branchId,
    );
    if (!branch) throw branchNotFound();
    return this.reader.profile(branch);
  }

  /** Records the first licence or a renewal; older licences stay as history. */
  async recordLicence(
    actor: AuthenticatedTenantUser,
    branchId: string,
    input: LicenceInput,
    meta: RequestMeta,
  ): Promise<LicenceChangeResult> {
    const details = parseLicence(input);
    assertDateOrder(details);
    return this.tx.run(async () => {
      const branch = await this.lockEditable(actor, branchId);
      const state = await this.state(branch);
      const previous = state.currentLicence;
      const permitted = await this.catalog.permittedFor(details.grade);
      const change = offeringsForLicence({
        isFirstLicence: previous === null,
        offeredIds: state.offeredVehicleClassIds,
        permittedIds: permitted.map((c) => c.id),
      });
      const licence = await this.profiles.recordLicence({
        ...details,
        tenantId: actor.tenantId,
        branchId,
        recordedByTenantUserId: actor.id,
      });
      await this.profiles.replaceOfferedClasses(
        actor.tenantId,
        branchId,
        change.next,
      );
      const removed = await this.codesOf(change.removed);
      await this.audited(
        actor,
        branch,
        TenantAuditAction.BRANCH_LICENCE_RECORDED,
        meta,
        {
          licenceId: licence.id,
          ...licenceMetadata(licence),
          previousLicenceId: previous?.id ?? null,
          previousGrade: previous?.grade ?? null,
          prefilledVehicleClasses: change.prefilled
            ? await this.codesOf(change.next)
            : [],
          removedVehicleClasses: removed,
        },
      );
      return {
        profile: await this.reader.profile(branch),
        removedVehicleClasses: removed,
      };
    });
  }

  /** Fixes a mistake in the current licence (no new history row). */
  async correctLicence(
    actor: AuthenticatedTenantUser,
    branchId: string,
    input: Partial<LicenceInput>,
    meta: RequestMeta,
  ): Promise<LicenceChangeResult> {
    const change = parseLicenceChange(input);
    return this.tx.run(async () => {
      const branch = await this.lockEditable(actor, branchId);
      const state = await this.state(branch);
      const current = state.currentLicence;
      if (!current) throw licenceMissing();
      assertDateOrder({ ...current, ...change });
      const changes = diffLicence(current, change);
      if (Object.keys(changes).length === 0) {
        return {
          profile: await this.reader.profile(branch),
          removedVehicleClasses: [],
        };
      }
      const corrected = await this.profiles.correctLicence(
        actor.tenantId,
        branchId,
        current.id,
        change,
      );
      let removed: string[] = [];
      if (corrected.grade !== current.grade) {
        const permitted = await this.catalog.permittedFor(corrected.grade);
        const offerings = offeringsForLicence({
          isFirstLicence: false,
          offeredIds: state.offeredVehicleClassIds,
          permittedIds: permitted.map((c) => c.id),
        });
        await this.profiles.replaceOfferedClasses(
          actor.tenantId,
          branchId,
          offerings.next,
        );
        removed = await this.codesOf(offerings.removed);
      }
      await this.audited(
        actor,
        branch,
        TenantAuditAction.BRANCH_LICENCE_CORRECTED,
        meta,
        { licenceId: current.id, changes, removedVehicleClasses: removed },
      );
      return {
        profile: await this.reader.profile(branch),
        removedVehicleClasses: removed,
      };
    });
  }

  /** Replaces the offered classes; each must be permitted by the grade. */
  async setOfferedClasses(
    actor: AuthenticatedTenantUser,
    branchId: string,
    codes: string[],
    meta: RequestMeta,
  ): Promise<BranchProfile> {
    const requested = await this.catalog.resolveCodes(codes);
    return this.tx.run(async () => {
      const branch = await this.lockEditable(actor, branchId);
      const state = await this.state(branch);
      if (!state.currentLicence) throw licenceMissing();
      const grade = state.currentLicence.grade;
      const notPermitted = requested.filter(
        (c) => !c.permittedGrades.includes(grade),
      );
      if (notPermitted.length > 0) {
        throw new AppError(
          'CONFLICT',
          'VEHICLE_CLASS_NOT_PERMITTED',
          `A Grade ${grade} school may not offer: ${codesIn(notPermitted).join(', ')}`,
        );
      }
      const before = new Set(state.offeredVehicleClassIds);
      const after = new Set(requested.map((c) => c.id));
      const added = requested.filter((c) => !before.has(c.id));
      const removedIds = state.offeredVehicleClassIds.filter(
        (id) => !after.has(id),
      );
      if (added.length === 0 && removedIds.length === 0) {
        return this.reader.profile(branch);
      }
      await this.profiles.replaceOfferedClasses(actor.tenantId, branchId, [
        ...after,
      ]);
      await this.audited(
        actor,
        branch,
        TenantAuditAction.BRANCH_VEHICLE_CLASSES_CHANGED,
        meta,
        {
          added: codesIn(added),
          removed: await this.codesOf(removedIds),
        },
      );
      return this.reader.profile(branch);
    });
  }

  private async lockEditable(
    actor: AuthenticatedTenantUser,
    branchId: string,
  ): Promise<Branch> {
    const branch = await this.branches.lockAccessible(
      viewerOf(actor),
      branchId,
    );
    if (!branch) throw branchNotFound();
    if (branch.status === BranchStatus.CLOSED) {
      throw new AppError(
        'CONFLICT',
        'BRANCH_CLOSED',
        'A closed branch must be reopened before it can be edited',
      );
    }
    return branch;
  }

  private async state(branch: Branch) {
    const state = (
      await this.profiles.states(branch.tenantId, [branch.id])
    ).get(branch.id);
    return state ?? { currentLicence: null, offeredVehicleClassIds: [] };
  }

  /** Codes of class ids in DMT order. */
  private async codesOf(ids: string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const wanted = new Set(ids);
    return codesIn((await this.catalog.list()).filter((c) => wanted.has(c.id)));
  }

  private audited(
    actor: AuthenticatedTenantUser,
    branch: Branch,
    action: TenantAuditAction,
    meta: RequestMeta,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    return this.audit.record({
      tenantId: actor.tenantId,
      actorTenantUserId: actor.id,
      action,
      target: { type: TenantAuditTarget.BRANCH, id: branch.id },
      branchId: branch.id,
      metadata,
      meta,
    });
  }
}

function parseLicence(input: LicenceInput): LicenceDetails {
  return {
    licenceNumber: requireLicenceNumber(input.licenceNumber),
    grade: input.grade,
    issuedOn: parseDate(input.issuedOn, 'issuedOn'),
    expiresOn: parseDate(input.expiresOn, 'expiresOn'),
  };
}

function parseLicenceChange(
  input: Partial<LicenceInput>,
): Partial<LicenceDetails> {
  const change: Partial<LicenceDetails> = {};
  if (input.licenceNumber !== undefined) {
    change.licenceNumber = requireLicenceNumber(input.licenceNumber);
  }
  if (input.grade !== undefined) change.grade = input.grade;
  if (input.issuedOn !== undefined) {
    change.issuedOn = parseDate(input.issuedOn, 'issuedOn');
  }
  if (input.expiresOn !== undefined) {
    change.expiresOn = parseDate(input.expiresOn, 'expiresOn');
  }
  return change;
}

function requireLicenceNumber(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new AppError(
      'BAD_REQUEST',
      'BAD_REQUEST',
      'licenceNumber is required',
    );
  }
  return trimmed;
}

function parseDate(value: string, field: string): Date {
  try {
    return parseIsoDate(value);
  } catch {
    throw new AppError(
      'BAD_REQUEST',
      'INVALID_LICENCE_DATES',
      `${field} must be a valid YYYY-MM-DD date`,
    );
  }
}

function assertDateOrder(dates: { issuedOn: Date; expiresOn: Date }): void {
  if (dates.expiresOn.getTime() <= dates.issuedOn.getTime()) {
    throw new AppError(
      'BAD_REQUEST',
      'INVALID_LICENCE_DATES',
      'The licence must expire after it was issued',
    );
  }
}

function licenceMetadata(licence: LicenceDetails) {
  return {
    licenceNumber: licence.licenceNumber,
    grade: licence.grade,
    issuedOn: toIsoDate(licence.issuedOn),
    expiresOn: toIsoDate(licence.expiresOn),
  };
}

function diffLicence(
  current: BranchSchoolLicence,
  change: Partial<LicenceDetails>,
): Record<string, { from: string; to: string }> {
  const before = licenceMetadata(current);
  const after = licenceMetadata({ ...current, ...change });
  const changes: Record<string, { from: string; to: string }> = {};
  for (const key of Object.keys(before) as (keyof typeof before)[]) {
    if (before[key] !== after[key]) {
      changes[key] = { from: before[key], to: after[key] };
    }
  }
  return changes;
}

function codesIn(classes: VehicleClass[]): string[] {
  return classes.map((c) => c.code);
}

function licenceMissing(): AppError {
  return new AppError(
    'CONFLICT',
    'BRANCH_LICENCE_MISSING',
    'Record the branch driving-school licence first',
  );
}

function branchNotFound(): AppError {
  return new AppError('NOT_FOUND', 'BRANCH_NOT_FOUND', 'Branch not found');
}
