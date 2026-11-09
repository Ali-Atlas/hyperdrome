/**
 * The wallet page's Content-Security-Policy (lib/wallet/csp.js, SPEC.md 8): exact origins, no
 * wildcards, the per-request nonce.
 */
import { describe, expect, it } from 'vitest';
import { walletPageCsp } from '../../lib/wallet/csp.js';

describe('walletPageCsp', () => {
  const csp = walletPageCsp('abc123');

  it('names the manifest and executor origins and the nonce', () => {
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(csp).toContain('https://raw.githubusercontent.com');
    expect(csp).toContain('https://cdn.jsdelivr.net');
    expect(csp).toContain('https://wallet.intear.tech');
  });

  it('allows no wildcards', () => {
    expect(csp).not.toMatch(/\*/);
  });

  it('adds unsafe-eval only in development', () => {
    expect(csp).not.toContain('unsafe-eval');
    expect(walletPageCsp('x', { dev: true })).toContain("'unsafe-eval'");
  });
});
