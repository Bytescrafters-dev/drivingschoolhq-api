import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from './env.js';

/**
 * Enables CORS for the configured browser origins only. Auth uses bearer
 * tokens (no cookies), so credentials stay disabled. With no origins
 * configured CORS is left off and browsers on other origins are blocked.
 */
export function configureCors(app: INestApplication): void {
  const origins = app
    .get(ConfigService<Env, true>)
    .get('CORS_ORIGINS', { infer: true });
  if (origins.length === 0) return;
  app.enableCors({
    origin: origins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    // X-Branch-Id selects the working branch on tenant branch-scoped routes.
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Branch-Id'],
    credentials: false,
    maxAge: 600,
  });
}
