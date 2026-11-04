/**
 * Zod schemas for every gameplay mutation body (lib/validators/gameplay.js, SPEC.md 8).
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  allocateBodySchema,
  bindBodySchema,
  equipBodySchema,
  listBodySchema,
  packOpenBodySchema,
  toggleBodySchema,
  tokenActionBodySchema,
  vendorBodySchema,
} from '../lib/validators/gameplay.js';

const actionId = randomUUID();
/** @param {import('zod').ZodType} schema @param {unknown} body */
const ok = (schema, body) => schema.safeParse(body).success;

describe('gameplay body schemas', () => {
  it('every action body needs a uuid actionId and rejects unknown keys', () => {
    for (const [
      schema,
      body,
    ] of /** @type {Array<[import('zod').ZodType, Record<string, unknown>]>} */ ([
      [vendorBodySchema, {}],
      [bindBodySchema, { item: 's:1' }],
      [tokenActionBodySchema, { token: 'd:1' }],
      [packOpenBodySchema, { kind: 'mod', tier: 'starter' }],
    ])) {
      expect(ok(schema, { ...body, actionId })).toBe(true);
      expect(ok(schema, body)).toBe(false);
      expect(ok(schema, { ...body, actionId: 'abc' })).toBe(false);
      expect(ok(schema, { ...body, actionId, seq: 3 })).toBe(false);
    }
  });

  it('allocate takes 9 integer stats from 1 to 100', () => {
    const stats = [5, 1, 1, 1, 1, 1, 1, 1, 1];
    expect(ok(allocateBodySchema, { actionId, stats })).toBe(true);
    expect(ok(allocateBodySchema, { actionId, stats: stats.slice(1) })).toBe(false);
    expect(ok(allocateBodySchema, { actionId, stats: [0, ...stats.slice(1)] })).toBe(false);
    expect(ok(allocateBodySchema, { actionId, stats: [101, ...stats.slice(1)] })).toBe(false);
    expect(ok(allocateBodySchema, { actionId, stats: [1.5, ...stats.slice(1)] })).toBe(false);
  });

  it('equip takes an item of its kind, or null to clear', () => {
    expect(ok(equipBodySchema, { actionId, kind: 'skin', item: 's:4' })).toBe(true);
    expect(ok(equipBodySchema, { actionId, kind: 'mod', item: null })).toBe(true);
    expect(ok(equipBodySchema, { actionId, kind: 'mod', item: 's:4' })).toBe(false);
    expect(ok(equipBodySchema, { actionId, kind: 'mod', item: 'd:4' })).toBe(false);
    expect(ok(equipBodySchema, { actionId, kind: 'hat', item: null })).toBe(false);
  });

  it('bind takes a skin or mod token only', () => {
    expect(ok(bindBodySchema, { actionId, item: 'm:12' })).toBe(true);
    expect(ok(bindBodySchema, { actionId, item: 'd:12' })).toBe(false);
    expect(ok(bindBodySchema, { actionId, item: 'm:0' })).toBe(false);
    expect(ok(bindBodySchema, { actionId, item: 'm:1;drop' })).toBe(false);
  });

  it('list takes a token and a whole price of at least 10 Volts', () => {
    expect(ok(listBodySchema, { actionId, token: 'd:6', price: 10 })).toBe(true);
    expect(ok(listBodySchema, { actionId, token: 'd:6', price: 9 })).toBe(false);
    expect(ok(listBodySchema, { actionId, token: 'd:6', price: 10.5 })).toBe(false);
    expect(ok(listBodySchema, { actionId, token: 'd:6', price: '100' })).toBe(false);
    expect(ok(listBodySchema, { actionId, token: 'x:6', price: 100 })).toBe(false);
  });

  it('buy and cancel take any token id', () => {
    for (const token of ['d:1', 's:22', 'm:333']) {
      expect(ok(tokenActionBodySchema, { actionId, token })).toBe(true);
    }
    expect(ok(tokenActionBodySchema, { actionId, token: 'd:' })).toBe(false);
  });

  it('pack open takes a kind and a SPEC 2.7 tier', () => {
    for (const tier of ['starter', 'premium', 'legendary']) {
      expect(ok(packOpenBodySchema, { actionId, kind: 'skin', tier })).toBe(true);
    }
    expect(ok(packOpenBodySchema, { actionId, kind: 'skin', tier: 0 })).toBe(false);
    expect(ok(packOpenBodySchema, { actionId, kind: 'drone', tier: 'starter' })).toBe(false);
  });

  it('toggle takes a boolean and nothing else', () => {
    expect(ok(toggleBodySchema, { active: true })).toBe(true);
    expect(ok(toggleBodySchema, { active: 'yes' })).toBe(false);
    expect(ok(toggleBodySchema, { active: true, actionId })).toBe(false);
  });
});
