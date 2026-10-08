import { execSync } from 'node:child_process';
import pg from 'pg';
import { resolveTestDatabaseUrl } from './test-env.js';

export default async function setup(): Promise<void> {
  const testUrl = resolveTestDatabaseUrl();
  const parsed = new URL(testUrl);
  const dbName = parsed.pathname.replace(/^\//, '');

  const adminUrl = new URL(testUrl);
  adminUrl.pathname = '/postgres';
  adminUrl.search = '';
  const client = new pg.Client({ connectionString: adminUrl.toString() });
  await client.connect();
  try {
    const exists = await client.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [dbName],
    );
    if (exists.rowCount === 0) {
      await client.query(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`);
    }
  } finally {
    await client.end();
  }

  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: testUrl },
    stdio: 'pipe',
  });
}
