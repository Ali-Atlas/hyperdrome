/**
 * Shared constants and dependency wiring for the scheduler services (SPEC.md 2.3, 6): the cadence,
 * slot arithmetic, and the database, chain adapter and seed sealing key, injectable by tests.
 */
import { z } from 'zod';
import { db as defaultDb } from '@/lib/db';
import { getNear } from '@/lib/near';

/** Batch cadence in seconds (SPEC.md 2.3). */
export const CADENCE_S = 180;
/** The strategy window after a commit, in ms (SPEC.md 2.3). */
export const STRATEGY_WINDOW_MS = 120_000;

/**
 * @typedef {{ db?: any, near?: import('@/lib/near').NearAdapter, secretKey?: string, teamPhase?: typeof import('./teams.service.js').runTeamPhase | null }} Deps
 *   `teamPhase`: the AI team phase of a tick (default `runTeamPhase`; null runs none)
 * @typedef {{ db: any, near: import('@/lib/near').NearAdapter, secretKey: string }} FullDeps
 */

/**
 * The batch slot of a time (SPEC.md 2.3): floor(unix_seconds / 180).
 * @param {number} ms unix time in milliseconds
 */
export const slotFor = (ms) => Math.floor(ms / 1000 / CADENCE_S);

/**
 * The unix time, in milliseconds, at which `slot` starts.
 * @param {number} slot
 */
export const slotStartMs = (slot) => slot * CADENCE_S * 1000;

/** The key batch seeds are sealed under (`KEY_ENCRYPTION_KEY`, SPEC.md 6). */
function readSecretKey() {
  return z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/)
    .parse(process.env.KEY_ENCRYPTION_KEY);
}

/**
 * @param {Deps} deps
 * @returns {FullDeps}
 */
export function resolveDeps(deps) {
  return {
    db: deps.db ?? defaultDb,
    near: deps.near ?? getNear(),
    secretKey: deps.secretKey ?? readSecretKey(),
  };
}
