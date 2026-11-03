/**
 * Every contract panic string (SPEC.md 4.8) maps to an HTTP status and player-facing copy.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CHAIN_ERRORS, mapChainError } from '../../lib/http/chain-errors.js';

/** The backticked strings in SPEC.md 4.8's "Panic messages ..." paragraph. */
function specPanics() {
  const spec = readFileSync(new URL('../../SPEC.md', import.meta.url), 'utf8');
  const section = spec.slice(spec.indexOf('### 4.8 Errors'), spec.indexOf('## 5. Engine'));
  const line = section.split('\n').find((l) => l.startsWith('Panic messages')) ?? '';
  const list = line.slice(0, line.indexOf('.', line.indexOf(':')));
  return [...list.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
}

/** Strings the deployed T5 contract also panics with (T5's SPEC 4.8 adds them). */
const T5_PANICS = ['low price', 'bad tier'];

describe('chain errors', () => {
  const panics = [...specPanics(), ...T5_PANICS];

  it('reads the full SPEC 4.8 list', () => {
    expect(panics.length).toBeGreaterThanOrEqual(30);
    expect(panics).toContain('insufficient volts');
  });

  it.each(panics)('maps %s', (panic) => {
    expect(Object.hasOwn(CHAIN_ERRORS, panic)).toBe(true);
    const { status, error } = mapChainError(panic);
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(600);
    expect(status).not.toBe(500);
    expect(error).toMatch(/^[A-Z].*\.$/);
  });

  it('uses the decided statuses and copy', () => {
    expect(mapChainError('locked')).toEqual({
      status: 409,
      error: 'This drone is locked until its race finishes.',
    });
    expect(mapChainError('insufficient volts')).toEqual({
      status: 402,
      error: 'Not enough Volts.',
    });
    expect(mapChainError('not owner').status).toBe(403);
    expect(mapChainError('not found').status).toBe(404);
    for (const p of ['over cap', 'tsb exceeded', 'stat decrease']) {
      expect(mapChainError(p).status).toBe(422);
    }
    expect(mapChainError('cap exceeded').status).toBe(429);
  });

  it('never shows internal terms or dashes to players', () => {
    for (const { error } of Object.values(CHAIN_ERRORS)) {
      expect(error).not.toMatch(/\bT\d+\b|\bseq\b|panic|contract|adapter|nonce|rpc|[–—]/i);
    }
  });

  it('answers an unknown panic without leaking it', () => {
    expect(mapChainError('some new rule')).toEqual({
      status: 422,
      error: 'The game rejected this action.',
    });
    expect(mapChainError('constructor').status).toBe(422);
  });
});
