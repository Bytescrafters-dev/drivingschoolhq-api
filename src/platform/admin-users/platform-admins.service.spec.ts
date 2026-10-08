import {
  PlatformAdminStatus,
  PlatformRole,
} from '../../generated/prisma/enums.js';
import {
  FakeAuditService,
  FakePasswordHasher,
  FixedClock,
  InMemoryAdminRepository,
  InMemorySessionRepository,
  META,
  actorFrom,
  expectAppError,
  passthroughTx,
} from '../../../test/support/fakes.js';
import { PlatformAuditAction } from '../audit/common/platform-audit-action.js';
import { PlatformAdminsService } from './platform-admins.service.js';

function setup() {
  const admins = new InMemoryAdminRepository();
  const sessions = new InMemorySessionRepository(admins);
  const audit = new FakeAuditService();
  const clock = new FixedClock();
  const service = new PlatformAdminsService(
    admins,
    sessions,
    audit.asService(),
    new FakePasswordHasher().asHasher(),
    passthroughTx,
    clock,
  );
  const superAdmin = admins.seed({ role: PlatformRole.SUPER_ADMIN });
  const actor = actorFrom(superAdmin);
  return { admins, sessions, audit, clock, service, superAdmin, actor };
}

async function openSession(
  sessions: InMemorySessionRepository,
  adminId: string,
) {
  return sessions.create({
    adminId,
    refreshTokenHash: crypto.randomUUID(),
    expiresAt: new Date('2027-01-01'),
    ipAddress: null,
    userAgent: null,
  });
}

describe('PlatformAdminsService', () => {
  describe('createAdmin', () => {
    it('creates an admin with a hashed temporary password that must be changed, and audits it', async () => {
      const { service, admins, audit, actor } = setup();

      const created = await service.createAdmin(
        actor,
        {
          email: '  New@Test.LK ',
          fullName: ' New Admin ',
          role: PlatformRole.BILLING_ADMIN,
          temporaryPassword: 'Temp-Password-1',
        },
        META,
      );

      expect(created).toMatchObject({
        email: 'new@test.lk',
        fullName: 'New Admin',
        role: PlatformRole.BILLING_ADMIN,
        mustChangePassword: true,
        createdById: actor.id,
      });
      expect(admins.get(created.id).passwordHash).toBe(
        'hashed:Temp-Password-1',
      );
      expect(audit.entries).toEqual([
        expect.objectContaining({
          actorAdminId: actor.id,
          action: PlatformAuditAction.ADMIN_CREATED,
          target: { type: 'PLATFORM_ADMIN', id: created.id },
        }),
      ]);
      expect(JSON.stringify(audit.entries)).not.toContain('Temp-Password-1');
    });

    it('allows a super admin to create another super admin', async () => {
      const { service, actor } = setup();
      const created = await service.createAdmin(
        actor,
        {
          email: 'second@test.lk',
          fullName: 'Second',
          role: PlatformRole.SUPER_ADMIN,
          temporaryPassword: 'Temp-Password-1',
        },
        META,
      );
      expect(created.role).toBe(PlatformRole.SUPER_ADMIN);
    });
  });

  describe('self-modification', () => {
    it.each([
      [
        'changeRole',
        (s: PlatformAdminsService, a: ReturnType<typeof actorFrom>) =>
          s.changeRole(a, a.id, PlatformRole.SUPPORT, META),
      ],
      [
        'disable',
        (s: PlatformAdminsService, a: ReturnType<typeof actorFrom>) =>
          s.disable(a, a.id, META),
      ],
      [
        'resetPassword',
        (s: PlatformAdminsService, a: ReturnType<typeof actorFrom>) =>
          s.resetPassword(a, a.id, 'Another-Temp-1', META),
      ],
    ])('rejects %s on own account', async (_name, call) => {
      const { service, actor, superAdmin, audit } = setup();
      await expectAppError(call(service, actor), 'CANNOT_MODIFY_OWN_ACCOUNT');
      expect(superAdmin.role).toBe(PlatformRole.SUPER_ADMIN);
      expect(audit.entries).toHaveLength(0);
    });

    it('allows updating own full name', async () => {
      const { service, actor } = setup();
      const updated = await service.updateFullName(
        actor,
        actor.id,
        'Renamed',
        META,
      );
      expect(updated.fullName).toBe('Renamed');
    });
  });

  describe('changeRole', () => {
    it('changes role, revokes the target sessions and audits from/to', async () => {
      const { service, admins, sessions, audit, actor } = setup();
      const target = admins.seed({ role: PlatformRole.SUPPORT });
      await openSession(sessions, target.id);

      const updated = await service.changeRole(
        actor,
        target.id,
        PlatformRole.BILLING_ADMIN,
        META,
      );

      expect(updated.role).toBe(PlatformRole.BILLING_ADMIN);
      expect(sessions.activeFor(target.id)).toHaveLength(0);
      expect(audit.entries[0]).toMatchObject({
        action: PlatformAuditAction.ADMIN_ROLE_CHANGED,
        metadata: {
          role: { from: PlatformRole.SUPPORT, to: PlatformRole.BILLING_ADMIN },
        },
      });
    });

    it('is a no-op when the role is unchanged', async () => {
      const { service, admins, sessions, audit, actor } = setup();
      const target = admins.seed({ role: PlatformRole.SUPPORT });
      await openSession(sessions, target.id);

      await service.changeRole(actor, target.id, PlatformRole.SUPPORT, META);

      expect(sessions.activeFor(target.id)).toHaveLength(1);
      expect(audit.entries).toHaveLength(0);
    });

    it('allows demoting another super admin while the actor remains', async () => {
      const { service, admins, actor } = setup();
      const other = admins.seed({ role: PlatformRole.SUPER_ADMIN });
      const updated = await service.changeRole(
        actor,
        other.id,
        PlatformRole.SUPPORT,
        META,
      );
      expect(updated.role).toBe(PlatformRole.SUPPORT);
    });

    it('rejects demoting a super admin when the actor lost super admin status concurrently', async () => {
      const { service, admins, actor } = setup();
      const other = admins.seed({ role: PlatformRole.SUPER_ADMIN });
      admins.lockedSuperAdminIdsOverride = [other.id];

      await expectAppError(
        service.changeRole(actor, other.id, PlatformRole.SUPPORT, META),
        'PLATFORM_PERMISSION_DENIED',
      );
      expect(admins.get(other.id).admin.role).toBe(PlatformRole.SUPER_ADMIN);
    });

    it('returns PLATFORM_ADMIN_NOT_FOUND for unknown ids', async () => {
      const { service, actor } = setup();
      await expectAppError(
        service.changeRole(
          actor,
          crypto.randomUUID(),
          PlatformRole.SUPPORT,
          META,
        ),
        'PLATFORM_ADMIN_NOT_FOUND',
      );
    });
  });

  describe('disable / enable', () => {
    it('disables, revokes sessions and audits', async () => {
      const { service, admins, sessions, audit, actor, clock } = setup();
      const target = admins.seed({ role: PlatformRole.BILLING_ADMIN });
      await openSession(sessions, target.id);
      await openSession(sessions, target.id);

      const updated = await service.disable(actor, target.id, META);

      expect(updated.status).toBe(PlatformAdminStatus.DISABLED);
      expect(updated.disabledAt).toEqual(clock.now());
      expect(sessions.activeFor(target.id)).toHaveLength(0);
      expect(audit.actions()).toEqual([PlatformAuditAction.ADMIN_DISABLED]);
    });

    it('rejects disabling an already disabled admin', async () => {
      const { service, admins, actor } = setup();
      const target = admins.seed({ status: PlatformAdminStatus.DISABLED });
      await expectAppError(
        service.disable(actor, target.id, META),
        'PLATFORM_ADMIN_ALREADY_DISABLED',
      );
    });

    it('rejects disabling a super admin when the actor is no longer an active super admin', async () => {
      const { service, admins, actor } = setup();
      const other = admins.seed({ role: PlatformRole.SUPER_ADMIN });
      admins.lockedSuperAdminIdsOverride = [other.id];
      await expectAppError(
        service.disable(actor, other.id, META),
        'PLATFORM_PERMISSION_DENIED',
      );
      expect(admins.get(other.id).admin.status).toBe(
        PlatformAdminStatus.ACTIVE,
      );
    });

    it('re-enables a disabled admin and audits', async () => {
      const { service, admins, audit, actor } = setup();
      const target = admins.seed({
        status: PlatformAdminStatus.DISABLED,
        disabledAt: new Date(),
      });
      const updated = await service.enable(actor, target.id, META);
      expect(updated).toMatchObject({
        status: PlatformAdminStatus.ACTIVE,
        disabledAt: null,
      });
      expect(audit.actions()).toEqual([PlatformAuditAction.ADMIN_ENABLED]);
    });

    it('rejects enabling an active admin', async () => {
      const { service, admins, actor } = setup();
      const target = admins.seed();
      await expectAppError(
        service.enable(actor, target.id, META),
        'PLATFORM_ADMIN_ALREADY_ACTIVE',
      );
    });
  });

  describe('resetPassword', () => {
    it('sets a new temporary password, forces change, revokes sessions and audits without the secret', async () => {
      const { service, admins, sessions, audit, actor } = setup();
      const target = admins.seed({
        role: PlatformRole.SUPPORT,
        mustChangePassword: false,
      });
      await openSession(sessions, target.id);

      const updated = await service.resetPassword(
        actor,
        target.id,
        'Fresh-Temp-Pass-1',
        META,
      );

      expect(updated.mustChangePassword).toBe(true);
      expect(admins.get(target.id).passwordHash).toBe(
        'hashed:Fresh-Temp-Pass-1',
      );
      expect(sessions.activeFor(target.id)).toHaveLength(0);
      expect(audit.actions()).toEqual([
        PlatformAuditAction.ADMIN_PASSWORD_RESET,
      ]);
      expect(JSON.stringify(audit.entries)).not.toContain('Fresh-Temp-Pass-1');
    });
  });
});
