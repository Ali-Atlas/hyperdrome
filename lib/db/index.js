import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema.js';

const connectionString = process.env.DATABASE_URL;

/**
 * Raw SQL tagged template for the Neon HTTP serverless driver.
 * Prefer `db` (Drizzle) for most queries; reach for `sql` when you need
 * to drop below the ORM.
 * @type {ReturnType<typeof neon> | null}
 */
export const sql = connectionString ? neon(connectionString) : null;

/**
 * Drizzle ORM instance bound to the full project schema.
 * Null when DATABASE_URL is unset so module import never throws.
 */
export const db = connectionString
  ? drizzle(neon(connectionString), { schema })
  : null;

export { schema };
