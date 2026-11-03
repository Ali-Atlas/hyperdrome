import { neon } from '@neondatabase/serverless';
import { drizzle as drizzleNeon } from 'drizzle-orm/neon-http';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

const connectionString = process.env.DATABASE_URL;

/**
 * True for a Neon URL; the app then uses Neon's HTTP driver (no connection to hold on serverless).
 * Any other Postgres (the CI service, a local cluster) goes through node-postgres.
 * @param {string} url
 */
export function isNeonUrl(url) {
  try {
    const host = new URL(url).hostname;
    return host === 'neon.tech' || host.endsWith('.neon.tech');
  } catch {
    return false;
  }
}

/** @typedef {import('drizzle-orm/pg-core').PgDatabase<any, typeof schema>} Db */

/**
 * Drizzle instance for a connection string. Both drivers expose the same Postgres query API.
 * @param {string} url
 * @returns {Db}
 */
export function createDb(url) {
  return isNeonUrl(url)
    ? drizzleNeon(neon(url), { schema })
    : drizzlePg(new pg.Pool({ connectionString: url, max: 5 }), { schema });
}

/**
 * Raw SQL tagged template for the Neon HTTP driver; null off Neon.
 * Prefer `db` (Drizzle); reach for `sql` only to drop below the ORM.
 * @type {ReturnType<typeof neon> | null}
 */
export const sql = connectionString && isNeonUrl(connectionString) ? neon(connectionString) : null;

/** Drizzle ORM instance bound to the project schema; null when DATABASE_URL is unset. @type {Db | null} */
export const db = connectionString ? createDb(connectionString) : null;

export { schema };
