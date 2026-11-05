#!/usr/bin/env node
/**
 * Run one scheduler tick against a running app (SPEC.md 6): POST /api/races/run with the secret
 * from .env.local, as an external scheduler would. Used in development and by the smoke test.
 *
 *   node scripts/tick.mjs                  # http://localhost:3000
 *   node scripts/tick.mjs https://app.url  # any deployment
 */
import { existsSync } from 'node:fs';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');
const secret = process.env.CRON_SECRET;
if (!secret) {
  console.error('CRON_SECRET is not set (.env.local)');
  process.exit(1);
}
const base = process.argv[2] ?? 'http://localhost:3000';
const res = await fetch(new URL('/api/races/run', base), {
  method: 'POST',
  headers: { 'x-cron-secret': secret },
});
const body = await res.text();
console.log(`${res.status} ${body}`);
process.exit(res.ok ? 0 : 1);
