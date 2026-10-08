import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import {
  PlatformAdminStatus,
  PlatformRole,
} from '../../src/generated/prisma/enums.js';
import { createTestPrisma, resetDatabase } from '../support/database.js';
import { createPlatformAdmin } from '../support/platform-fixtures.js';

describe('Platform admin auth & management (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    prisma = createTestPrisma();
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(() => resetDatabase(prisma));

  async function login(email: string, password: string) {
    const res = await http()
      .post('/platform/auth/login')
      .send({ email, password })
      .expect(200);
    return res.body as {
      accessToken: string;
      refreshToken: string;
      mustChangePassword: boolean;
    };
  }

  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  it('bootstrap super admin: forced password change, create admin, enforce permissions, revoke on disable, audit trail', async () => {
    await createPlatformAdmin(prisma, {
      email: 'root@test.lk',
      password: 'Seeded-Temp-Pass-1',
      mustChangePassword: true,
    });

    const rootLogin = await login(' Root@Test.lk ', 'Seeded-Temp-Pass-1');
    expect(rootLogin.mustChangePassword).toBe(true);
    const root = rootLogin.accessToken;

    await http()
      .get('/platform/admins')
      .set(bearer(root))
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe('PASSWORD_CHANGE_REQUIRED'));
    await http().get('/platform/auth/me').set(bearer(root)).expect(200);

    await http()
      .post('/platform/auth/change-password')
      .set(bearer(root))
      .send({
        currentPassword: 'Seeded-Temp-Pass-1',
        newPassword: 'Root-Real-Pass-22',
      })
      .expect(204);

    const created = await http()
      .post('/platform/admins')
      .set(bearer(root))
      .send({
        email: 'Billing@Test.lk',
        fullName: 'Billing',
        role: 'BILLING_ADMIN',
        temporaryPassword: 'Billing-Temp-1',
      })
      .expect(201);
    expect(created.body).toMatchObject({
      email: 'billing@test.lk',
      role: 'BILLING_ADMIN',
      mustChangePassword: true,
    });
    expect(created.body).not.toHaveProperty('passwordHash');

    const billingLogin = await login('billing@test.lk', 'Billing-Temp-1');
    await http()
      .post('/platform/auth/change-password')
      .set(bearer(billingLogin.accessToken))
      .send({
        currentPassword: 'Billing-Temp-1',
        newPassword: 'Billing-Real-22',
      })
      .expect(204);

    const me = await http()
      .get('/platform/auth/me')
      .set(bearer(billingLogin.accessToken))
      .expect(200);
    expect(me.body.permissions).toContain('PAYMENTS_RECORD');
    await http()
      .get('/platform/admins')
      .set(bearer(billingLogin.accessToken))
      .expect(403)
      .expect(({ body }) =>
        expect(body.code).toBe('PLATFORM_PERMISSION_DENIED'),
      );
    await http()
      .get('/platform/audit-logs')
      .set(bearer(billingLogin.accessToken))
      .expect(403);

    await http()
      .post(`/platform/admins/${created.body.id}/disable`)
      .set(bearer(root))
      .expect(200);
    await http()
      .get('/platform/auth/me')
      .set(bearer(billingLogin.accessToken))
      .expect(401)
      .expect(({ body }) => expect(body.code).toBe('SESSION_INVALID'));
    await http()
      .post('/platform/auth/login')
      .send({ email: 'billing@test.lk', password: 'Billing-Real-22' })
      .expect(401);

    const audit = await http()
      .get('/platform/audit-logs?limit=50')
      .set(bearer(root))
      .expect(200);
    const actions = (audit.body.items as { action: string }[])
      .map((i) => i.action)
      .reverse();
    expect(actions).toEqual([
      'LOGIN_SUCCEEDED',
      'PASSWORD_CHANGED',
      'ADMIN_CREATED',
      'LOGIN_SUCCEEDED',
      'PASSWORD_CHANGED',
      'ADMIN_DISABLED',
      'LOGIN_FAILED',
    ]);
  });

  it('rejects unauthenticated, malformed and foreign-audience tokens', async () => {
    await http().get('/platform/admins').expect(401);
    await http()
      .get('/platform/admins')
      .set(bearer('not-a-jwt'))
      .expect(401)
      .expect(({ body }) => expect(body.code).toBe('INVALID_ACCESS_TOKEN'));

    const { JwtService } = await import('@nestjs/jwt');
    const forged = await new JwtService({
      secret: process.env.PLATFORM_JWT_SECRET,
    }).signAsync(
      { sub: crypto.randomUUID(), sid: crypto.randomUUID() },
      { audience: 'tenant', issuer: 'drivingschoolhq' },
    );
    await http()
      .get('/platform/admins')
      .set(bearer(forged))
      .expect(401)
      .expect(({ body }) => expect(body.code).toBe('INVALID_ACCESS_TOKEN'));
  });

  it('rotates refresh tokens and revokes everything when a rotated token is reused', async () => {
    await createPlatformAdmin(prisma, {
      email: 'root@test.lk',
      password: 'Root-Real-Pass-22',
    });
    const first = await login('root@test.lk', 'Root-Real-Pass-22');

    const second = await http()
      .post('/platform/auth/refresh')
      .send({ refreshToken: first.refreshToken })
      .expect(200);
    await http()
      .get('/platform/auth/me')
      .set(bearer(first.accessToken))
      .expect(401);
    await http()
      .get('/platform/auth/me')
      .set(bearer(second.body.accessToken))
      .expect(200);

    await http()
      .post('/platform/auth/refresh')
      .send({ refreshToken: first.refreshToken })
      .expect(401);
    await http()
      .get('/platform/auth/me')
      .set(bearer(second.body.accessToken))
      .expect(401);
    await http()
      .post('/platform/auth/refresh')
      .send({ refreshToken: second.body.refreshToken })
      .expect(401);
  });

  it('logout revokes the session', async () => {
    await createPlatformAdmin(prisma, {
      email: 'root@test.lk',
      password: 'Root-Real-Pass-22',
    });
    const { accessToken, refreshToken } = await login(
      'root@test.lk',
      'Root-Real-Pass-22',
    );

    await http()
      .post('/platform/auth/logout')
      .set(bearer(accessToken))
      .expect(204);
    await http().get('/platform/auth/me').set(bearer(accessToken)).expect(401);
    await http()
      .post('/platform/auth/refresh')
      .send({ refreshToken })
      .expect(401);
  });

  it('manages admins: validation, duplicates, self-protection, role change, reset password', async () => {
    const root = await createPlatformAdmin(prisma, {
      email: 'root@test.lk',
      password: 'Root-Real-Pass-22',
    });
    const support = await createPlatformAdmin(prisma, {
      email: 'support@test.lk',
      role: PlatformRole.SUPPORT,
      password: 'Support-Pass-22',
    });
    const token = (await login('root@test.lk', 'Root-Real-Pass-22'))
      .accessToken;
    const supportToken = (await login('support@test.lk', 'Support-Pass-22'))
      .accessToken;

    await http()
      .post('/platform/admins')
      .set(bearer(token))
      .send({
        email: 'x@test.lk',
        fullName: 'X',
        role: 'OWNER',
        temporaryPassword: 'short',
      })
      .expect(400)
      .expect(({ body }) => expect(body.code).toBe('VALIDATION_FAILED'));
    await http()
      .post('/platform/admins')
      .set(bearer(token))
      .send({
        email: 'SUPPORT@test.lk',
        fullName: 'Dup',
        role: 'SUPPORT',
        temporaryPassword: 'Temp-Password-1',
      })
      .expect(409)
      .expect(({ body }) =>
        expect(body.code).toBe('PLATFORM_ADMIN_EMAIL_TAKEN'),
      );
    await http()
      .get('/platform/admins/not-a-uuid')
      .set(bearer(token))
      .expect(400);
    await http()
      .get(`/platform/admins/${crypto.randomUUID()}`)
      .set(bearer(token))
      .expect(404);

    await http()
      .post(`/platform/admins/${root.id}/disable`)
      .set(bearer(token))
      .expect(403)
      .expect(({ body }) =>
        expect(body.code).toBe('CANNOT_MODIFY_OWN_ACCOUNT'),
      );

    await http()
      .patch(`/platform/admins/${support.id}/role`)
      .set(bearer(token))
      .send({ role: 'OPERATIONS_ADMIN' })
      .expect(200)
      .expect(({ body }) => expect(body.role).toBe('OPERATIONS_ADMIN'));
    await http().get('/platform/auth/me').set(bearer(supportToken)).expect(401);

    await http()
      .post(`/platform/admins/${support.id}/reset-password`)
      .set(bearer(token))
      .send({ temporaryPassword: 'Reset-Temp-Pass-1' })
      .expect(200)
      .expect(({ body }) => expect(body.mustChangePassword).toBe(true));
    const relogin = await login('support@test.lk', 'Reset-Temp-Pass-1');
    expect(relogin.mustChangePassword).toBe(true);

    const list = await http()
      .get('/platform/admins?role=OPERATIONS_ADMIN')
      .set(bearer(token))
      .expect(200);
    expect(list.body).toMatchObject({ total: 1, page: 1, pageSize: 20 });
    expect(list.body.items[0]).not.toHaveProperty('passwordHash');

    const stored = await prisma.platformAdminUser.findUniqueOrThrow({
      where: { id: support.id },
    });
    expect(stored.status).toBe(PlatformAdminStatus.ACTIVE);
  });
});
