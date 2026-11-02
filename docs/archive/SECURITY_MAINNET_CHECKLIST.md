# Security Hardening for Mainnet

Open items from the 2026-05-12 security audit. The testnet posture is acceptable for hyperdrome.vercel.app on MegaETH; everything below must land before any deployment that holds real funds or real users.

The four critical-and-quick fixes (admin-config gate, deletion of the three marketplace bypass routes, app-side VOLT debit on `/api/packs/buy`, constant-time `CRON_SECRET` compare) are already shipped on `main`.

---

## C1. SIWE wallet auth

**Today.** `POST /api/auth/wallet` trusts `{walletAddress}` from the request body with no signature proof. Anyone who knows a victim's wallet address (Blockscout makes them public) can hijack the session and grief the account (spend DB-mirror VOLT, list items at 10V, cancel listings, etc.). On-chain assets stay safe because the deployer signer cannot move tokens out of a user wallet.

**Fix.** Implement EIP-4361 (Sign-In With Ethereum):

1. `GET /api/auth/wallet/nonce` returns a fresh nonce, stored short-lived (Redis or a DB row keyed by IP + address).
2. Client renders a SIWE message embedding the nonce, asks the wallet to sign.
3. `POST /api/auth/wallet` accepts `{message, signature}`, verifies via `viem.verifyMessage` (or `ethers.verifyMessage`), confirms the nonce is fresh, then issues the session.
4. Reject any sign-in that doesn't carry a valid signature.

Wire the same flow into `POST /api/user/wallet` (the bind endpoint) so an authenticated demo cannot bind a wallet they don't control. See **H3**.

**Coordinated client work.** `HeroConnectWallet` and `HeaderConnectWallet` (and any other call site for `/api/auth/wallet`) will need to call `signMessageAsync` before posting. Plan for a one-time UI change.

---

## H1. Distributed rate limiting

**Today.** `lib/api/rate-limit.js` and the per-route limiters in `app/api/auth/wallet/route.js` / `app/api/auth/demo/route.js` use in-memory `Map`s. On Vercel each warm function instance has its own bucket, so an "N/hour" limit is actually N x (warm-instance count) per hour from a single IP.

**Fix.** Move to a serverless-friendly backend. Options:

- **Upstash Redis** (cheapest for low QPS) - tiny SDK, regional endpoints near Vercel, `INCR` + `EXPIRE` covers the bucket primitive.
- **Neon Postgres** - one `rate_limits(key, window_start, count)` row with an `UPSERT ... ON CONFLICT DO UPDATE` per request. Slower but no extra vendor.

Apply tighter limits to the auth boundary:

- `/api/auth/wallet` new-account branch: 3/hour/IP.
- `/api/auth/demo`: 5/hour/IP unchanged but enforced globally instead of per-instance.
- `/api/auth/wallet/bootstrap`: per-wallet idempotency already exists; add a 1000/24h global ceiling to bound testnet ETH drain.

---

## H2. Anti-faucet measures

**Today.** Each fresh wallet auth triggers 0.001 ETH gas drip + 1000 VOLT mint. Per-wallet idempotency via `users.starter_volt_minted_at` and `users.starter_gas_sent_at` blocks re-airdrops to the same address, but address rotation (IPv6 /64, residential proxies) circumvents per-IP limits.

**Fix.**

1. **Cloudflare Turnstile or hCaptcha challenge** on the new-wallet branch of `/api/auth/wallet`. Server-side verify the challenge token before any DB write.
2. **Global mint ceiling** in addition to per-wallet: track `(starter_volt_mints_24h, starter_gas_drips_24h)` in a small table, refuse mints once a daily cap is hit. The cap is operator-tunable.
3. **Deployer balance alert.** Cron a daily Slack / email when deployer ETH or VOLT drops below threshold so refills are not reactive.

---

## H3. SIWE on wallet bind

**Today.** `POST /api/user/wallet` lets any authenticated user (demo included) bind any wallet address to their account, with no proof of control. The UNIQUE constraint on `users.wallet_address` then blocks the real owner from binding theirs. DoS against legit sign-ups.

**Fix.** Same SIWE flow as C1, applied to this route. Reuse the nonce + signature verifier.

---

## H4. Origin / CSRF posture

**Today.** Custom state-mutating routes (`/api/user/wallet`, `/api/drones/*`, `/api/marketplace/*`, `/api/packs/buy`, `/api/skins/*`, `/api/admin/config`) rely on NextAuth's same-site cookie + JSON content-type. Mostly safe in modern browsers but a vulnerable extension or CORS-permissive subdomain breaks the guard.

**Fix.** Add an explicit `Origin` check in `withApiHandler` for `POST`, `PATCH`, `PUT`, `DELETE`:

```js
if (request.method !== 'GET') {
  const origin = request.headers.get('origin');
  const expected = process.env.NEXTAUTH_URL;
  if (origin && expected && new URL(origin).host !== new URL(expected).host) {
    return fail('Bad origin', 403);
  }
}
```

Server-to-server cron callers (with no Origin) still pass. Browser callers must match.

---

## H5. Public profile data

**Today.** `GET /api/users/[userId]/profile` is unauthenticated and returns `points` (current VOLT balance) alongside ELO and race stats. Enumerable. Lets anyone build a whale list to target with phishing or in-game grief.

**Decision needed.** Either:

- **Drop `points` from the public payload.** Keep ELO, totalRaces, totalWins, seasonPoints (these are leaderboard fodder anyway). Single-line change in `services/user.service.js#getUserProfile`.
- **Accept it.** Hyperdrome is a public ranked game; balances visible is part of the design. Document the choice in `ATLAS.md` so future audits do not re-flag it.

Pick before mainnet.

---

## L6. Security headers

**Today.** `next.config.mjs` only sets a long-cache header on static assets and `poweredByHeader: false`. No CSP, HSTS, X-Content-Type-Options, Referrer-Policy, or Permissions-Policy.

**Fix.** Add a global `headers()` block:

```js
{
  source: '/:path*',
  headers: [
    { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
    // CSP comes last - tune carefully against RainbowKit / WalletConnect.
  ],
}
```

CSP needs an iteration pass with the WalletConnect / RainbowKit asset origins; ship the other four headers first.

---

## Off-code action items

These do not show up as code changes but are required before mainnet:

1. **Rotate `NEXTAUTH_SECRET`.** The Credentials providers in `lib/auth/index.js` accept the secret as proof of server-internal calls. If it ever leaked (logs, stack traces, a contractor's clipboard) an attacker can mint sessions for any user id. Cheap rotation; redeploy invalidates all existing sessions.

2. **Verify deployer wallet has zero mainnet balance.** Run a multi-chain balance scan for the address derived from `DEPLOYER_PRIVATE_KEY`. If anything shows up on mainnet (ETH, USDC, NFTs), move it out and rotate the key before mainnet launch.

3. **Resend sender domain.** `lib/auth/index.js` currently sends magic-link emails from `onboarding@resend.dev` (Resend's shared sandbox sender). Verify a real domain in Resend and switch the `from` address before mainnet so emails are signed by a domain the operator controls.

4. **Carrot RPC / Vercel usage alerts.** With the testnet abuse vectors above (and similar mainnet vectors until rate limits are tight), RPC spend and function invocations can spike. Wire usage alerts so an attack is paged within minutes, not hours.

5. **Bug bounty scope.** Once SIWE lands and rate limits are real, advertise scope on the contracts and the auth boundary. The marketplace, packs, and settlement contracts are the high-value targets.

---

## Recommended mainnet implementation order

1. C1 + H3 together (SIWE on both auth and bind). Largest single change but unlocks every other deferred item.
2. H4 (Origin check) - small, blast-radius-reducing.
3. H1 (Redis rate limiting) - infra plumbing, prerequisite to H2.
4. H2 (Turnstile + global caps) - depends on H1.
5. H5 (public profile decision).
6. L6 (security headers).
7. Off-code action items in parallel.
