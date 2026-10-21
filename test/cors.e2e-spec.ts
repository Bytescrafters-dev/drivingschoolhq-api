import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

// Env is validated once when AppModule is first imported, so configure the
// origins before the dynamic import below (Vitest isolates modules per file).
process.env.CORS_ORIGINS = 'http://localhost:3000';

const ALLOWED = 'http://localhost:3000';

describe('CORS (e2e)', () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const { AppModule } = await import('../src/app.module.js');
    const { configureCors } = await import('../src/config/cors.js');
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureCors(app);
    await app.init();
  });

  afterAll(() => app.close());

  it('answers preflight requests from an allowed origin', async () => {
    const res = await http()
      .options('/platform/plans')
      .set('Origin', ALLOWED)
      .set('Access-Control-Request-Method', 'PATCH')
      .set('Access-Control-Request-Headers', 'authorization,content-type')
      .expect(204);
    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED);
    expect(res.headers['access-control-allow-methods']).toContain('PATCH');
    expect(res.headers['access-control-allow-headers']).toMatch(
      /Authorization/i,
    );
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('adds the allow-origin header to normal responses for an allowed origin', async () => {
    const res = await http()
      .get('/platform/plans')
      .set('Origin', ALLOWED)
      .expect(401);
    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED);
  });

  it('does not allow other origins', async () => {
    const res = await http()
      .options('/platform/plans')
      .set('Origin', 'https://evil.example.com')
      .set('Access-Control-Request-Method', 'GET');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
