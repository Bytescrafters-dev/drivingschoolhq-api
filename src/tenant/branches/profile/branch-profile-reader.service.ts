import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from '../../../common/clock/clock.js';
import { businessToday } from '../../../common/time/calendar-date.js';
import type { VehicleClass } from '../../../reference-data/vehicle-classes/interfaces/vehicle-class.repository.js';
import { VehicleClassCatalogService } from '../../../reference-data/vehicle-classes/vehicle-class-catalog.service.js';
import type { Branch } from '../interfaces/branch.repository.js';
import {
  type BranchReadiness,
  evaluateBranchReadiness,
} from './branch-readiness.js';
import {
  BRANCH_PROFILE_REPOSITORY,
  type BranchProfileRepository,
  type BranchProfileState,
  type BranchSchoolLicence,
} from './interfaces/branch-profile.repository.js';

/** Compact profile shown next to a branch in lists. */
export interface BranchProfileSummary {
  currentLicence: BranchSchoolLicence | null;
  offeredClasses: VehicleClass[];
  readiness: BranchReadiness;
}

export interface BranchProfile extends BranchProfileSummary {
  branch: Branch;
  /** Every licence of the branch, newest first. */
  licenceHistory: BranchSchoolLicence[];
  /** Classes the current grade permits (empty without a licence). */
  permittedClasses: VehicleClass[];
}

const EMPTY_STATE: BranchProfileState = {
  currentLicence: null,
  offeredVehicleClassIds: [],
};

/**
 * Read model of branch profiles for tenant and platform views. Callers must
 * have verified access to the branches they pass in.
 */
@Injectable()
export class BranchProfileReader {
  constructor(
    @Inject(BRANCH_PROFILE_REPOSITORY)
    private readonly profiles: BranchProfileRepository,
    private readonly catalog: VehicleClassCatalogService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Summaries keyed by branch id (one entry per given branch). */
  async summaries(
    tenantId: string,
    branches: Branch[],
  ): Promise<Map<string, BranchProfileSummary>> {
    const [states, classes] = await Promise.all([
      this.profiles.states(
        tenantId,
        branches.map((b) => b.id),
      ),
      this.catalog.list(),
    ]);
    const today = businessToday(this.clock.now());
    return new Map(
      branches.map((branch) => [
        branch.id,
        summarize(states.get(branch.id) ?? EMPTY_STATE, classes, today),
      ]),
    );
  }

  async profile(branch: Branch): Promise<BranchProfile> {
    const [summary, licenceHistory] = await Promise.all([
      this.summaries(branch.tenantId, [branch]).then((m) => m.get(branch.id)!),
      this.profiles.listLicences(branch.tenantId, branch.id),
    ]);
    const grade = summary.currentLicence?.grade;
    const permittedClasses = grade
      ? await this.catalog.permittedFor(grade)
      : [];
    return { ...summary, branch, licenceHistory, permittedClasses };
  }
}

function summarize(
  state: BranchProfileState,
  classes: VehicleClass[],
  today: Date,
): BranchProfileSummary {
  const offered = new Set(state.offeredVehicleClassIds);
  const offeredClasses = classes.filter((c) => offered.has(c.id));
  return {
    currentLicence: state.currentLicence,
    offeredClasses,
    readiness: evaluateBranchReadiness(
      {
        licence: state.currentLicence,
        offeredClassCount: offeredClasses.length,
      },
      today,
    ),
  };
}
