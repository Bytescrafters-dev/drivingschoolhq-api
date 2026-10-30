import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { createTestPrisma, resetDatabase } from '../support/database.js';

// Env is validated once when AppModule is first imported, so set the limit
// before the dynamic import below (Vitest isolates modules per test file).
process.env.AUTH_RATE_LIMIT = '3';

describe('Tenant auth rate limiting (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { AppModule } = await import('../../src/app.module.js');
    const { configureTrustProxy } =
      await import('../../src/config/trust-proxy.js');
    prisma = createTestPrisma();
    await resetDatabase(prisma);
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    // TRUST_PROXY is off (the default), exactly as main.ts would apply it.
    configureTrustProxy(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('throttles repeated tenant login attempts, ignoring forged client IPs', async () => {
    const attempt = (i: number) =>
      request(app.getHttpServer())
        .post('/tenant/auth/login')
        // Without a trusted proxy a client cannot pick its own IP.
        .set('X-Forwarded-For', `203.0.113.${i}`)
        .send({
          dsCode: 'DS404',
          email: 'nobody@school.lk',
          password: 'whatever-password',
        });
    for (let i = 0; i < 3; i++) await attempt(i).expect(401);
    await attempt(3).expect(429);
  });
});
