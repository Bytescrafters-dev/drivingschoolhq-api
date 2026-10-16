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

  it('throttles repeated tenant login attempts', async () => {
    const attempt = () =>
      request(app.getHttpServer()).post('/tenant/auth/login').send({
        dsCode: 'DS404',
        email: 'nobody@school.lk',
        password: 'whatever-password',
      });
    for (let i = 0; i < 3; i++) await attempt().expect(401);
    await attempt().expect(429);
  });
});
