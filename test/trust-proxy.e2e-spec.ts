import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

// Env is validated once when AppModule is first imported, so configure it
// before the dynamic import below (Vitest isolates modules per test file).
// Supertest connects over loopback, i.e. it plays the BFF.
process.env.TRUST_PROXY = 'loopback';
process.env.AUTH_RATE_LIMIT = '2';

describe('Client IP behind a trusted proxy (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const { AppModule } = await import('../src/app.module.js');
    const { configureTrustProxy } =
      await import('../src/config/trust-proxy.js');
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureTrustProxy(app);
    await app.init();
  });

  afterAll(() => app.close());

  const login = (clientIp: string) =>
    request(app.getHttpServer())
      .post('/tenant/auth/login')
      .set('X-Forwarded-For', clientIp)
      .send({
        dsCode: 'DS404',
        email: 'nobody@school.lk',
        password: 'whatever-password',
      });

  it('rate-limits each forwarded client IP separately', async () => {
    await login('203.0.113.10').expect(401);
    await login('203.0.113.10').expect(401);
    await login('203.0.113.10')
      .expect(429)
      .expect(({ body }) => expect(body.code).toBe('TOO_MANY_REQUESTS'));

    // Another user behind the same BFF is not affected.
    await login('203.0.113.20').expect(401);
  });

  it('applies the same per-client limit to platform login', async () => {
    const platformLogin = (clientIp: string) =>
      request(app.getHttpServer())
        .post('/platform/auth/login')
        .set('X-Forwarded-For', clientIp)
        .send({ email: 'nobody@platform.lk', password: 'whatever-password' });
    await platformLogin('198.51.100.1').expect(401);
    await platformLogin('198.51.100.1').expect(401);
    await platformLogin('198.51.100.1').expect(429);
    await platformLogin('198.51.100.2').expect(401);
  });
});
