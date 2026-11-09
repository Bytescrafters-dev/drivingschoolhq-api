import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from '../../common/clock/clock.js';
import { AppError } from '../../common/errors/app-error.js';
import type { RequestMeta } from '../../common/http/request-meta.js';
import { businessToday } from '../../common/time/calendar-date.js';
import {
  InstructorProfileStatus,
  PlanLimitCode,
  TenantRole,
  TenantUserBranchAccess,
  TenantUserStatus,
} from '../../generated/prisma/enums.js';
import { TenantEntitlementsService } from '../../platform/entitlements/tenant-entitlements.service.js';
import { TransactionManager } from '../../prisma/transaction-manager.js';
import type { VehicleClass } from '../../reference-data/vehicle-classes/interfaces/vehicle-class.repository.js';
import { classesForLicence } from '../../reference-data/vehicle-classes/licence-classes.js';
import {
  assertLicenceDateOrder,
  diffLicence,
  type LicenceInput,
  licenceMetadata,
  parseLicence,
  parseLicenceChange,
} from '../../reference-data/vehicle-classes/licence-details.js';
import { VehicleClassCatalogService } from '../../reference-data/vehicle-classes/vehicle-class-catalog.service.js';
import {
  TenantAuditAction,
  TenantAuditTarget,
} from '../audit/common/tenant-audit-action.js';
import { TenantAuditService } from '../audit/tenant-audit.service.js';
import type { AuthenticatedTenantUser } from '../auth/interfaces/authenticated-tenant-user.js';
import { viewerOf } from '../branches/branch-access.service.js';
import {
  BRANCH_REPOSITORY,
  type BranchRepository,
} from '../branches/interfaces/branch.repository.js';
import type { WorkingBranch } from '../branches/interfaces/working-branch.js';
import {
  BRANCH_PROFILE_REPOSITORY,
  type BranchProfileRepository,
} from '../branches/profile/interfaces/branch-profile.repository.js';
import {
  TENANT_CONTEXT_REPOSITORY,
  type TenantContextRepository,
} from '../context/interfaces/tenant-context.repository.js';
import { TenantPermission } from '../permissions/tenant-permission.js';
import { tenantRoleHasPermissions } from '../permissions/tenant-role-permissions.js';
import {
  STAFF_REPOSITORY,
  type StaffMember,
  type StaffRepository,
} from '../staff/interfaces/staff.repository.js';
import {
  loadStaffActor,
  principalOf,
  type StaffActor,
} from '../staff/staff-actor.js';
import { teachableClassIds } from './instructor-capability.service.js';
import {
  type InstructorAction,
  type InstructorActor,
  type InstructorDenial,
  instructorDenial,
  mayAct,
} from './instructor-policy.js';
import {
  evaluateInstructorReadiness,
  type InstructorProfileState,
  type InstructorReadiness,
  profileStateOf,
} from './instructor-readiness.js';
import {
  INSTRUCTOR_PROFILE_REPOSITORY,
  type InstructorLicence,
  type InstructorPerson,
  type InstructorProfile,
  type InstructorProfileRepository,
  type InstructorUser,
} from './interfaces/instructor-profile.repository.js';

/** A person on the instructors page as seen by a particular actor. */
export interface InstructorView {
  person: InstructorPerson;
  state: InstructorProfileState;
  qualifiedClasses: VehicleClass[];
  readiness: InstructorReadiness;
  /** The actor may create a profile for this person (none exists yet). */
  canCreate: boolean;
  /** The actor may edit the licence and classes. */
  canEdit: boolean;
  /** The actor may inactivate/reactivate the profile. */
  canChangeStatus: boolean;
}

export interface InstructorListItem extends InstructorView {
  /** Qualified ∩ offered by the working branch. */
  teachableHere: VehicleClass[];
}

export interface InstructorBranchTeaching {
  id: string;
  name: string;
  /** Qualified ∩ offered by this branch. */
  teachableClasses: VehicleClass[];
}

export interface InstructorDetail extends InstructorView {
  /** Every licence, newest first (empty without a profile). */
  licenceHistory: InstructorLicence[];
  /** Classes the current grade permits (empty without a profile). */
  permittedClasses: VehicleClass[];
  /** ACTIVE branches the person works in that the actor can see. */
  branches: InstructorBranchTeaching[];
}

export interface InstructorChangeResult {
  detail: InstructorDetail;
  /** Qualified classes dropped because the new grade does not permit them. */
  removedVehicleClasses: string[];
}

export type InstructorListFilter = { profileStatus?: InstructorProfileState };

interface ActorContext extends InstructorActor {
  staff: StaffActor;
}

interface LockedTarget {
  context: ActorContext;
  user: InstructorUser;
  profile: InstructorProfile | null;
}

/**
 * Instructor profiles: any staff member may hold one; it is tenant-scoped
 * and the person teaches wherever their staff access lets them work.
 * Rules live in `instructor-policy.ts` and `instructor-readiness.ts`;
 * invariants enforced here:
 * - ACTIVE profiles never exceed MAX_INSTRUCTORS when a profile is created or
 *   reactivated; inactivating frees a seat; plan downgrades and staff
 *   changes inactivate nobody (a disabled staff member keeps their seat);
 * - qualified classes ⊆ classes the current grade permits: the first licence
 *   pre-fills every permitted class, a lower grade drops the rest (audited),
 *   a higher grade adds nothing;
 * - profiles are never deleted, only inactivated (history references them).
 * Writes lock tenant → user → profile and are audited in the same
 * transaction.
 */
@Injectable()
export class InstructorsService {
  constructor(
    @Inject(INSTRUCTOR_PROFILE_REPOSITORY)
    private readonly profiles: InstructorProfileRepository,
    @Inject(STAFF_REPOSITORY) private readonly staff: StaffRepository,
    @Inject(BRANCH_REPOSITORY) private readonly branches: BranchRepository,
    @Inject(BRANCH_PROFILE_REPOSITORY)
    private readonly branchProfiles: BranchProfileRepository,
    @Inject(TENANT_CONTEXT_REPOSITORY)
    private readonly tenants: TenantContextRepository,
    private readonly catalog: VehicleClassCatalogService,
    private readonly entitlements: TenantEntitlementsService,
    private readonly audit: TenantAuditService,
    private readonly tx: TransactionManager,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Instructors who can work in the working branch (any profile state). */
  async list(
    actor: AuthenticatedTenantUser,
    branch: WorkingBranch,
    filter: InstructorListFilter,
  ): Promise<InstructorListItem[]> {
    const [context, people, classes, offeredIds] = await Promise.all([
      this.actorContext(actor),
      this.profiles.listForBranch(actor.tenantId, branch.id),
      this.catalog.list(),
      this.offeredIds(actor.tenantId, branch.id),
    ]);
    const today = this.today();
    return people
      .map((person) => ({
        ...this.view(context, person, classes, today),
        teachableHere: classesIn(
          classes,
          person.profile
            ? teachableClassIds(
                offeredIds,
                person.profile.qualifiedVehicleClassIds,
              )
            : [],
        ),
      }))
      .filter(
        (item) => !filter.profileStatus || item.state === filter.profileStatus,
      );
  }

  /**
   * Staff of the working branch without a profile for whom the actor may
   * create one (people they manage, and themselves).
   */
  async candidates(
    actor: AuthenticatedTenantUser,
    branch: WorkingBranch,
  ): Promise<InstructorView[]> {
    const [context, people, classes] = await Promise.all([
      this.actorContext(actor),
      this.profiles.listCandidates(actor.tenantId, branch.id),
      this.catalog.list(),
    ]);
    const today = this.today();
    return people
      .map((person) => this.view(context, person, classes, today))
      .filter((view) => view.canCreate);
  }

  /** A visible person who has a profile or the INSTRUCTOR role. */
  async get(
    actor: AuthenticatedTenantUser,
    userId: string,
  ): Promise<InstructorDetail> {
    const context = await this.actorContext(actor);
    const member = await this.staff.findVisible(context.staff.viewer, userId);
    if (!member) throw instructorNotFound();
    const profile = await this.profiles.findByUserId(actor.tenantId, userId);
    if (!profile && member.role !== TenantRole.INSTRUCTOR)
      throw instructorNotFound();
    return this.detail(context, { user: toInstructorUser(member), profile });
  }

  /** The actor's own instructor profile state (SETUP_REQUIRED without one). */
  async mine(actor: AuthenticatedTenantUser): Promise<InstructorDetail> {
    const context = await this.actorContext(actor);
    const member = await this.staff.findVisible(context.staff.viewer, actor.id);
    if (!member) throw instructorNotFound();
    const profile = await this.profiles.findByUserId(actor.tenantId, actor.id);
    return this.detail(context, { user: toInstructorUser(member), profile });
  }

  /** Creates an ACTIVE profile with the first licence; uses a seat. */
  async createProfile(
    actor: AuthenticatedTenantUser,
    userId: string,
    input: LicenceInput,
    meta: RequestMeta,
  ): Promise<InstructorDetail> {
    const details = parseLicence(input);
    return this.tx.run(async () => {
      const target = await this.lockTarget(actor, userId, 'CREATE');
      if (target.profile) {
        throw new AppError(
          'CONFLICT',
          'INSTRUCTOR_PROFILE_EXISTS',
          'This person already has an instructor profile',
        );
      }
      assertStaffActive(target.user);
      await this.entitlements.assertCanAdd(
        actor.tenantId,
        PlanLimitCode.MAX_INSTRUCTORS,
        await this.profiles.countActive(actor.tenantId),
      );
      const permitted = await this.catalog.permittedFor(details.grade);
      const profile = await this.profiles.create({
        tenantId: actor.tenantId,
        tenantUserId: userId,
        createdByTenantUserId: actor.id,
        licence: details,
        vehicleClassIds: permitted.map((c) => c.id),
      });
      await this.audited(
        actor,
        userId,
        TenantAuditAction.INSTRUCTOR_PROFILE_CREATED,
        meta,
        {
          instructorProfileId: profile.id,
          licenceId: profile.currentLicence!.id,
          ...licenceMetadata(details),
          vehicleClasses: permitted.map((c) => c.code),
        },
      );
      return this.detail(target.context, { user: target.user, profile });
    });
  }

  /** Records a renewal; older licences stay as history. */
  async recordLicence(
    actor: AuthenticatedTenantUser,
    userId: string,
    input: LicenceInput,
    meta: RequestMeta,
  ): Promise<InstructorChangeResult> {
    const details = parseLicence(input);
    return this.tx.run(async () => {
      const target = await this.lockTarget(actor, userId, 'EDIT');
      const profile = requireProfile(target.profile);
      const previous = profile.currentLicence;
      const permitted = await this.catalog.permittedFor(details.grade);
      const change = classesForLicence({
        isFirstLicence: previous === null,
        currentIds: profile.qualifiedVehicleClassIds,
        permittedIds: permitted.map((c) => c.id),
      });
      const licence = await this.profiles.recordLicence(
        actor.tenantId,
        profile.id,
        details,
        actor.id,
      );
      await this.profiles.replaceQualifiedClasses(
        actor.tenantId,
        profile.id,
        change.next,
      );
      const removed = await this.codesOf(change.removed);
      await this.audited(
        actor,
        userId,
        TenantAuditAction.INSTRUCTOR_LICENCE_RECORDED,
        meta,
        {
          instructorProfileId: profile.id,
          licenceId: licence.id,
          ...licenceMetadata(licence),
          previousLicenceId: previous?.id ?? null,
          previousGrade: previous?.grade ?? null,
          removedVehicleClasses: removed,
        },
      );
      return {
        detail: await this.reloadDetail(target),
        removedVehicleClasses: removed,
      };
    });
  }

  /** Fixes a mistake in the current licence (no new history row). */
  async correctLicence(
    actor: AuthenticatedTenantUser,
    userId: string,
    input: Partial<LicenceInput>,
    meta: RequestMeta,
  ): Promise<InstructorChangeResult> {
    const change = parseLicenceChange(input);
    return this.tx.run(async () => {
      const target = await this.lockTarget(actor, userId, 'EDIT');
      const profile = requireProfile(target.profile);
      const current = profile.currentLicence;
      if (!current) throw profileMissing();
      assertLicenceDateOrder({ ...current, ...change });
      const changes = diffLicence(current, change);
      if (Object.keys(changes).length === 0) {
        return {
          detail: await this.detail(target.context, target),
          removedVehicleClasses: [],
        };
      }
      const corrected = await this.profiles.correctLicence(
        actor.tenantId,
        profile.id,
        current.id,
        change,
      );
      let removed: string[] = [];
      if (corrected.grade !== current.grade) {
        const permitted = await this.catalog.permittedFor(corrected.grade);
        const classes = classesForLicence({
          isFirstLicence: false,
          currentIds: profile.qualifiedVehicleClassIds,
          permittedIds: permitted.map((c) => c.id),
        });
        await this.profiles.replaceQualifiedClasses(
          actor.tenantId,
          profile.id,
          classes.next,
        );
        removed = await this.codesOf(classes.removed);
      }
      await this.audited(
        actor,
        userId,
        TenantAuditAction.INSTRUCTOR_LICENCE_CORRECTED,
        meta,
        {
          instructorProfileId: profile.id,
          licenceId: current.id,
          changes,
          removedVehicleClasses: removed,
        },
      );
      return {
        detail: await this.reloadDetail(target),
        removedVehicleClasses: removed,
      };
    });
  }

  /** Replaces the qualified classes; each must be permitted by the grade. */
  async setQualifiedClasses(
    actor: AuthenticatedTenantUser,
    userId: string,
    codes: string[],
    meta: RequestMeta,
  ): Promise<InstructorDetail> {
    const requested = await this.catalog.resolveCodes(codes);
    return this.tx.run(async () => {
      const target = await this.lockTarget(actor, userId, 'EDIT');
      const profile = requireProfile(target.profile);
      if (!profile.currentLicence) throw profileMissing();
      const grade = profile.currentLicence.grade;
      const notPermitted = requested.filter(
        (c) => !c.permittedGrades.includes(grade),
      );
      if (notPermitted.length > 0) {
        throw new AppError(
          'CONFLICT',
          'VEHICLE_CLASS_NOT_PERMITTED',
          `A Grade ${grade} instructor may not teach: ${notPermitted.map((c) => c.code).join(', ')}`,
        );
      }
      const before = new Set(profile.qualifiedVehicleClassIds);
      const after = new Set(requested.map((c) => c.id));
      const added = requested.filter((c) => !before.has(c.id));
      const removedIds = profile.qualifiedVehicleClassIds.filter(
        (id) => !after.has(id),
      );
      if (added.length === 0 && removedIds.length === 0) {
        return this.detail(target.context, target);
      }
      await this.profiles.replaceQualifiedClasses(actor.tenantId, profile.id, [
        ...after,
      ]);
      await this.audited(
        actor,
        userId,
        TenantAuditAction.INSTRUCTOR_VEHICLE_CLASSES_CHANGED,
        meta,
        {
          instructorProfileId: profile.id,
          added: added.map((c) => c.code),
          removed: await this.codesOf(removedIds),
        },
      );
      return this.reloadDetail(target);
    });
  }

  /** Frees the seat; history stays. Idempotent. */
  async inactivate(
    actor: AuthenticatedTenantUser,
    userId: string,
    meta: RequestMeta,
  ): Promise<InstructorDetail> {
    return this.tx.run(async () => {
      const target = await this.lockTarget(actor, userId, 'SET_STATUS');
      const profile = requireProfile(target.profile);
      if (profile.status === InstructorProfileStatus.INACTIVE) {
        return this.detail(target.context, target);
      }
      const updated = await this.profiles.setStatus(
        actor.tenantId,
        profile.id,
        InstructorProfileStatus.INACTIVE,
        this.clock.now(),
      );
      await this.audited(
        actor,
        userId,
        TenantAuditAction.INSTRUCTOR_PROFILE_INACTIVATED,
        meta,
        { instructorProfileId: profile.id },
      );
      return this.detail(target.context, { ...target, profile: updated });
    });
  }

  /** Takes a seat again; the staff member must be ACTIVE. Idempotent. */
  async reactivate(
    actor: AuthenticatedTenantUser,
    userId: string,
    meta: RequestMeta,
  ): Promise<InstructorDetail> {
    return this.tx.run(async () => {
      const target = await this.lockTarget(actor, userId, 'SET_STATUS');
      const profile = requireProfile(target.profile);
      if (profile.status === InstructorProfileStatus.ACTIVE) {
        return this.detail(target.context, target);
      }
      assertStaffActive(target.user);
      await this.entitlements.assertCanAdd(
        actor.tenantId,
        PlanLimitCode.MAX_INSTRUCTORS,
        await this.profiles.countActive(actor.tenantId),
      );
      const updated = await this.profiles.setStatus(
        actor.tenantId,
        profile.id,
        InstructorProfileStatus.ACTIVE,
        null,
      );
      await this.audited(
        actor,
        userId,
        TenantAuditAction.INSTRUCTOR_PROFILE_REACTIVATED,
        meta,
        { instructorProfileId: profile.id },
      );
      return this.detail(target.context, { ...target, profile: updated });
    });
  }

  private async actorContext(
    actor: AuthenticatedTenantUser,
  ): Promise<ActorContext> {
    const staff = await loadStaffActor(this.branches, actor);
    return {
      staff,
      principal: staff.principal,
      canManageInstructors: tenantRoleHasPermissions(actor.role, [
        TenantPermission.INSTRUCTORS_MANAGE,
      ]),
    };
  }

  /** Locks tenant → user → profile; throws unless the actor may act. */
  private async lockTarget(
    actor: AuthenticatedTenantUser,
    userId: string,
    action: InstructorAction,
  ): Promise<LockedTarget> {
    if (!(await this.tenants.lockById(actor.tenantId))) {
      throw new AppError(
        'UNAUTHORIZED',
        'SESSION_INVALID',
        'Session is no longer valid',
      );
    }
    const context = await this.actorContext(actor);
    const member = await this.staff.lockVisible(context.staff.viewer, userId);
    if (!member) throw instructorNotFound();
    const denial = instructorDenial(context, principalOf(member), action);
    if (denial) throw managementDenied(denial, action);
    const profile = await this.profiles.lockByUserId(actor.tenantId, userId);
    return { context, user: toInstructorUser(member), profile };
  }

  private view(
    context: ActorContext,
    person: InstructorPerson,
    classes: VehicleClass[],
    today: Date,
  ): InstructorView {
    const { user, profile } = person;
    const principal = principalOf(user);
    return {
      person,
      state: profileStateOf(profile),
      qualifiedClasses: classesIn(
        classes,
        profile?.qualifiedVehicleClassIds ?? [],
      ),
      readiness: evaluateInstructorReadiness(
        {
          staffStatus: user.status,
          profile: profile
            ? {
                status: profile.status,
                licence: profile.currentLicence,
                qualifiedClassCount: profile.qualifiedVehicleClassIds.length,
              }
            : null,
        },
        today,
      ),
      canCreate:
        !profile &&
        user.status === TenantUserStatus.ACTIVE &&
        mayAct(context, principal, 'CREATE'),
      canEdit: !!profile && mayAct(context, principal, 'EDIT'),
      canChangeStatus: !!profile && mayAct(context, principal, 'SET_STATUS'),
    };
  }

  private async detail(
    context: ActorContext,
    person: InstructorPerson,
  ): Promise<InstructorDetail> {
    const { user, profile } = person;
    const [classes, licenceHistory, working] = await Promise.all([
      this.catalog.list(),
      profile
        ? this.profiles.listLicences(user.tenantId, profile.id)
        : Promise.resolve([]),
      this.branches.listAccessible(viewerOf(user), { includeClosed: false }),
    ]);
    const viewer = context.staff.viewer;
    const visible =
      viewer.branchAccess === TenantUserBranchAccess.ALL
        ? working
        : working.filter((b) => viewer.branchIds.includes(b.id));
    const states = await this.branchProfiles.states(
      user.tenantId,
      visible.map((b) => b.id),
    );
    const grade = profile?.currentLicence?.grade;
    return {
      ...this.view(context, person, classes, this.today()),
      licenceHistory,
      permittedClasses: grade
        ? classes.filter((c) => c.permittedGrades.includes(grade))
        : [],
      branches: visible.map((branch) => ({
        id: branch.id,
        name: branch.name,
        teachableClasses: classesIn(
          classes,
          profile
            ? teachableClassIds(
                states.get(branch.id)?.offeredVehicleClassIds ?? [],
                profile.qualifiedVehicleClassIds,
              )
            : [],
        ),
      })),
    };
  }

  private async reloadDetail(target: LockedTarget): Promise<InstructorDetail> {
    const profile = await this.profiles.findByUserId(
      target.user.tenantId,
      target.user.id,
    );
    return this.detail(target.context, { user: target.user, profile });
  }

  private async offeredIds(
    tenantId: string,
    branchId: string,
  ): Promise<string[]> {
    const states = await this.branchProfiles.states(tenantId, [branchId]);
    return states.get(branchId)?.offeredVehicleClassIds ?? [];
  }

  /** Codes of class ids in DMT order. */
  private async codesOf(ids: string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    return classesIn(await this.catalog.list(), ids).map((c) => c.code);
  }

  private today(): Date {
    return businessToday(this.clock.now());
  }

  private audited(
    actor: AuthenticatedTenantUser,
    userId: string,
    action: TenantAuditAction,
    meta: RequestMeta,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    return this.audit.record({
      tenantId: actor.tenantId,
      actorTenantUserId: actor.id,
      action,
      target: { type: TenantAuditTarget.TENANT_USER, id: userId },
      metadata,
      meta,
    });
  }
}

function toInstructorUser(member: StaffMember): InstructorUser {
  return {
    id: member.id,
    tenantId: member.tenantId,
    fullName: member.fullName,
    email: member.email,
    phone: member.phone,
    role: member.role,
    status: member.status,
    branchAccess: member.branchAccess,
    branches: member.branches,
  };
}

/** The catalog classes with the given ids, in DMT order. */
function classesIn(classes: VehicleClass[], ids: readonly string[]) {
  const wanted = new Set(ids);
  return classes.filter((c) => wanted.has(c.id));
}

function assertStaffActive(user: InstructorUser): void {
  if (user.status !== TenantUserStatus.ACTIVE) {
    throw new AppError(
      'CONFLICT',
      'STAFF_DISABLED',
      'Enable this staff member before activating their instructor profile',
    );
  }
}

function requireProfile(profile: InstructorProfile | null): InstructorProfile {
  if (!profile) throw profileMissing();
  return profile;
}

function profileMissing(): AppError {
  return new AppError(
    'CONFLICT',
    'INSTRUCTOR_PROFILE_MISSING',
    'Create the instructor profile first',
  );
}

function instructorNotFound(): AppError {
  return new AppError(
    'NOT_FOUND',
    'INSTRUCTOR_NOT_FOUND',
    'Instructor not found',
  );
}

function managementDenied(
  denial: InstructorDenial,
  action: InstructorAction,
): AppError {
  const message =
    denial === 'ROLE'
      ? 'You can only manage instructor profiles of staff with a role below yours'
      : denial === 'ACCESS'
        ? 'You can only manage instructor profiles of staff whose branches you also have'
        : action === 'SET_STATUS'
          ? 'Only owners, admins and branch managers can activate or inactivate instructor profiles'
          : "You cannot manage other people's instructor profiles";
  return new AppError('FORBIDDEN', 'INSTRUCTOR_MANAGEMENT_DENIED', message);
}
