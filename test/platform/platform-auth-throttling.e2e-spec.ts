import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { createTestPrisma, resetDatabase } from '../support/database.js';

// Env is validated once when AppModule is first imported, so set the limit
// before the dynamic import below (Vitest isolates modules per test file).
process.env.PLATFORM_AUTH_RATE_LIMIT = '3';

describe('Platform auth rate limiting (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { AppModule } = await import('../../src/app.module.js');
    prisma = createTestPrisma();
    await resetDatabase(prisma);
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

  it('throttles repeated login attempts with a consistent error body', async () => {
    const attempt = () =>
      request(app.getHttpServer())
        .post('/platform/auth/login')
        .send({ email: 'nobody@test.lk', password: 'whatever-password' });

    for (let i = 0; i < 3; i++) await attempt().expect(401);
    const blocked = await attempt().expect(429);
    expect(blocked.body).toMatchObject({
      statusCode: 429,
      code: 'TOO_MANY_REQUESTS',
    });
  });
});
