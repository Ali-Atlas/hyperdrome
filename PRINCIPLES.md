# PRINCIPLES.md - Quality Standards

Cross-cutting quality standards Compass evaluates against and Mercenary follows. Every change must pass these checks before being marked complete.

---

## Performance

- Prefer server components — only use `'use client'` when state, effects, or browser APIs demand it.
- Avoid unnecessary re-renders — lift state only as high as needed; memoize heavy computations, not cheap ones.
- Normalize DB-backed data by id for O(1) lookups on the client.
- Image assets sized for their display context — use `next/image` and explicit dimensions.
- No new dependencies without justification. The stack is intentionally small (Next, React, Drizzle, Zod, NextAuth, Resend, lucide-react) — adding to it needs Captain sign-off.
- Respect Next.js 16 caching defaults — check `node_modules/next/dist/docs/` before reaching for `revalidate`, `cache`, or `'use cache'`.

## Security

- Validate every mutation input with Zod at the route handler boundary — no trusting request bodies.
- Auth state comes from NextAuth (`auth()` server-side, `useSession()` client-side). Never stash tokens in `localStorage`.
- Secrets (`DATABASE_URL`, `RESEND_API_KEY`, `NEXTAUTH_SECRET`, etc.) only via `process.env` — never checked in, never logged.
- Authorize every protected route. A valid session is not authorization — check ownership (e.g. drone `userId === session.user.id`) before mutating.
- Neon HTTP driver lacks transactions — write multi-step mutations to be idempotent and best-effort, with recovery-friendly logging.
- No dynamic SQL concatenation — use Drizzle query builders or parameterized queries.

## Accessibility

- Semantic HTML (`nav`, `main`, `button`, `a`, `label`) — not `div` soup.
- All interactive elements keyboard-accessible with visible focus states.
- Form inputs have associated `<label>`s; error messages are linked to their fields.
- `lucide-react` icons get `aria-label` when standalone, `aria-hidden` when decorative.
- Contrast sufficient against the dark theme — meet WCAG 2.1 AA.
- Respect `prefers-reduced-motion` for animations and `ScrollReveal`-style effects.

## Code Quality

- JSDoc on exported functions and component props — this is the project's type system.
- Container/Presentational split for feature components.
- Services own DB access — route handlers call `services/*.service.js`, not Drizzle directly.
- Comments explain **why**, not **what**. No running commentary; no `// removed` breadcrumbs.
- No dead code: remove unused imports, variables, exports, and commented-out blocks.
- No `console.log` debug noise in committed code — `console.error` for real failures only.
- Match existing style in the file — don't reformat unrelated lines.
- **Max 4 files per change.** If a fix needs more, escalate to Captain.

## Styling

- CSS Modules co-located with the component (`Foo.jsx` + `Foo.module.css`).
- Every color, spacing, font, radius, shadow, and breakpoint value pulled from a variable in `app/globals.css`. Hardcoding is a bug.
- Build on `components/ui/*` primitives — don't roll your own Button/Card/Modal/DataTable.
- Responsive at 1440 / 1024 / 375 — verify visually at every breakpoint.

## Content Integrity

- Loading states while data is fetched — skeletons from `components/ui/Skeleton`.
- Error states on failed fetches — surface through `Toast` (`components/ui/Toast`), not silent failures.
- Empty states that tell the user what to do next — use `components/ui/EmptyState`.
- Error messages are specific and actionable; numbers formatted consistently across the UI.
