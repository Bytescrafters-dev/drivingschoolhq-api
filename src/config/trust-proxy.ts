import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Express } from 'express';
import type { Env } from './env.js';

/**
 * Lets Express derive `request.ip` from X-Forwarded-For when the request
 * comes through a trusted proxy (the Next.js BFFs). Throttling and audit
 * metadata use `request.ip`, so without this every user behind a BFF would
 * share one rate-limit bucket.
 *
 * Only enable it when the API is reachable exclusively through those
 * proxies; otherwise clients could forge X-Forwarded-For.
 */
export function configureTrustProxy(app: INestApplication): void {
  const trustProxy = app
    .get(ConfigService<Env, true>)
    .get('TRUST_PROXY', { infer: true });
  if (trustProxy === false) return;
  const express = app.getHttpAdapter().getInstance() as Express;
  express.set('trust proxy', trustProxy);
}
