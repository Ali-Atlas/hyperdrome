# PRINCIPLES.md - Quality Standards

Cross-cutting quality standards Compass evaluates against and Mercenary follows. Every change must pass these checks before being marked complete.

---

## Performance

- Prefer server components. Only use `'use client'` when state, effects, or browser APIs demand it.
- Avoid unnecessary re-renders. Lift state only as high as needed. Memoize heavy computations, not cheap ones.
- Normalize DB-backed data by id for O(1) lookups on the client.
- Image assets sized for their display context. Use `next/image` and explicit dimensions.
- No new dependencies without justification. The stack is intentionally small (Next, React, Drizzle, Zod, NextAuth, Resend, lucide-react). Adding to it needs Captain sign-off.
- Respect Next.js 16 caching defaults. Check `node_modules/next/dist/docs/` before reaching for `revalidate`, `cache`, or `'use cache'`.

## Security

- Validate every mutation input with Zod at the route handler boundary. No trusting request bodies.
- Auth state comes from NextAuth (`auth()` server-side, `useSession()` client-side). Never stash tokens in `localStorage`.
- Secrets (`DATABASE_URL`, `RESEND_API_KEY`, `NEXTAUTH_SECRET`, etc.) only via `process.env`. Never checked in. Never logged.
- Authorize every protected route. A valid session is not authorization. Check ownership (e.g. drone `userId === session.user.id`) before mutating.
- Neon HTTP driver lacks transactions. Write multi-step mutations to be idempotent and best-effort, with recovery-friendly logging.
- No dynamic SQL concatenation. Use Drizzle query builders or parameterized queries.

## Accessibility

- Semantic HTML (`nav`, `main`, `button`, `a`, `label`). No `div` soup.
- All interactive elements keyboard-accessible with visible focus states.
- Form inputs have associated `<label>`s. Error messages are linked to their fields.
- `lucide-react` icons get `aria-label` when standalone, `aria-hidden` when decorative.
- Contrast sufficient against the dark theme. Meet WCAG 2.1 AA.
- Respect `prefers-reduced-motion` for animations and `ScrollReveal`-style effects.

## Code Quality

- JSDoc on exported functions and component props. This is the project's type system.
- Container/Presentational split for feature components.
- Services own DB access. Route handlers call `services/*.service.js`. Drizzle queries do not live in route handlers.
- Comments explain **why**, not **what**. No running commentary. No `// removed` breadcrumbs.
- No dead code: remove unused imports, variables, exports, and commented-out blocks.
- No `console.log` debug noise in committed code. Use `console.error` for real failures only.
- Match existing style in the file. Don't reformat unrelated lines.
- **Max 4 files per change.** If a fix needs more, escalate to Captain.

## Styling

- CSS Modules co-located with the component (`Foo.jsx` + `Foo.module.css`).
- Every color, spacing, font, radius, shadow, and breakpoint value pulled from a variable in `app/globals.css`. Hardcoding is a bug.
- Build on `components/ui/*` primitives. Don't roll your own Button/Card/Modal/DataTable.
- Responsive at 1440 / 1024 / 375. Verify visually at every breakpoint.

## Content Integrity

- Loading states while data is fetched. Use skeletons from `components/ui/Skeleton`.
- Error states on failed fetches. Surface through `Toast` (`components/ui/Toast`). No silent failures.
- Empty states that tell the user what to do next. Use `components/ui/EmptyState`.
- Error messages are specific and actionable. Numbers formatted consistently across the UI.

## Writing Style

These rules apply to all user-facing copy in the app (page text, labels, tooltips, error messages, docs in `app/guide`, `app/faq`, etc.) and to internal docs (`HANDOFF.md`, `DECISIONS.md`).

- **No em dashes (`—`) or en dashes (`–`) anywhere.** Use a regular hyphen (`-`) for compound modifiers (`level-up`, `30-day`). Otherwise rewrite the sentence with a period, comma, colon, or parentheses. No exceptions.
- **No rhetorical "X but not Y" / "X, not Y" constructs.** State what is true. Drop the contrast. "Points are player-level. You spend them where you want." not "Points are player-level, not drone-level."
- **No editorial closers.** Drop "choose wisely", "harder wins pay more", "the drone is whatever you make of it", "and the rest is up to you". State the mechanic and stop.
- **Declarative, not promotional.** "3 laps per race" not "every race is multiple laps". "Wins pay 3 points base." not "Winning is rewarded with valuable points."
- **Short sentences. Cut filler.** "Sign up with email." not "All you need to do is sign up with your email address." Drop "really", "actually", "simply", "just", "very", "in order to", "you can".
- **Numbers as digits.** "5 minutes" not "five minutes". "3 laps" not "three laps". Match the rest of the codebase (the seed, the validators, the existing UI).
- **Active voice, present tense.** "The simulator picks a winner." not "A winner is picked by the simulator."
- **Match the source of truth.** Game-mechanic copy must match `lib/game-engine/`, `services/`, and `lib/db/seed.js`. If a number changes there, the copy follows. Don't paraphrase formulas. Don't round.
- **No left-border (or any border) accents on Guide / FAQ section blocks.** Section differentiation in `app/guide` and `app/faq` is done with the existing pill, the section heading bar, and spacing. Never add `border-left`, `border-right`, `border-top`, or `border-bottom` to a section wrapper as a visual accent. This applies even when prescribed copy or prior conversation suggests otherwise.

## Commit and Push Hygiene

- **Scoped commits only.** Stage and commit only the files inside the scope of the task you were given. If the task is "Guide/FAQ", touch only `app/guide`, `app/faq`, and the rules docs that govern them. Never use `git add -A`, `git add .`, or `git commit -a`.
- **Working tree is shared.** Other dirty files (pages, services, schema, untracked feature folders) are almost always in-progress work by another agent or session. Never bundle them into your commit, even when the user says "push" or "push all". If you think a non-scope file should be included, list it explicitly in your reply and let the user decide.
- **Sweep before staging.** Run `git status` and identify what is yours vs theirs. Stage by exact path. After committing, list every non-scope dirty file in your reply so the user knows what's still outstanding.
- **Push by default targets `origin/main`.** Don't switch branches, don't force-push, don't skip hooks unless the user explicitly says so.
