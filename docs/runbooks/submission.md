# Submission day

The NEAR HACKATHON submission, step by step, for the owner to run with the coding agent. Submissions close 2026-11-14 23:59 UTC (18:59 in New York); the plan is 2026-11-13 ([BUILD_PLAN.md](../../BUILD_PLAN.md), Submit). Do the steps in order and stop at any one that fails. Making the repository public, pushing the tag, posting on X and sending the form are the owner's acts: the agent prepares and checks, the owner decides.

## 1. Re-read the rules

Download https://nearhackathon.com/HACKATHON.md and read it in full, with the FAQ on https://nearhackathon.com. Compare it with what this build was prepared against on 2026-11-09: Q-000 to Q-017; the README asks for what the product is, the problem it solves, "do X, see Y" steps, the prior work and the NEAR integration built in the window, every library, template and AI-generated code, and any other project by the same person (Q-015); the form fields in step 8. Any change: stop and fix it before going on.

## 2. Re-run the secret scan

gitleaks 8.30.1 (the CI pin), over the full history of every ref and over the working tree. The repository is private until step 4, so the clone goes through `gh`:

```sh
gh repo clone Ali-Atlas/hyperdrome /tmp/hd-scan.git -- --mirror
gitleaks git /tmp/hd-scan.git --log-opts="--all -m" --config .gitleaks.toml --redact
mkdir -p /tmp/hd-tree
git ls-files -co --exclude-standard -z | xargs -0 -I{} cp --parents {} /tmp/hd-tree
(cd /tmp/hd-tree && gitleaks dir . --config .gitleaks.toml --redact)
```

Both must end with "no leaks found". Run the tree scan from inside the copy: the allowlist in [.gitleaks.toml](../../.gitleaks.toml) matches repository-relative paths. Any finding: stop. A real secret is rotated first, then history is decided together; nothing is made public with one in it. The scan on 2026-11-09 found none (HANDOFF.md, T24).

## 3. Freeze `main`

- No pull request is waiting to merge, and CI is green on the head of `main` (`gh run list --branch main --limit 1`).
- `GET https://hyperdrome-near.vercel.app/api/health` answers 200 with `ok: true` and `racingEnabled: true`.
- Note the head commit: `git rev-parse origin/main`. This is the commit the tag will name.
- After the freeze, run the app suite once on a fresh database at that commit (the commands in README.md section 2) and check that its counts match the ones README.md section 2 quotes. If they differ, fix the README before tagging.

## 4. Make the repository public

```sh
gh api -X PATCH repos/Ali-Atlas/hyperdrome -F private=false -q .visibility   # prints "public"
curl -s -o /dev/null -w "%{http_code}\n" https://github.com/Ali-Atlas/hyperdrome   # 200 without signing in
```

The repository must stay public through judging (Q-014). The `assets/t21-screenshots` branch holds the PR screenshots and is public with the rest.

## 5. Secret scanning and push protection

```sh
gh api -X PATCH repos/Ali-Atlas/hyperdrome \
  -f 'security_and_analysis[secret_scanning][status]=enabled' \
  -f 'security_and_analysis[secret_scanning_push_protection][status]=enabled'
gh api repos/Ali-Atlas/hyperdrome -q .security_and_analysis   # both "enabled"
```

Fields from the GitHub REST reference, "Update a repository" (`security_and_analysis`). Then open the repository's Security tab: no secret scanning alert.

## 6. The `hackathon-submission` tag

```sh
git fetch origin
git tag -a hackathon-submission -m "NEAR HACKATHON submission" <commit from step 3>
git push origin hackathon-submission
git ls-remote --tags origin   # pre-hackathon and hackathon-submission
```

Open https://github.com/Ali-Atlas/hyperdrome/compare/pre-hackathon...hackathon-submission signed out: it lists the hackathon commits and the README link to it works. `pre-hackathon` is already on the remote (commit `83d0638`, 2026-05-26).

## 7. Last check of the hosted build

```sh
SMOKE_BASE_URL=https://hyperdrome-near.vercel.app node --env-file=.env.local --env-file=.env.prod.local \
  --import ./scripts/register-alias.mjs scripts/smoke-testnet.mjs
npm run verify:race -- <a race id from https://hyperdrome-near.vercel.app/api/races>
```

The smoke ends with `PASS`; `verify:race` ends with "All 8 checks passed." Then walk README section 1 once in a browser.

## 8. The X post (the owner posts it)

A native video under 2 minutes (Q-012: screenshots alone are not enough). Show one complete action and its result: Play Demo, the account on NearBlocks, a mod swap before the lock, the settled race and Verify passing, then `/economy`. Draft, 278 characters as X counts them (each link counts 23):

```text
Hyperdrome: drone races you can check yourself.

Play Demo, get a NEAR account, swap a mod before the lock, press Verify: your browser replays the race from the on-chain seed.

Built at NEAR HACKATHON @NEARProtocol #NEARHackathon

https://hyperdrome-near.vercel.app
https://github.com/Ali-Atlas/hyperdrome
```

@NearLegion and @NearBuilders may be tagged as well (HACKATHON.md, demo post); with them the post is over 280 characters, so drop a line first. Copy the post's URL for the form.

## 9. The form

Every field is shown back for confirmation before it is sent, and a sent submission cannot be edited (corrections go through https://nearhackathon.com/request-changes). Each repository can be submitted once.

| Field                                         | Value                                                                                                                              |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Project name                                  | Hyperdrome                                                                                                                         |
| Team lead                                     | the owner's name                                                                                                                   |
| Email address                                 | the owner's                                                                                                                        |
| Team size                                     | 1                                                                                                                                  |
| Tracks                                        | Games With Real Economies (`games`), NFTs That Do Something (`nfts`), AI Security & Defense (`security`), Agent Economy (`agents`) |
| NEAR wallet address (payout, mainnet account) | the owner's                                                                                                                        |
| Repository link                               | https://github.com/Ali-Atlas/hyperdrome                                                                                            |
| Demo post link                                | the URL of the post from step 8                                                                                                    |
| What did you build? (20 to 2,000 characters)  | the text below, 1,578 characters                                                                                                   |
| Contact notice                                | the owner's consent                                                                                                                |

```text
Hyperdrome is an idle drone-racing strategy game on NEAR testnet. You tune a drone with stat points, a mod and a skin, and every 3 minutes it races 1v1 against a drone of a similar level and rating. You can change the mod for 2 minutes after the matchup is committed; then the race locks.

One NEAR contract holds the drones, skins and mods (NEP-171), the Volts currency (NEP-141), the marketplace, packs and race settlement. It creates a NEAR sub-account for every player and AI team, with a function-call key that can only make game moves. Players sign in with Google or Play Demo and need no wallet or gas; they can link a wallet with a NEP-413 signature (NEAR Connect by HOT) and withdraw their tokens to it.

Races are checkable: the seed hash is committed on chain with the matchups, the seed is revealed at settlement, and the contract checks each result against the drones' on-chain state before paying out. The Verify button replays any settled race in your browser from public RPC data, and npm run verify:race does the same from the command line with no keys.

Four rule-based AI teams play the same economy with their own scoped keys, under spend caps the contract enforces. Every move they make is shown on /economy with the reason for it and its transaction. A security demo sends real transactions with a team-like key treated as stolen and records what the contract and the protocol refuse.

The game existed before as a MegaETH prototype; everything on NEAR was built during the hackathon, and the README links the diff. Live: https://hyperdrome-near.vercel.app
```

## 10. Keep the demo up through 2026-11-25

- The scheduler and the health monitor are the two cron-job.org jobs in [deploy.md](deploy.md). Check `GET /api/health` once a day: `ok: true`, `racingEnabled: true`, `lastTickAgeSeconds` under 300. A 503 names the failed check; the funding floors and the top-ups are in [deploy.md](deploy.md), Health, [key-rotation.md](key-rotation.md) and [dev-setup.md](dev-setup.md), "Top up".
- Judging runs 2026-11-16 to 2026-11-18. Merge nothing that is not a fix while it runs, and run the smoke after any merge.
- Season 1 ends on 2026-11-25. Nothing ends it in this build: the leaderboard shows 0 days remaining after that date.
- The repository stays public through judging (Q-014). A change to the submission goes through the request-changes page, never a second submission.
