'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname, useRouter } from 'next/navigation';
import styles from './Onboarding.module.css';

const STORAGE_DONE = 'onboarding_complete';
const STORAGE_STEP = 'onboarding_step';

/* Each step pins to a route plus a list of "targets". Each target is a
 * priority list of CSS-module class fragments; `findVisibleTarget`
 * walks the list and picks the first match with a non-zero
 * getBoundingClientRect. Listing multiple targets lets a step
 * spotlight several disjoint areas at once (e.g. step 1 lights up the
 * active-drone panel and the upcoming-race panel together). Listing
 * priority fallbacks within a target handles desktop / mobile dual
 * markup (e.g. .points / .mobilePoints) and conditionally rendered
 * elements (e.g. .upcomingBanner only when matchups exist,
 * .packsShowcase only when the Packs tab is active). An empty
 * `targets` array means "no spotlight" - currently unused but kept as
 * an explicit affordance for purely informational steps. */
const STEPS = [
  {
    path: '/dashboard',
    targets: [['[class*="areaSpotlight"]'], ['[class*="areaNextRace"]']],
    text: 'Welcome to Hyperdrome. This is your dashboard. These show your active drones and your upcoming races - toggle through both to see what\'s happening.',
  },
  {
    path: '/dashboard',
    targets: [['[class*="points"]']],
    text: 'These are your volts - your currency for everything. Buy packs, trade on the marketplace, and upgrade your drone stats.',
  },
  {
    path: '/dashboard',
    targets: [['[class*="countdownBar"]']],
    text: 'The footer shows the countdown to the next race round (every 3 minutes), the strategy lock countdown (first 2 minutes of each round), and your upcoming races for active drones. Click the numbered race links to preview matchups.',
  },
  {
    path: '/races',
    targets: [['[class*="upcomingBanner"]', '[class*="topStrip"]']],
    text: 'The top bar shows your upcoming matchups for active drones. The races table below shows all completed races - toggle "Your Races" to filter to just yours.',
  },
  {
    path: '/drones',
    targets: [['[class*="cardLink"]']],
    text: 'Click any drone to open the Drone Manager. Click Next to jump straight there.',
    /* Drone manager URLs are dynamic (/drones/<uuid>), so the next-step
     * destination has to be read from the rendered DOM. The first
     * .cardLink is a Next.js Link rendered as an <a> with its href set
     * to /drones/<id>; we grab that and let router.push handle the
     * SPA nav. */
    nextHref: () => {
      if (typeof document === 'undefined') return null;
      const link = document.querySelector('[class*="cardLink"]');
      return link?.getAttribute('href') ?? null;
    },
  },
  {
    pathPrefix: '/drones/',
    targets: [
      ['[class*="rightPanel"]'],
      ['[class*="collectibleRow"]'],
    ],
    text: 'This is the Drone Manager. Modify the drone\'s stats here. Equip skins and mods to customize how it races.',
  },
  {
    path: '/marketplace',
    targets: [['[class*="tabs"]', '[class*="topRow"]']],
    text: 'The marketplace. Browse and trade drones, skins, mods, and packs. Everything costs volts.',
  },
  {
    path: '/marketplace',
    targets: [['[class*="packsShowcase"]', '[class*="topRow"]']],
    text: 'Packs are how you get new skins and mods. Three tiers with different odds and prices. Spend your volts wisely.',
  },
];

const SPOTLIGHT_PAD = 8;
const SPOTLIGHT_RX = 12;
const TIP_MARGIN = 16;
const TIP_WIDTH = 360;
const TIP_HEIGHT_FALLBACK = 220;
const MASK_ID = 'hyperdrome-onboarding-mask';
/* Page-mount + smooth-scroll settle. App-Router pushes are fast in
 * practice (~50ms) but the destination page still needs a tick to
 * mount client components, hydrate stores, and run the first effect
 * pass. 500ms covers the slowest of those without feeling laggy. */
const SETTLE_MS = 500;

/* Each step matches its page either by exact path or by a `/foo/` prefix
 * (used by the drone-manager step where the path includes a dynamic
 * UUID). Returns false for an undefined step so the rest of the code
 * can call this without null-checks. */
function pathMatches(stepDef, pathname) {
  if (!stepDef) return false;
  if (stepDef.pathPrefix) return pathname.startsWith(stepDef.pathPrefix);
  return pathname === stepDef.path;
}

function findVisibleTarget(selectors) {
  if (!selectors?.length || typeof document === 'undefined') return null;
  for (const sel of selectors) {
    const matches = document.querySelectorAll(sel);
    for (const el of matches) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return el;
    }
  }
  return null;
}

/* Find the rect for each target in a step. Each target is itself a
 * priority list, so the function returns at most one rect per target
 * (or skips it when no fallback resolves). */
function measureTargets(targets) {
  const rects = [];
  for (const sel of targets ?? []) {
    const el = findVisibleTarget(sel);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    rects.push({ top: r.top, left: r.left, width: r.width, height: r.height });
  }
  return rects;
}

/* Programmatic Packs-tab click. Marketplace owns its tab state via a
 * local useState, so the only way for this component to surface the
 * packs panel without modifying marketplace is to find the tab button
 * by its rendered text and trigger its React onClick. The desktop
 * tab buttons render at all viewports (mobile hides them via CSS but
 * leaves them in the DOM), so a single .click() works for both
 * breakpoints. Returns true on success so the caller can schedule a
 * re-measure once `.packsShowcase` mounts. */
function activatePacksTab() {
  if (typeof document === 'undefined') return false;
  const buttons = document.querySelectorAll('button[role="tab"]');
  for (const btn of buttons) {
    if (btn.textContent?.trim() === 'Packs') {
      btn.click();
      return true;
    }
  }
  return false;
}

export default function Onboarding() {
  const pathname = usePathname();
  const router = useRouter();
  const [hydrated, setHydrated] = useState(false);
  const [step, setStep] = useState(0);
  const [pendingStep, setPendingStep] = useState(null);
  const [active, setActive] = useState(false);
  const [rects, setRects] = useState([]);
  const [viewport, setViewport] = useState({ w: 0, h: 0 });
  const [tipH, setTipH] = useState(TIP_HEIGHT_FALLBACK);
  const tipRef = useRef(null);

  /* First-mount hydration. Reading localStorage during render would
   * mismatch the SSR output, so we defer until after hydration. The
   * settle delay lets the destination page lay out before we attempt
   * to measure a target. */
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    setHydrated(true);
    if (window.localStorage.getItem(STORAGE_DONE) === '1') return undefined;

    const storedStep = window.localStorage.getItem(STORAGE_STEP);
    if (storedStep != null) {
      const parsed = Number(storedStep);
      if (Number.isInteger(parsed) && parsed >= 0 && parsed < STEPS.length) {
        setStep(parsed);
        const t = setTimeout(() => setActive(true), SETTLE_MS);
        return () => clearTimeout(t);
      }
    }
    /* Fresh install: only auto-trigger when the user lands on the
     * dashboard. Visits to /, /login, /faq etc. should not pop the
     * tour; the demo-login flow now redirects to /dashboard which is
     * the canonical entry point. */
    if (pathname === '/dashboard') {
      window.localStorage.setItem(STORAGE_STEP, '0');
      setStep(0);
      const t = setTimeout(() => setActive(true), SETTLE_MS);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [pathname]);

  /* When Next was clicked on a step that auto-navigates, we stash the
   * intended next index in `pendingStep` and only commit it once the
   * router lands on the matching pathname. This keeps the visible step
   * coherent during the navigation gap: the user keeps seeing the
   * current step's spotlight + tip until the new page mounts, then the
   * step advances cleanly with no flash of mismatched content. */
  useEffect(() => {
    if (pendingStep == null) return;
    if (!pathMatches(STEPS[pendingStep], pathname)) return;
    window.localStorage.setItem(STORAGE_STEP, String(pendingStep));
    setStep(pendingStep);
    setPendingStep(null);
  }, [pathname, pendingStep]);

  const stepHasSpotlight = (STEPS[step]?.targets?.length ?? 0) > 0;

  /* Clear rects immediately on step change so the previous step's
   * spotlight doesn't sit under the new step's tip text during the
   * SETTLE_MS settle window. Pathname-only changes (manual nav, or
   * the gap between router.push and pendingStep commit) deliberately
   * skip this so a NavShell-anchored spotlight (e.g. countdownBar)
   * stays on screen across the navigation. */
  useEffect(() => {
    setRects([]);
  }, [step]);

  const measure = useCallback(() => {
    if (typeof window === 'undefined') return;
    setViewport({ w: window.innerWidth, h: window.innerHeight });
    if (!stepHasSpotlight) {
      setRects([]);
      return;
    }
    setRects(measureTargets(STEPS[step].targets));
  }, [step, stepHasSpotlight]);

  /* Re-measure on step change, page change, scroll, and resize. The
   * SETTLE_MS delay absorbs the page mount + smooth-scroll tail.
   * Capture-phase scroll listener catches scrolls inside any nested
   * overflow container as well as the viewport. Measurement is
   * unconditional on pathname: targets that don't exist on the current
   * page resolve to no rect, which collapses the spotlight render to
   * the dim backdrop. This means a target that lives in NavShell
   * (e.g. the countdownBar footer) keeps its spotlight during the
   * cross-page navigation gap, avoiding a flash of mismatched UI.
   *
   * Retry-until-found polling: pages that fetch data on mount (the
   * drone manager waits on /api/drones/[id] before rendering its
   * rightPanel + collectibleRow) may not have the targets in the DOM
   * at the SETTLE_MS mark. Rather than guess a longer settle, we poll
   * every 250ms up to 8 retries until every expected target resolves.
   * Each successful partial measurement still updates rects, so the
   * first target paints as soon as it's available even if its sibling
   * is still mounting. */
  useEffect(() => {
    if (!active) return undefined;
    if (!stepHasSpotlight) {
      setRects([]);
      setViewport({ w: window.innerWidth, h: window.innerHeight });
      return undefined;
    }
    const stepDef = STEPS[step];
    const expected = stepDef.targets.length;

    /* Scroll the first target into view so the user can see it. The
     * footer countdownBar uses position:fixed and therefore ignores
     * scrollIntoView, which is fine - it's already pinned to the
     * viewport bottom. */
    const firstEl = findVisibleTarget(stepDef.targets[0]);
    firstEl?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });

    let retries = 0;
    const maxRetries = 8;
    let timer = null;
    const attempt = () => {
      if (typeof window === 'undefined') return;
      setViewport({ w: window.innerWidth, h: window.innerHeight });
      const found = measureTargets(stepDef.targets);
      if (found.length > 0) setRects(found);
      if (found.length < expected && retries < maxRetries) {
        retries++;
        timer = setTimeout(attempt, 250);
      }
    };
    timer = setTimeout(attempt, SETTLE_MS);

    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [active, step, stepHasSpotlight, pathname, measure]);

  /* Step 8 needs the marketplace's local Packs tab to be active so
   * `.packsShowcase` mounts and the spotlight has something concrete
   * to anchor to. Triggers the click after a short delay (lets the
   * marketplace finish mounting) then re-measures once the panel
   * renders. Idempotent: clicking Packs while it's already active is
   * a no-op in marketplace's setTab. */
  useEffect(() => {
    if (!active) return undefined;
    if (step !== STEPS.length - 1) return undefined;
    if (pathname !== '/marketplace') return undefined;
    const click = setTimeout(() => {
      const ok = activatePacksTab();
      if (ok) setTimeout(measure, SETTLE_MS);
    }, 200);
    return () => clearTimeout(click);
  }, [active, step, pathname, measure]);

  /* Synchronously measure the tip's full border-box height after every
   * render that changes it (active flip, step change). useLayoutEffect
   * runs after DOM commit but before paint, so the resulting setTipH
   * triggers a synchronous re-render with the correct placement before
   * the user ever sees a frame. This is the fix for the "tip overlaps
   * spotlight" bug: the previous ResizeObserver read `contentRect`
   * (content box, padding excluded) which was ~48px short - large
   * enough to land the bottom edge of the tip card on top of the
   * countdownBar footer. `offsetHeight` is the border-box height,
   * which is what the placement math needs. */
  useLayoutEffect(() => {
    if (!active) return;
    const el = tipRef.current;
    if (!el) return;
    const h = el.offsetHeight;
    if (h > 0 && h !== tipH) setTipH(h);
  }, [active, step, tipH]);

  /* Keep the tip height in sync if the viewport reflows the card
   * mid-step (browser zoom, devtools open, font-loading shift). Same
   * border-box semantics via offsetHeight. */
  useEffect(() => {
    if (!active) return undefined;
    const el = tipRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => {
      const h = el.offsetHeight;
      if (h > 0) setTipH(h);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [active, step]);

  if (!hydrated || !active) return null;
  if (typeof document === 'undefined') return null;

  const current = STEPS[step];
  const isFinal = step === STEPS.length - 1;

  const finish = () => {
    window.localStorage.setItem(STORAGE_DONE, '1');
    window.localStorage.removeItem(STORAGE_STEP);
    setPendingStep(null);
    setActive(false);
  };

  const handleNext = () => {
    if (isFinal) {
      finish();
      router.push('/dashboard');
      return;
    }
    const next = step + 1;
    const nextDef = STEPS[next];
    /* Determine the destination URL. Most steps know their own path
     * (static). The cardLink step uses `nextHref()` to read the first
     * drone card's dynamic /drones/<uuid> from the DOM, since the
     * drone-manager step's `pathPrefix` is a matcher, not a concrete
     * URL we could router.push to. */
    const destUrl = current.nextHref?.() ?? nextDef.path ?? null;
    if (destUrl && destUrl !== pathname) {
      setPendingStep(next);
      router.push(destUrl);
      return;
    }
    window.localStorage.setItem(STORAGE_STEP, String(next));
    setStep(next);
  };

  const bbox = boundingBox(rects);
  const tipStyle = computeTipStyle(bbox, viewport, tipH);
  const stepCounter = `${String(step + 1).padStart(2, '0')} / ${String(STEPS.length).padStart(2, '0')}`;

  return createPortal(
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label="Hyperdrome tour"
    >
      {rects.length > 0 && viewport.w > 0 ? (
        <>
          {/* Single SVG mask carves all spotlight holes at once. The
              previous per-spotlight box-shadow technique broke with
              multi-spotlight: each spotlight's giant outer shadow
              dimmed every other spotlight, so step 1 (dashboard) had
              its two lit areas darkened by each other. With one mask
              and N rect cutouts, all holes are punched in the same
              dim rectangle - no inter-spotlight interference. */}
          <svg className={styles.maskOverlay} aria-hidden="true">
            <defs>
              {/* maskUnits=userSpaceOnUse means inner coordinates are
                  pixel-space, matching the cutout rects' pixel coords
                  from getBoundingClientRect. Percentages on the
                  full-coverage rect resolve against the SVG's own
                  pixel dimensions (no viewBox), so the mask always
                  covers the whole overlay regardless of how the
                  viewport state has settled. */}
              <mask id={MASK_ID} maskUnits="userSpaceOnUse">
                <rect x="0" y="0" width="100%" height="100%" fill="white" />
                {rects.map((r, i) => (
                  <rect
                    key={i}
                    x={r.left - SPOTLIGHT_PAD}
                    y={r.top - SPOTLIGHT_PAD}
                    width={r.width + SPOTLIGHT_PAD * 2}
                    height={r.height + SPOTLIGHT_PAD * 2}
                    rx={SPOTLIGHT_RX}
                    ry={SPOTLIGHT_RX}
                    fill="black"
                  />
                ))}
              </mask>
            </defs>
            <rect
              x="0"
              y="0"
              width="100%"
              height="100%"
              fill="rgba(0,0,0,0.85)"
              mask={`url(#${MASK_ID})`}
            />
          </svg>
          {rects.map((r, i) => (
            <div
              key={i}
              className={styles.spotlightRing}
              style={{
                top: r.top - SPOTLIGHT_PAD,
                left: r.left - SPOTLIGHT_PAD,
                width: r.width + SPOTLIGHT_PAD * 2,
                height: r.height + SPOTLIGHT_PAD * 2,
              }}
            />
          ))}
        </>
      ) : (
        <div className={styles.backdrop} />
      )}

      <div ref={tipRef} className={styles.tip} style={tipStyle}>
        <div className={styles.tipMeta}>
          <span className={styles.tipStep}>{stepCounter}</span>
        </div>
        <p className={styles.tipText}>{current.text}</p>
        <div className={styles.tipActions}>
          <button type="button" className={styles.skipBtn} onClick={finish}>
            Skip
          </button>
          <button type="button" className={styles.nextBtn} onClick={handleNext}>
            {isFinal ? 'Got it' : 'Next'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* Smallest axis-aligned rect that encloses every spotlit element.
 * Used as the anchor for tip placement so the tip stays clear of the
 * whole highlighted area, not just one target. */
function boundingBox(rects) {
  if (!rects?.length) return null;
  let top = Infinity;
  let left = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const r of rects) {
    if (r.top < top) top = r.top;
    if (r.left < left) left = r.left;
    if (r.left + r.width > right) right = r.left + r.width;
    if (r.top + r.height > bottom) bottom = r.top + r.height;
  }
  return { top, left, width: right - left, height: bottom - top };
}

/* Position the tip card so it never overlaps the spotlight bounding
 * box. Rule: pick the side (above / below) with more space; on a tie
 * place below. If the preferred side can't fit the tip with a
 * TIP_MARGIN gap, fall back to the opposite side. Centred fallback
 * runs only when there's no rect at all (welcome step or transient
 * navigation gap before measurement). The mobile dock CSS overrides
 * these values entirely on phones. */
function computeTipStyle(box, viewport, tipH) {
  if (!box || !viewport.w) {
    return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
  }
  const tipW = Math.min(TIP_WIDTH, viewport.w - TIP_MARGIN * 2);
  const spaceAbove = box.top;
  const spaceBelow = viewport.h - (box.top + box.height);
  const needed = tipH + TIP_MARGIN;
  const fitsAbove = spaceAbove >= needed;
  const fitsBelow = spaceBelow >= needed;

  /* Decide once. Tie goes below. If the preferred side can't fit but
   * the other side can, use the other side. If neither fits we still
   * pick the side with more space and let the clamp keep the tip
   * on-screen - this only happens on tiny viewports where overlap is
   * unavoidable; the side with more space minimises the encroachment. */
  let placeAbove;
  if (spaceAbove > spaceBelow) {
    placeAbove = fitsAbove || !fitsBelow;
  } else {
    placeAbove = !fitsBelow && fitsAbove;
  }

  let top;
  if (placeAbove) {
    top = box.top - tipH - TIP_MARGIN;
    if (top < TIP_MARGIN) top = TIP_MARGIN;
  } else {
    top = box.top + box.height + TIP_MARGIN;
    const maxTop = viewport.h - tipH - TIP_MARGIN;
    if (top > maxTop) top = maxTop;
    if (top < TIP_MARGIN) top = TIP_MARGIN;
  }

  let left = box.left + (box.width - tipW) / 2;
  left = Math.max(TIP_MARGIN, Math.min(viewport.w - tipW - TIP_MARGIN, left));

  return { top, left, width: tipW };
}
