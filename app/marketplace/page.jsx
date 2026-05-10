'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Search, Plus, ChevronDown, ChevronUp, ChevronRight, X, Check } from 'lucide-react';
import NavShell from '@/components/ui/NavShell';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import Spinner from '@/components/ui/Spinner';
import EmptyState from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/Toast';
import { useSession } from '@/hooks/useSession';
import { useVoltBalance } from '@/hooks/useVoltBalance';
import {
  cn,
  getLevelColor,
  getLevelTier,
  getLegendaryTheme,
} from '@/lib/utils';
import DroneImage from '@/components/ui/DroneImage';
import VoltIcon from '@/components/ui/VoltIcon';
import ModPlaceholder from '@/components/ui/ModPlaceholder';
import SkinThumb from '@/components/ui/SkinThumb';
import styles from './page.module.css';

const PACK_DEFS = [
  {
    id: 'starter',
    name: 'Starter Pack',
    price: 2_000,
    variant: 'gray',
    contents: '3 Skins - 1 Common guaranteed, 2 wild slots',
    description:
      'Guaranteed common plus two wild slots. Common-heavy, with shots at rare or higher.',
    slots: [
      { variant: 'common' },
      { variant: 'rainbow', mystery: true },
      { variant: 'rainbow', mystery: true },
    ],
    rates: [
      { label: 'Common (slot 1)', rarity: 'common', chance: '100%' },
      { label: 'Common (slots 2-3)', rarity: 'common', chance: '80%' },
      { label: 'Rare (slots 2-3)', rarity: 'rare', chance: '17%' },
      { label: 'Epic (slots 2-3)', rarity: 'epic', chance: '2.5%' },
      { label: 'Legendary (slots 2-3)', rarity: 'legendary', chance: '0.5%' },
    ],
    buttonVariant: 'secondary',
  },
  {
    id: 'premium',
    name: 'Premium Pack',
    price: 12_000,
    variant: 'purple',
    contents: '3 Skins - 1 Rare guaranteed, 2 wild slots',
    description:
      'Guaranteed rare plus two wild slots that can land any rarity.',
    pills: [{ label: 'Most Popular', tone: 'accent' }],
    slots: [
      { variant: 'rare' },
      { variant: 'rainbow', mystery: true },
      { variant: 'rainbow', mystery: true },
    ],
    rates: [
      { label: 'Rare (slot 1)', rarity: 'rare', chance: '100%' },
      { label: 'Common (slots 2-3)', rarity: 'common', chance: '40%' },
      { label: 'Rare (slots 2-3)', rarity: 'rare', chance: '35%' },
      { label: 'Epic (slots 2-3)', rarity: 'epic', chance: '20%' },
      { label: 'Legendary (slots 2-3)', rarity: 'legendary', chance: '5%' },
    ],
    buttonVariant: 'primary',
  },
  {
    id: 'legendary',
    name: 'Legendary Pack',
    price: 60_000,
    variant: 'gold',
    contents: '3 Skins - 1 high-tier slot + 2 wild slots',
    description:
      'Slot 1 lands legendary or epic. Two wild slots that lean rare or epic.',
    slots: [
      { variant: 'rainbow', mystery: true },
      { variant: 'rainbow', mystery: true },
      { variant: 'rainbow', mystery: true },
    ],
    rates: [
      { label: 'Legendary (slot 1)', rarity: 'legendary', chance: '45%' },
      { label: 'Epic (slot 1)', rarity: 'epic', chance: '55%' },
      { label: 'Rare (slots 2-3)', rarity: 'rare', chance: '55%' },
      { label: 'Epic (slots 2-3)', rarity: 'epic', chance: '40%' },
      { label: 'Legendary (slots 2-3)', rarity: 'legendary', chance: '5%' },
    ],
    buttonVariant: 'gold',
  },
];

/* 6-card preview composition per pack id. Mirrors the expected output
 * across the 3 slots so the preview is an honest representation of what
 * each pack tends to yield. Derived from services/pack.service.js
 * PACK_SLOTS:
 *   Starter   → 1 G common + 2× wild (80/17/2.5/0.5)  → 5 common, 1 rare.
 *   Premium   → 1 G rare   + 2× wild (40/35/20/5)     → 3 rare, 2 common, 1 epic.
 *   Legendary → slot 1 (45L/55E) + 2× wild (55/40/5)  → 2 legendary, 2 epic, 2 rare. */
const PREVIEW_DISTRIBUTION = {
  starter:   ['common', 'common', 'common', 'common', 'common', 'rare'],
  premium:   ['rare', 'rare', 'rare', 'common', 'common', 'epic'],
  legendary: ['legendary', 'legendary', 'epic', 'epic', 'rare', 'rare'],
};

/** Pick 6 sample skins from the image-backed catalog matching the pack's
 *  preview distribution. De-duplicates within a rarity by walking a
 *  shuffled copy of that rarity's pool with a per-rarity cursor.
 *  @param {string} packId
 *  @param {Record<string, Array<object>>} pool - skins keyed by rarity
 *  @returns {Array<object>}
 */
function pickPreviewSamples(packId, pool) {
  const distribution = PREVIEW_DISTRIBUTION[packId] ?? [];
  const shuffled = {};
  for (const rarity of Object.keys(pool ?? {})) {
    const list = [...(pool[rarity] ?? [])];
    for (let i = list.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    shuffled[rarity] = list;
  }
  const cursors = { common: 0, rare: 0, epic: 0, legendary: 0 };
  const samples = [];
  for (const rarity of distribution) {
    const list = shuffled[rarity] ?? [];
    if (list.length === 0) continue;
    samples.push(list[cursors[rarity] % list.length]);
    cursors[rarity] += 1;
  }
  return samples;
}

/* Mod template names per rarity, mirrored from lib/db/seed-mods.js. Used
 * to populate the capsule preview cards with real names instead of bare
 * rarity labels. Same shape as the skin pool so pickModPreviewSamples can
 * reuse the cursor-walks-shuffled-list pattern (no duplicates per row). */
const MOD_TEMPLATE_NAMES = {
  common: [
    'Streamline Plate', 'Grip Pads', 'Quick Charge', 'Shock Absorber',
    'Steady Module', 'Night Lens', 'Rain Shield', 'Wind Fin',
    'Light Frame', 'Tracker Coil',
  ],
  rare: [
    'Aero Shell', 'Grip Coating', 'Storm Plating', 'Night Optics',
    'Turbo Intake', 'Endurance Core', 'Aileron Kit', 'Stabilizer Brace',
  ],
  epic: [
    'Plasma Core', 'Stealth Aero', 'Typhoon Module', 'Predator Lens',
    'Iron Hull',
  ],
  legendary: ['Phantom Drive', 'Quantum Sync', 'Storm Rider'],
};

/** Pick 6 mod template names per the capsule's preview distribution.
 *  Cursor-walks a per-rarity shuffled list so no name repeats inside the
 *  same preview row. */
function pickModPreviewSamples(packId) {
  const distribution = CAPSULE_PREVIEW_DISTRIBUTION[packId] ?? [];
  const shuffled = {};
  for (const rarity of Object.keys(MOD_TEMPLATE_NAMES)) {
    const list = [...MOD_TEMPLATE_NAMES[rarity]];
    for (let i = list.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    shuffled[rarity] = list;
  }
  const cursors = { common: 0, rare: 0, epic: 0, legendary: 0 };
  const samples = [];
  for (const rarity of distribution) {
    const list = shuffled[rarity] ?? [];
    if (list.length === 0) continue;
    samples.push({ name: list[cursors[rarity] % list.length], rarity });
    cursors[rarity] += 1;
  }
  return samples;
}

// Live ticker - a hardcoded sample pull. Uses a real seeded username
// (MKT_ORBIT) so the text looks plausible, not fabricated.
const LIVE_TICKER = {
  packsOpenedToday: 2369,
  lastPull: { username: 'MKT_ORBIT', rarity: 'legendary', name: 'Mach Zero' },
};

/** Points purchase options for the GET POINTS tab. 3 visual tiers
 *  (teal / purple / gold), 6 packs total. Bonus % scales nonlinearly
 *  to nudge bigger purchases. All buttons stay disabled until token-
 *  payment integration ships. */
const POINTS_OPTIONS = [
  { id: 1, points: 500,    price: 50,    tier: 'teal',   bonus: null,           chest: '/chests/chest-teal.webp' },
  { id: 2, points: 1200,   price: 100,   tier: 'teal',   bonus: '+20% BONUS',   chest: '/chests/chest-teal.webp' },
  { id: 3, points: 3500,   price: 250,   tier: 'purple', bonus: '+40% BONUS',   chest: '/chests/chest-purple.webp' },
  { id: 4, points: 8000,   price: 500,   tier: 'purple', bonus: '+60% BONUS',   chest: '/chests/chest-purple.webp' },
  { id: 5, points: 22000,  price: 1000,  tier: 'gold',   bonus: '+100% BONUS',  chest: '/chests/chest-gold.webp' },
  { id: 6, points: 60000,  price: 2500,  tier: 'gold',   bonus: '+140% BONUS',  chest: '/chests/chest-gold.webp', bestValue: true },
];

const RARITY_LIST = ['common', 'rare', 'epic', 'legendary'];
const RARITY_LABELS = {
  common: 'Common',
  rare: 'Rare',
  epic: 'Epic',
  legendary: 'Legendary',
};

// Display odds per pack tier. Convention: per-rarity, surface the BEST
// per-slot probability across the recipe. A guaranteed rarity therefore
// shows at 100%; rarities that only appear in the wild slots show at
// their wild-slot %. (We don't aggregate across all 3 slots — the
// per-card chance is what a player actually cares about: "what's the
// chance each remaining slot lands this rarity.") Skin packs and mod
// capsules share the same recipe, so this map drives both.
//   starter:   1 G common + wild 80/17/2.5/0.5  → C 100, R 17, E 2.5, L 0.5
//   premium:   1 G rare   + wild 40/35/20/5     → R 100, C 40, E 20, L 5
//   legendary: slot 1 L 45/E 55 + wild 55/40/5  → L 45, E 55, R 55
const PACK_ODDS = {
  starter:   { common: 100, rare: 17,   epic: 2.5, legendary: 0.5 },
  premium:   { common: 40,  rare: 100,  epic: 20,  legendary: 5 },
  legendary: { common: 0,   rare: 55,   epic: 55,  legendary: 45 },
};

/* Capsule (mod) packs - same slot recipe as skin packs, priced lower.
 * Backed by /api/marketplace/capsules/open via openCapsule() in
 * services/pack.service.js. */
const CAPSULE_PACK_DEFS = [
  {
    id: 'capsule-starter',
    name: 'Starter Capsule',
    price: 1_000,
    variant: 'gray',
    description:
      'Guaranteed common plus two wild slots. Common-heavy, with shots at rare or higher.',
    buttonVariant: 'secondary',
  },
  {
    id: 'capsule-premium',
    name: 'Premium Capsule',
    price: 6_000,
    variant: 'purple',
    description:
      'Guaranteed rare mod plus two wild slots leaning rare or epic.',
    pills: [{ label: 'Most Popular', tone: 'accent' }],
    buttonVariant: 'primary',
  },
  {
    id: 'capsule-legendary',
    name: 'Legendary Capsule',
    price: 30_000,
    variant: 'gold',
    description:
      'Slot 1 lands legendary or epic. Two wild slots that lean rare or epic.',
    buttonVariant: 'gold',
  },
];

// Capsules use the SAME PACK_SLOTS recipe as skin packs server-side, so
// the aggregate odds match. Map keyed by capsule id (with `capsule-`
// prefix) for the marketplace's per-card odds bar.
const CAPSULE_PACK_ODDS = {
  'capsule-starter':   PACK_ODDS.starter,
  'capsule-premium':   PACK_ODDS.premium,
  'capsule-legendary': PACK_ODDS.legendary,
};

// Capsule preview cards mirror the skin pack distribution one-for-one.
const CAPSULE_PREVIEW_DISTRIBUTION = {
  'capsule-starter':   PREVIEW_DISTRIBUTION.starter,
  'capsule-premium':   PREVIEW_DISTRIBUTION.premium,
  'capsule-legendary': PREVIEW_DISTRIBUTION.legendary,
};


export default function MarketplacePage() {
  const { user } = useSession();
  const { showToast } = useToast();

  const router = useRouter();
  const [tab, setTab] = useState('drones'); // 'drones' | 'mods' | 'skins' | 'packs' | 'points'
  const [view, setView] = useState('all'); // 'all' | 'mine'
  /* Custom mobile section dropdown (<=440px) - replaces the native
   * <select> so the option list, radio circles, and popover chrome
   * can be styled to match the rest of the marketplace. Closed by
   * default; click-outside + option-click both close it. */
  const [tabsOpen, setTabsOpen] = useState(false);
  const tabsDropdownRef = useRef(null);
  useEffect(() => {
    if (!tabsOpen) return undefined;
    const onDocPointer = (e) => {
      if (!tabsDropdownRef.current?.contains(e.target)) {
        setTabsOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocPointer);
    document.addEventListener('touchstart', onDocPointer);
    return () => {
      document.removeEventListener('mousedown', onDocPointer);
      document.removeEventListener('touchstart', onDocPointer);
    };
  }, [tabsOpen]);
  // Unified pack flow state. ONE modal, THREE stages, all driven by this
  // single object. Shape: { stage, kind, pack, awarded, pending }.
  //   stage    - 'confirm' | 'ready' | 'opened'
  //   kind     - 'skin' | 'capsule'
  //   pack     - the pack def ({ id, name, price, ... })
  //   awarded  - null until the open API returns; then the 3-item array
  //   pending  - true during the open API call (Confirm → Ready transition)
  const [packFlow, setPackFlow] = useState(null);
  // Mobile filter aside is collapsed by default. Desktop CSS hides the
  // toggle button and forces the inner to render regardless of this flag.
  const [filtersOpen, setFiltersOpen] = useState(false);
  // VOLT balance comes from the shared `useVoltBalance` hook so it
  // matches NavShell, the stat editor, and the drone manager exactly.
  // The hook listens on `volts:update` (which every buy handler below
  // already dispatches), polls `/api/volt/balance` for wallet-connected
  // users, and falls back to `user.points` for demo accounts.
  const userPoints = useVoltBalance();
  const [listings, setListings] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [salesPage, setSalesPage] = useState(1);
  const [salesHasMore, setSalesHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({
    minPrice: '',
    maxPrice: '',
    minLevel: '',
    maxLevel: '',
    rarities: [],
    hasSkins: false,
    hasMods: false,
    // 'curated' = preserve server order (image-backed, then by rarity, then
    // newest). The sort comparator at filteredListings only handles
    // priceLow/priceHigh, so any other value falls through and the server
    // order survives - which is exactly what curated needs.
    sort: 'curated',
  });
  const [search, setSearch] = useState('');

  // Modals
  const [buyModal, setBuyModal] = useState(null);
  const [cancelModal, setCancelModal] = useState(null);
  const [cancelPending, setCancelPending] = useState(false);
  // Modify-price form state on the cancel modal. Pre-filled when the
  // modal opens and reset when it closes.
  const [cancelEditPrice, setCancelEditPrice] = useState('');
  const [cancelUpdatePending, setCancelUpdatePending] = useState(false);
  const [cancelUpdateError, setCancelUpdateError] = useState(null);
  const [buyPending, setBuyPending] = useState(false);
  const [buySuccess, setBuySuccess] = useState(null);
  const [buyError, setBuyError] = useState(null);
  const [listModal, setListModal] = useState(false);
  const [listingType, setListingType] = useState('drone');
  const [listingItemId, setListingItemId] = useState('');
  const [listingPrice, setListingPrice] = useState('');
  const [listingPending, setListingPending] = useState(false);
  const [ownedInactive, setOwnedInactive] = useState([]);
  const [ownedSkins, setOwnedSkins] = useState([]);
  const [ownedUnboundMods, setOwnedUnboundMods] = useState([]);

  /* Stable Modal close handler. The Modal primitive's open-state effect
     has `onClose` in its deps and calls `panelRef.current.focus()` every
     time it runs - so an inline `onClose={() => setListModal(false)}`
     creates a fresh function reference on every render, makes the
     effect re-run on every keystroke, and the focus jump kicks the
     user out of the price input mid-typing. `useCallback` with an
     empty dep array gives the Modal a reference-stable handler.
     `setListModal` from `useState` is already stable. */
  const closeListModal = useCallback(() => setListModal(false), []);

  const fetchListings = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        item_type:
          tab === 'drones' ? 'drone' : tab === 'mods' ? 'mod' : 'skin',
        limit: '60',
      });
      if (filters.minPrice) params.set('min_price', filters.minPrice);
      if (filters.maxPrice) params.set('max_price', filters.maxPrice);
      const res = await fetch(`/api/marketplace?${params.toString()}`);
      const body = await res.json();
      if (body?.data) setListings(body.data.items ?? []);
    } finally {
      setLoading(false);
    }
  }, [tab, filters.minPrice, filters.maxPrice]);

  const fetchTransactions = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        item_type:
          tab === 'drones' ? 'drone' : tab === 'mods' ? 'mod' : 'skin',
        status: 'sold',
        limit: '100',
        page: String(salesPage),
      });
      const res = await fetch(`/api/marketplace?${params.toString()}`);
      const body = await res.json();
      if (body?.data) {
        const items = body.data.items ?? [];
        setTransactions(items);
        // Server returns up to `limit` per page; treat a full page as
        // "probably more" so the Next button stays enabled.
        setSalesHasMore(items.length >= 100);
      }
    } catch {
      setTransactions([]);
      setSalesHasMore(false);
    }
  }, [tab, salesPage]);

  const fetchMine = useCallback(async () => {
    if (!user?.id) return;
    try {
      const [drones, skins, mods] = await Promise.all([
        fetch('/api/drones').then((r) => r.json()).catch(() => null),
        fetch('/api/skins').then((r) => r.json()).catch(() => null),
        fetch('/api/mods').then((r) => r.json()).catch(() => null),
      ]);
      if (drones?.data) setOwnedInactive(drones.data.filter((d) => !d.active));
      if (skins?.data) {
        setOwnedSkins(skins.data.filter((s) => !s.boundDroneId));
      }
      if (mods?.data) {
        setOwnedUnboundMods(mods.data.filter((m) => !m.boundDroneId));
      }
    } catch (err) {
      console.error(err);
    }
  }, [user?.id]);

  useEffect(() => { fetchListings(); }, [fetchListings]);
  useEffect(() => { fetchTransactions(); }, [fetchTransactions]);
  useEffect(() => { fetchMine(); }, [fetchMine]);
  // Reset the sales pagination when the user switches tabs so they
  // don't land on a non-existent page for the new item type.
  useEffect(() => { setSalesPage(1); }, [tab]);

  // Pre-fill the cancel modal's modify-price input with the listing's
  // current price each time the modal opens. Reset the in-flight error
  // so a previously failed attempt doesn't carry into a fresh open.
  useEffect(() => {
    if (cancelModal) {
      setCancelEditPrice(String(cancelModal.price ?? ''));
      setCancelUpdateError(null);
    }
  }, [cancelModal]);

  const myActiveListings = useMemo(
    () =>
      listings.filter(
        (l) => l.sellerId === user?.id && l.status === 'active',
      ),
    [listings, user?.id],
  );

  const filteredListings = useMemo(() => {
    let items = view === 'mine' ? [...myActiveListings] : [...listings];

    if (filters.rarities.length > 0 && tab === 'skins') {
      items = items.filter((l) => filters.rarities.includes(l.skin?.rarity));
    }

    if (filters.rarities.length > 0 && tab === 'mods') {
      items = items.filter((l) => filters.rarities.includes(l.mod?.rarity));
    }

    if (tab === 'drones') {
      const min = filters.minLevel ? Number(filters.minLevel) : null;
      const max = filters.maxLevel ? Number(filters.maxLevel) : null;
      if (min != null) items = items.filter((l) => (l.drone?.level ?? 0) >= min);
      if (max != null) items = items.filter((l) => (l.drone?.level ?? 0) <= max);
      if (filters.hasSkins) {
        items = items.filter((l) => (l.drone?.boundSkinCount ?? 0) > 0);
      }
      if (filters.hasMods) {
        items = items.filter((l) => (l.drone?.boundModCount ?? 0) > 0);
      }
    }

    if (search) {
      const q = search.toLowerCase();
      items = items.filter(
        (l) =>
          l.drone?.name?.toLowerCase().includes(q) ||
          l.skin?.name?.toLowerCase().includes(q) ||
          l.mod?.name?.toLowerCase().includes(q) ||
          l.seller?.username?.toLowerCase().includes(q),
      );
    }

    if (filters.sort === 'priceLow') items.sort((a, b) => a.price - b.price);
    else if (filters.sort === 'priceHigh') items.sort((a, b) => b.price - a.price);

    return items;
  }, [listings, myActiveListings, filters, search, tab, view]);

  // Measure the grid width and derive the column count that the CSS
  // would produce at this viewport. Page size then locks to a whole
  // number of rows (cols × ROWS_PER_PAGE) so the last row on every
  // page is always full. Missing slots on the tail page are filled
  // with invisible placeholders (see render) so the pagination
  // buttons sit at the same vertical position across pages.
  const gridRef = useRef(null);
  const [columns, setColumns] = useState(4);
  useEffect(() => {
    const node = gridRef.current;
    if (!node) return;
    const recalc = () => {
      const width = node.clientWidth;
      if (!width) return;
      // Mirrors the CSS: minmax(165px, 1fr) with 8px gap.
      const CARD_MIN = 165;
      const GAP = 8;
      const cols = Math.max(
        1,
        Math.floor((width + GAP) / (CARD_MIN + GAP)),
      );
      setColumns(cols);
    };
    recalc();
    const ro = new ResizeObserver(recalc);
    ro.observe(node);
    return () => ro.disconnect();
  }, [tab, loading]);

  // On narrow viewports (1–2 cols) 3 rows would only show 3–6 listings —
  // pagination kicks in too aggressively. Lock a minimum of 10 listings
  // per page by adding rows when the column count is low.
  const MIN_PAGE_SIZE = 10;
  const BASE_ROWS_PER_PAGE = 3;
  const ROWS_PER_PAGE = Math.max(
    BASE_ROWS_PER_PAGE,
    Math.ceil(MIN_PAGE_SIZE / Math.max(1, columns)),
  );
  const PAGE_SIZE = columns * ROWS_PER_PAGE;

  useEffect(() => {
    setPage(1);
  }, [tab, view, filters, search]);

  const totalPages = Math.max(
    1,
    Math.ceil(filteredListings.length / PAGE_SIZE),
  );
  const safePage = Math.min(page, totalPages);
  const pagedListings = useMemo(
    () =>
      filteredListings.slice(
        (safePage - 1) * PAGE_SIZE,
        safePage * PAGE_SIZE,
      ),
    [filteredListings, safePage, PAGE_SIZE],
  );
  // Invisible slots that pad the last page up to PAGE_SIZE so the grid
  // keeps the same height and the pagination below never jumps.
  const placeholderCount = Math.max(0, PAGE_SIZE - pagedListings.length);

  const closePurchaseModal = () => {
    if (buyPending) return;
    setBuyModal(null);
    setBuyPending(false);
    setBuySuccess(null);
    setBuyError(null);
  };

  const handleBuy = async () => {
    if (!buyModal || buyPending) return;
    setBuyPending(true);
    setBuyError(null);
    try {
      const res = await fetch(`/api/marketplace/${buyModal.id}/buy`, {
        method: 'POST',
      });
      const body = await res.json();
      if (!res.ok) {
        setBuyError(body?.error || 'Purchase failed');
        return;
      }
      const itemName =
        buyModal.drone?.name ??
        buyModal.mod?.name ??
        buyModal.skin?.name ??
        'Item';
      setBuySuccess({ name: itemName });
      // Reflect the post-purchase balance returned by the buy route so the
      // marketplace's volts display updates immediately, AND fire the
      // volts:update event so the NavShell's balance updates too.
      if (typeof body.data?.balance === 'number') {
        // useVoltBalance() in this component AND in NavShell both
        // listen on this event - one dispatch updates every consumer.
        window.dispatchEvent(
          new CustomEvent('volts:update', {
            detail: { balance: body.data.balance },
          }),
        );
      }
      // Refresh listings in the background while the success view holds
      // for ~1.5s, then close the modal cleanly.
      Promise.all([fetchListings(), fetchTransactions(), fetchMine()]).catch(
        () => {},
      );
      setTimeout(() => {
        setBuyModal(null);
        setBuySuccess(null);
      }, 2000);
    } catch (err) {
      setBuyError(String(err));
    } finally {
      setBuyPending(false);
    }
  };

  const handleUpdateListingPrice = async () => {
    if (!cancelModal || cancelUpdatePending) return;
    const num = Number(cancelEditPrice);
    if (!Number.isFinite(num) || !Number.isInteger(num) || num < 10) {
      setCancelUpdateError('Price must be a positive integer of at least 10');
      return;
    }
    setCancelUpdatePending(true);
    setCancelUpdateError(null);
    try {
      const res = await fetch(`/api/marketplace/${cancelModal.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ price: num }),
      });
      const body = await res.json();
      if (!res.ok) {
        setCancelUpdateError(body?.error || 'Failed to update price');
        return;
      }
      setCancelModal(null);
      await fetchListings();
    } catch (err) {
      setCancelUpdateError(String(err));
    } finally {
      setCancelUpdatePending(false);
    }
  };

  const handleCancelConfirm = async () => {
    if (!cancelModal || cancelPending) return;
    setCancelPending(true);
    try {
      const res = await fetch(
        `/api/marketplace/${cancelModal.id}/cancel`,
        { method: 'POST' },
      );
      const body = await res.json();
      if (!res.ok) {
        showToast(body?.error || 'Cancel failed', 'error');
      } else {
        showToast('Listing cancelled', 'success');
        setCancelModal(null);
        await fetchListings();
      }
    } catch (err) {
      showToast(String(err), 'error');
    } finally {
      setCancelPending(false);
    }
  };

  const handleCreateListing = async () => {
    if (!listingItemId || !listingPrice) {
      showToast('Pick an item and set a price', 'error');
      return;
    }
    setListingPending(true);
    try {
      const payload = {
        item_type: listingType,
        price: Number(listingPrice),
      };
      if (listingType === 'drone') payload.drone_id = listingItemId;
      else if (listingType === 'skin') payload.skin_id = listingItemId;
      else payload.mod_id = listingItemId;
      const res = await fetch('/api/marketplace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) {
        showToast(body?.error || 'Listing failed', 'error');
      } else {
        showToast('Item listed for sale', 'success');
        setListModal(false);
        setListingItemId('');
        setListingPrice('');
        await fetchListings();
        await fetchMine();
      }
    } finally {
      setListingPending(false);
    }
  };

  const fee = listingPrice ? Math.floor(Number(listingPrice) * 0.10) : 0;
  const payout = listingPrice ? Number(listingPrice) - fee : 0;


  // Pack flow handlers. ONE modal stays mounted from open → confirm →
  // ready → opened → close; only the inner content re-renders. State
  // transitions all flow through setPackFlow on the single packFlow object.

  const openPackFlow = (kind, pack) => {
    if (!user) {
      showToast('Sign in to buy packs.', 'error');
      return;
    }
    setPackFlow({
      stage: 'confirm',
      kind,
      pack,
      awarded: null,
      pending: false,
    });
  };

  const closePackFlow = () => {
    if (packFlow?.pending) return;
    setPackFlow(null);
  };

  // Confirm Purchase (skin path). Hits the pack-open API; on success
  // transitions stage confirm → ready and stores the awarded items + the
  // post-debit balance for the local override. On failure, surfaces a
  // toast and returns to confirm so the user can retry.
  const confirmSkinPackPurchase = async () => {
    if (!packFlow || packFlow.kind !== 'skin') return;
    setPackFlow((f) => (f ? { ...f, pending: true } : f));
    try {
      const res = await fetch('/api/marketplace/packs/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packType: packFlow.pack.id }),
      });
      const body = await res.json();
      if (!res.ok) {
        showToast(body?.error || 'Pack purchase failed', 'error');
        setPackFlow((f) => (f ? { ...f, pending: false } : f));
        return;
      }
      const awarded = body.data?.awarded ?? [];
      if (typeof body.data?.balance === 'number') {
        // useVoltBalance() in this component AND in NavShell both
        // listen on this event - one dispatch updates every consumer.
        window.dispatchEvent(
          new CustomEvent('volts:update', {
            detail: { balance: body.data.balance },
          }),
        );
      }
      setPackFlow((f) =>
        f ? { ...f, stage: 'ready', awarded, pending: false } : f,
      );
    } catch (err) {
      showToast(String(err), 'error');
      setPackFlow((f) => (f ? { ...f, pending: false } : f));
    }
  };

  // Confirm Purchase (capsule path). Mirrors confirmSkinPackPurchase against
  // /api/marketplace/capsules/open. Pack id carries the `capsule-` prefix;
  // the route accepts it as `capsuleType`.
  const confirmCapsulePackPurchase = async () => {
    if (!packFlow || packFlow.kind !== 'capsule') return;
    setPackFlow((f) => (f ? { ...f, pending: true } : f));
    try {
      const res = await fetch('/api/marketplace/capsules/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ capsuleType: packFlow.pack.id }),
      });
      const body = await res.json();
      if (!res.ok) {
        showToast(body?.error || 'Capsule purchase failed', 'error');
        setPackFlow((f) => (f ? { ...f, pending: false } : f));
        return;
      }
      const awarded = body.data?.awarded ?? [];
      if (typeof body.data?.balance === 'number') {
        // useVoltBalance() in this component AND in NavShell both
        // listen on this event - one dispatch updates every consumer.
        window.dispatchEvent(
          new CustomEvent('volts:update', {
            detail: { balance: body.data.balance },
          }),
        );
      }
      setPackFlow((f) =>
        f ? { ...f, stage: 'ready', awarded, pending: false } : f,
      );
    } catch (err) {
      showToast(String(err), 'error');
      setPackFlow((f) => (f ? { ...f, pending: false } : f));
    }
  };

  // Stage 2 → 3. Animation timing lives in CSS keyframes; React just
  // flips the stage and the .flowSlot child swap drives the visuals.
  const handleOpenPack = () => {
    setPackFlow((f) => (f && f.stage === 'ready' ? { ...f, stage: 'opened' } : f));
  };

  // Stage 3 only. Closes the modal and routes the user to /drones.
  const handleEquip = () => {
    setPackFlow(null);
    router.push('/drones');
  };

  return (
    <NavShell>
      <div className={styles.page}>
        {/* ---- Top row: tabs + list-item (left), balance (right).
                Three direct flex children so mobile CSS can grid-reflow
                them to (tabs full-width row) / (list-item + balance row)
                without restructuring the DOM per breakpoint.
                A custom dropdown is rendered alongside the pill bar
                and swapped in via CSS at <=440px so the smallest
                viewports trade horizontal space for a tappable popover
                with marketplace-styled option rows + radio circles
                (the prior native <select> couldn't be styled this way
                across mobile browsers). */}
        <div className={styles.topRow}>
          <div ref={tabsDropdownRef} className={styles.tabsDropdown}>
            <button
              type="button"
              className={styles.tabsDropdownTrigger}
              onClick={() => setTabsOpen((o) => !o)}
              aria-expanded={tabsOpen}
              aria-haspopup="listbox"
              aria-label="Marketplace section"
            >
              {tab === 'drones'
                ? 'Drones'
                : tab === 'mods'
                  ? 'Mods'
                  : tab === 'skins'
                    ? 'Skins'
                    : tab === 'packs'
                      ? 'Packs'
                      : 'Volts'}
              <ChevronDown size={12} aria-hidden="true" />
            </button>
            {tabsOpen && (
              <div className={styles.tabsDropdownMenu} role="listbox">
                {[
                  ['drones', 'Drones'],
                  ['mods', 'Mods'],
                  ['skins', 'Skins'],
                  ['packs', 'Packs'],
                  ['points', 'Volts'],
                ].map(([value, label]) => {
                  const selected = tab === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className={cn(
                        styles.tabsDropdownOption,
                        selected && styles.tabsDropdownOptionActive,
                      )}
                      onClick={() => {
                        setTab(value);
                        setTabsOpen(false);
                      }}
                    >
                      <span
                        className={cn(
                          styles.tabsDropdownRadio,
                          selected && styles.tabsDropdownRadioActive,
                        )}
                        aria-hidden="true"
                      />
                      {label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <div className={styles.tabs} role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'drones'}
              className={cn(styles.tab, tab === 'drones' && styles.tabActive)}
              onClick={() => setTab('drones')}
            >
              Drones
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'mods'}
              className={cn(styles.tab, tab === 'mods' && styles.tabActive)}
              onClick={() => setTab('mods')}
            >
              Mods
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'skins'}
              className={cn(styles.tab, tab === 'skins' && styles.tabActive)}
              onClick={() => setTab('skins')}
            >
              Skins
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'packs'}
              className={cn(styles.tab, tab === 'packs' && styles.tabActive)}
              onClick={() => setTab('packs')}
            >
              Packs
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'points'}
              className={cn(styles.tab, tab === 'points' && styles.tabActive)}
              onClick={() => setTab('points')}
            >
              Volts
            </button>
          </div>
          <Button
            variant="primary"
            size="sm"
            className={styles.listItemBtn}
            onClick={() => setListModal(true)}
          >
            <Plus size={10} aria-hidden="true" /> List Item
          </Button>
          <div className={styles.balance}>
            <span className={styles.balanceLabel}>Your Balance</span>
            <span className={styles.balanceDot} aria-hidden="true">
              ·
            </span>
            <span className={styles.balanceValueWrap}>
              <VoltIcon size={13} />
              <span className={styles.balanceValue}>
                {userPoints.toLocaleString()}
              </span>
            </span>
          </div>
        </div>

        {/* ---- Sub-toolbar: view toggle + search (hidden on Packs/Points tabs) ---- */}
        {tab !== 'packs' && tab !== 'points' && (
        <div className={styles.subToolbar}>
          <div className={styles.viewToggle} role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={view === 'all'}
              className={cn(
                styles.viewTab,
                view === 'all' && styles.viewTabActive,
              )}
              onClick={() => setView('all')}
            >
              All Listings
            </button>
            {user && (
              <button
                type="button"
                role="tab"
                aria-selected={view === 'mine'}
                className={cn(
                  styles.viewTab,
                  view === 'mine' && styles.viewTabActive,
                )}
                onClick={() => setView('mine')}
              >
                Your Listings<span className={styles.viewTabCount}>({myActiveListings.length})</span>
              </button>
            )}
          </div>
          <div className={styles.searchWrap}>
            <Search
              size={13}
              className={styles.searchIcon}
              aria-hidden="true"
            />
            <input
              type="search"
              className={styles.searchInput}
              placeholder="Search listings..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        )}

        {/* ---- Main layout: sticky filter rail + grid / packs showcase ---- */}
        <div
          className={cn(
            styles.body,
            (tab === 'packs' || tab === 'points') && styles.bodyPacks,
          )}
        >
          {tab !== 'packs' && tab !== 'points' && (
          <aside
            className={cn(
              styles.filters,
              !filtersOpen && styles.filtersCollapsed,
            )}
          >
            {/* Mobile-only collapse trigger. Desktop CSS hides it via
                display: none and forces .filtersInner to render regardless
                of the .filtersCollapsed class. */}
            <button
              type="button"
              className={styles.filtersToggle}
              onClick={() => setFiltersOpen((o) => !o)}
              aria-expanded={filtersOpen}
              aria-controls="marketplace-filters-body"
            >
              <span>Filters</span>
              <ChevronDown
                size={14}
                aria-hidden="true"
                className={cn(
                  styles.filtersToggleIcon,
                  filtersOpen && styles.filtersToggleIconOpen,
                )}
              />
            </button>
            <div
              id="marketplace-filters-body"
              className={styles.filtersInner}
            >
              <div className={styles.filterBody}>
                <div className={styles.filterGroup}>
                  <label className={styles.filterLabel}>Price (volts)</label>
                  <div className={styles.rangeRow}>
                    <input
                      type="number"
                      inputMode="numeric"
                      className={styles.rangeInput}
                      placeholder="Min"
                      value={filters.minPrice}
                      onChange={(e) =>
                        setFilters((f) => ({ ...f, minPrice: e.target.value }))
                      }
                    />
                    <span className={styles.rangeDash} aria-hidden="true">
                      -
                    </span>
                    <input
                      type="number"
                      inputMode="numeric"
                      className={styles.rangeInput}
                      placeholder="Max"
                      value={filters.maxPrice}
                      onChange={(e) =>
                        setFilters((f) => ({ ...f, maxPrice: e.target.value }))
                      }
                    />
                  </div>
                </div>

                {tab === 'drones' && (
                  <div className={styles.filterGroup}>
                    <label className={styles.filterLabel}>Level</label>
                    <div className={styles.rangeRow}>
                      <input
                        type="number"
                        inputMode="numeric"
                        className={styles.rangeInput}
                        placeholder="Min"
                        value={filters.minLevel}
                        onChange={(e) =>
                          setFilters((f) => ({
                            ...f,
                            minLevel: e.target.value,
                          }))
                        }
                      />
                      <span className={styles.rangeDash} aria-hidden="true">
                        -
                      </span>
                      <input
                        type="number"
                        inputMode="numeric"
                        className={styles.rangeInput}
                        placeholder="Max"
                        value={filters.maxLevel}
                        onChange={(e) =>
                          setFilters((f) => ({
                            ...f,
                            maxLevel: e.target.value,
                          }))
                        }
                      />
                    </div>
                  </div>
                )}

                {tab === 'drones' && (
                  <div className={styles.filterGroup}>
                    <label className={styles.filterLabel}>Includes</label>
                    <div className={styles.checkList}>
                      <label className={styles.check}>
                        <input
                          type="checkbox"
                          checked={filters.hasSkins}
                          onChange={(e) =>
                            setFilters((f) => ({
                              ...f,
                              hasSkins: e.target.checked,
                            }))
                          }
                        />
                        <span className={styles.checkText}>Skins</span>
                      </label>
                      <label className={styles.check}>
                        <input
                          type="checkbox"
                          checked={filters.hasMods}
                          onChange={(e) =>
                            setFilters((f) => ({
                              ...f,
                              hasMods: e.target.checked,
                            }))
                          }
                        />
                        <span className={styles.checkText}>Mods</span>
                      </label>
                    </div>
                  </div>
                )}

                {(tab === 'skins' || tab === 'mods') && (
                  <div className={styles.filterGroup}>
                    <label className={styles.filterLabel}>Rarity</label>
                    <div className={styles.checkList}>
                      {RARITY_LIST.map((r) => (
                        <label key={r} className={styles.check}>
                          <input
                            type="checkbox"
                            checked={filters.rarities.includes(r)}
                            onChange={(e) =>
                              setFilters((f) => ({
                                ...f,
                                rarities: e.target.checked
                                  ? [...f.rarities, r]
                                  : f.rarities.filter((x) => x !== r),
                              }))
                            }
                          />
                          <span
                            className={cn(
                              styles.checkText,
                              styles[`rarity_${r}`],
                            )}
                          >
                            {RARITY_LABELS[r]}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                <div className={styles.filterGroup}>
                  <label className={styles.filterLabel}>Sort By</label>
                  <select
                    className={styles.select}
                    value={filters.sort}
                    onChange={(e) =>
                      setFilters((f) => ({ ...f, sort: e.target.value }))
                    }
                  >
                    <option value="curated">Featured</option>
                    <option value="rarity">Rarity</option>
                    <option value="newest">Newest</option>
                    <option value="priceLow">Price: Low to High</option>
                    <option value="priceHigh">Price: High to Low</option>
                  </select>
                </div>

                <button
                  type="button"
                  className={styles.clearBtn}
                  onClick={() =>
                    setFilters({
                      minPrice: '',
                      maxPrice: '',
                      minLevel: '',
                      maxLevel: '',
                      rarities: [],
                      hasSkins: false,
                      hasMods: false,
                      sort: 'curated',
                    })
                  }
                >
                  Clear Filters
                </button>
              </div>
            </div>
          </aside>
          )}

          <div className={styles.content}>
            {tab === 'points' ? (
              <PointsShowcase />
            ) : tab === 'packs' ? (
              <PacksShowcase
                userPoints={userPoints}
                openingId={packFlow?.pending ? packFlow.pack.id : null}
                onOpen={(packId) =>
                  openPackFlow(
                    'skin',
                    PACK_DEFS.find((p) => p.id === packId),
                  )
                }
                onOpenCapsule={(pack) => openPackFlow('capsule', pack)}
              />
            ) : loading ? (
              <div className={styles.loadingCenter}>
                <Spinner size="lg" label="Loading listings" />
              </div>
            ) : filteredListings.length === 0 ? (
              <EmptyState
                title={
                  view === 'mine'
                    ? 'You have no active listings'
                    : 'No listings match these filters'
                }
                description={
                  view === 'mine'
                    ? 'Use "List Item" above to put a drone or skin on the market.'
                    : 'Try adjusting your filters or check back later.'
                }
              />
            ) : (
              <>
                <div
                  ref={gridRef}
                  className={styles.grid}
                  style={{
                    gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                  }}
                >
                  {pagedListings.map((listing) => {
                    const card = (
                      <ListingCard
                        listing={listing}
                        isOwner={listing.sellerId === user?.id}
                        canAfford={userPoints >= listing.price}
                        pointsShort={Math.max(0, listing.price - userPoints)}
                        onBuy={() => setBuyModal(listing)}
                        onCancel={() => setCancelModal(listing)}
                      />
                    );
                    // Every card type opens its own modal on click; drone
                    // cards no longer navigate. The "View drone details"
                    // link inside the purchase modal handles the nav case.
                    return (
                      <div key={listing.id} className={styles.cardWrap}>
                        {card}
                      </div>
                    );
                  })}
                  {/* Invisible spacers fill partial last rows so the grid
                      height stays constant and the pagination below
                      never jumps up. aria-hidden keeps screen readers
                      focused on real listings only. */}
                  {Array.from({ length: placeholderCount }).map((_, i) => (
                    <div
                      key={`ph-${i}`}
                      className={styles.cardPlaceholder}
                      aria-hidden="true"
                    />
                  ))}
                </div>
                {totalPages > 1 && (
                  <Pagination
                    page={safePage}
                    totalPages={totalPages}
                    onPageChange={setPage}
                  />
                )}
              </>
            )}
          </div>
        </div>

        {/* ---- Recent sales tape (always expanded). A compact activity
             feed rather than a table - sits below the grid as a market
             pulse section. Hidden on the Packs and Points tabs. ---- */}
        {tab !== 'packs' && tab !== 'points' && (
          <SalesTape
            transactions={transactions}
            page={salesPage}
            hasMore={salesHasMore}
            onPrev={() => setSalesPage((p) => Math.max(1, p - 1))}
            onNext={() => setSalesPage((p) => p + 1)}
          />
        )}
      </div>

      {/* ---- Purchase confirmation modal (drones / mods / skins) ---- */}
      <Modal
        isOpen={!!buyModal}
        onClose={closePurchaseModal}
        chromeless
        className={styles.purchaseModal}
        overlayClassName={styles.purchaseOverlay}
      >
        {buyModal && (
          <PurchaseModalBody
            listing={buyModal}
            userPoints={userPoints}
            pending={buyPending}
            success={buySuccess}
            error={buyError}
            onConfirm={handleBuy}
            onClose={closePurchaseModal}
          />
        )}
      </Modal>

      {/* ---- Cancel-listing confirmation modal ---- */}
      <Modal
        isOpen={!!cancelModal}
        onClose={() => {
          if (!cancelPending && !cancelUpdatePending) setCancelModal(null);
        }}
        chromeless
        className={styles.purchaseModal}
        overlayClassName={styles.purchaseOverlay}
      >
        {cancelModal && (
          <CancelModalBody
            listing={cancelModal}
            pending={cancelPending}
            onConfirm={handleCancelConfirm}
            onClose={() => setCancelModal(null)}
            editPrice={cancelEditPrice}
            onEditPriceChange={setCancelEditPrice}
            onUpdatePrice={handleUpdateListingPrice}
            updatePending={cancelUpdatePending}
            updateError={cancelUpdateError}
          />
        )}
      </Modal>

      {/* ---- List modal ---- */}
      <Modal
        isOpen={listModal}
        onClose={closeListModal}
        size="md"
        chromeless
        className={styles.listModal}
      >
        <div className={styles.listFormHeader}>
          <h2 className={styles.listFormTitle}>List Item for Sale</h2>
          <button
            type="button"
            className={styles.listFormClose}
            onClick={() => setListModal(false)}
            aria-label="Close dialog"
          >
            <X size={18} />
          </button>
        </div>

        <div className={styles.listFormBody}>
          <div className={styles.listFormRow}>
            <div className={styles.typeToggle}>
              <button
                type="button"
                className={cn(
                  styles.typeBtn,
                  listingType === 'drone' && styles.typeBtnActive,
                )}
                onClick={() => {
                  setListingType('drone');
                  setListingItemId('');
                }}
              >
                Drone
              </button>
              <button
                type="button"
                className={cn(
                  styles.typeBtn,
                  listingType === 'skin' && styles.typeBtnActive,
                )}
                onClick={() => {
                  setListingType('skin');
                  setListingItemId('');
                }}
              >
                Skin
              </button>
              <button
                type="button"
                className={cn(
                  styles.typeBtn,
                  listingType === 'mod' && styles.typeBtnActive,
                )}
                onClick={() => {
                  setListingType('mod');
                  setListingItemId('');
                }}
              >
                Mod
              </button>
            </div>
          </div>

          <div className={styles.listFormRow}>
            <label className={styles.listFormPickerLabel}>
              {listingType === 'drone' ? 'Choose drone' : listingType === 'skin' ? 'Choose skin' : 'Choose mod'}
              <span className={styles.listFormPickerLabelHint}>
                {listingType === 'drone' ? '(must be inactive)' : '(unbound only)'}
              </span>
            </label>
            <ListingItemPicker
              kind={listingType}
              items={
                listingType === 'drone'
                  ? ownedInactive
                  : listingType === 'skin'
                    ? ownedSkins
                    : ownedUnboundMods
              }
              selectedId={listingItemId}
              onSelect={setListingItemId}
            />
          </div>

          <div className={styles.listFormRow}>
            <label className={styles.listFormLabel}>Price (volts)</label>
            <input
              type="number"
              inputMode="numeric"
              className={styles.listFormInput}
              placeholder="1000"
              value={listingPrice}
              onChange={(e) => setListingPrice(e.target.value)}
            />
            <div className={styles.listFormFee}>
              Platform fee:{' '}
              <strong>
                10% (<VoltIcon size={11} />
                {fee})
              </strong>{' '}
              · You receive:{' '}
              <strong>
                <VoltIcon size={11} />
                {payout}
              </strong>
            </div>
          </div>

          <div className={styles.listFormActions}>
            <Button
              variant="secondary"
              onClick={() => setListModal(false)}
              className={styles.listFormActionBtn}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleCreateListing}
              loading={listingPending}
              className={styles.listFormActionBtn}
            >
              List for Sale
            </Button>
          </div>

          <div className={styles.listFormFooter}>
            <Link href="/guide" className={styles.listFormLink}>
              Learn more in the Guide
            </Link>
            <span className={styles.listFormFooterDot}>·</span>
            <Link href="/faq" className={styles.listFormLink}>
              Read the FAQ
            </Link>
          </div>
        </div>
      </Modal>

      {/* ---- Pack flow modal: confirm purchase → ready to open → opened.
              ONE Modal shell stays mounted across all three stages. The
              modal never unmounts/remounts. Only <PackFlowModalBody>
              re-renders, switching its inner content slot on packFlow.stage. */}
      <Modal
        isOpen={!!packFlow}
        onClose={closePackFlow}
        chromeless
        className={styles.flowModal}
        overlayClassName={styles.purchaseOverlay}
      >
        {packFlow && (
          <PackFlowModalBody
            flow={packFlow}
            onConfirm={
              packFlow.kind === 'skin'
                ? confirmSkinPackPurchase
                : confirmCapsulePackPurchase
            }
            onOpen={handleOpenPack}
            onEquip={handleEquip}
            onClose={closePackFlow}
          />
        )}
      </Modal>
    </NavShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Numbered pagination (1 2 3 … >). Mirrors the pattern on the races page. */
/* -------------------------------------------------------------------------- */

function Pagination({ page, totalPages, onPageChange }) {
  const pages = getVisiblePages(page, totalPages);
  return (
    <nav className={styles.pagination} aria-label="Pagination">
      {pages.map((p, i) =>
        p === '...' ? (
          <span key={`ell-${i}`} className={styles.pageEllipsis}>
            …
          </span>
        ) : (
          <button
            key={p}
            type="button"
            className={cn(styles.pageNum, p === page && styles.pageNumActive)}
            onClick={() => onPageChange(p)}
            aria-current={p === page ? 'page' : undefined}
          >
            {p}
          </button>
        ),
      )}
      <button
        type="button"
        className={styles.pageNext}
        disabled={page >= totalPages}
        onClick={() => onPageChange(Math.min(totalPages, page + 1))}
        aria-label="Next page"
      >
        <ChevronRight size={14} />
      </button>
    </nav>
  );
}

function getVisiblePages(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = [1];
  if (current > 3) pages.push('...');
  const lo = Math.max(2, current - 1);
  const hi = Math.min(total - 1, current + 1);
  for (let i = lo; i <= hi; i++) pages.push(i);
  if (current < total - 2) pages.push('...');
  pages.push(total);
  return pages;
}

/* -------------------------------------------------------------------------- */
/* Recent sales tape - compact activity feed replacing the old DataTable.     */
/* Reads as a market pulse: type pill + item name · time · seller → price.    */
/* -------------------------------------------------------------------------- */

/* Sort keys map 1:1 to the column labels in the tape header. Each
   resolver pulls the raw value out of a transaction; rarity is mapped
   through TAPE_RARITY_RANK so the sort follows tier order, not
   alphabetical. The comparator below normalises strings (case-fold)
   and treats nulls as the "low" end on either direction. */
const TAPE_RARITY_RANK = { common: 1, rare: 2, epic: 3, legendary: 4 };

const TAPE_SORT_GETTERS = {
  type: (t) => t.itemType ?? '',
  item: (t) =>
    (t.drone?.name ?? t.skin?.name ?? t.mod?.name ?? '').toLowerCase(),
  rarity: (t) =>
    TAPE_RARITY_RANK[
      t.skin?.rarity ??
        t.mod?.rarity ??
        t.drone?.appliedSkin?.rarity ??
        droneLevelRarity(t.drone?.level)
    ] ?? 0,
  seller: (t) => (t.seller?.username ?? '').toLowerCase(),
  buyer: (t) => (t.buyer?.username ?? '').toLowerCase(),
  time: (t) => {
    const v = t.soldAt ?? t.createdAt;
    return v ? new Date(v).getTime() : 0;
  },
  price: (t) => Number(t.price) || 0,
};

function SalesTape({ transactions, page, hasMore, onPrev, onNext }) {
  // Default sort: most-recent sale first. Clicking the active column's
  // header toggles dir; clicking a different column switches to it
  // (initial dir picked per column type — string cols start asc to
  // read alphabetically, numeric/time cols start desc to surface the
  // big values / latest entries first).
  const [sort, setSort] = useState({ key: 'time', dir: 'desc' });

  const handleSortClick = useCallback((key) => {
    setSort((s) => {
      if (s.key === key) {
        return { key, dir: s.dir === 'asc' ? 'desc' : 'asc' };
      }
      const numericOrTime = key === 'price' || key === 'time' || key === 'rarity';
      return { key, dir: numericOrTime ? 'desc' : 'asc' };
    });
  }, []);

  const sortedTransactions = useMemo(() => {
    const getter = TAPE_SORT_GETTERS[sort.key] ?? TAPE_SORT_GETTERS.time;
    const mult = sort.dir === 'asc' ? 1 : -1;
    const priceGetter = TAPE_SORT_GETTERS.price;
    // Ties fall back to price desc so equal-on-primary rows surface
    // the bigger sale first. Skipped when price IS the primary sort
    // (tied prices have nothing to disambiguate).
    return [...transactions].sort((a, b) => {
      const av = getter(a);
      const bv = getter(b);
      if (av < bv) return -1 * mult;
      if (av > bv) return 1 * mult;
      if (sort.key === 'price') return 0;
      return priceGetter(b) - priceGetter(a);
    });
  }, [transactions, sort.key, sort.dir]);

  const stats = useMemo(() => {
    const count = transactions.length;
    if (!count) return { count: 0, volume: 0, avg: 0 };
    const volume = transactions.reduce(
      (sum, t) => sum + Number(t.price || 0),
      0,
    );
    return { count, volume, avg: Math.round(volume / count) };
  }, [transactions]);

  return (
    <section className={styles.tapeSection}>
      <header className={styles.tapeHeader}>
        <div className={styles.tapeTitleBlock}>
          <span className={styles.tapeDot} aria-hidden="true" />
          <h2 className={styles.tapeTitle}>Recent Sales</h2>
        </div>
        <div className={styles.tapeStats}>
          <span className={styles.tapeStat}>
            <span className={styles.tapeStatValue}>{stats.count}</span>
            <span className={styles.tapeStatLabel}>sales</span>
          </span>
          <span className={styles.tapeStatSep} aria-hidden="true" />
          <span className={styles.tapeStat}>
            <span className={styles.tapeStatValue}>
              {stats.volume.toLocaleString()}
            </span>
            <span className={styles.tapeStatLabel}>volume</span>
          </span>
          <span className={styles.tapeStatSep} aria-hidden="true" />
          <span className={styles.tapeStat}>
            <span className={styles.tapeStatValue}>
              {stats.avg.toLocaleString()}
            </span>
            <span className={styles.tapeStatLabel}>avg</span>
          </span>
        </div>
      </header>

      {transactions.length === 0 ? (
        <div className={styles.tapeEmpty}>
          {page > 1 ? 'No more completed sales.' : 'No completed sales yet.'}
        </div>
      ) : (
        <>
          <div className={styles.tapeHeaderRow} role="row">
            <SortLabel sort={sort} colKey="type" onClick={handleSortClick}>
              Type
            </SortLabel>
            <SortLabel sort={sort} colKey="item" onClick={handleSortClick}>
              Item
            </SortLabel>
            <SortLabel sort={sort} colKey="rarity" onClick={handleSortClick}>
              Rarity
            </SortLabel>
            <SortLabel sort={sort} colKey="seller" onClick={handleSortClick}>
              Seller
            </SortLabel>
            <SortLabel sort={sort} colKey="buyer" onClick={handleSortClick}>
              Buyer
            </SortLabel>
            <SortLabel sort={sort} colKey="time" onClick={handleSortClick}>
              Time
            </SortLabel>
            <SortLabel
              sort={sort}
              colKey="price"
              onClick={handleSortClick}
              alignEnd
            >
              Price
            </SortLabel>
          </div>
          <ul className={styles.tapeList}>
            {sortedTransactions.map((t) => {
              const name =
                t.drone?.name ??
                t.skin?.name ??
                t.mod?.name ??
                (t.itemType === 'drone'
                  ? 'Drone'
                  : t.itemType === 'mod'
                    ? 'Mod'
                    : 'Skin');
              const rarity =
                t.itemType === 'skin'
                  ? t.skin?.rarity
                  : t.itemType === 'mod'
                    ? t.mod?.rarity
                    : t.drone?.appliedSkin?.rarity ??
                      droneLevelRarity(t.drone?.level);
              const sellerName = t.seller?.username ?? '-';
              const buyerName = t.buyer?.username ?? '-';
              const when = formatRelativeTime(t.soldAt ?? t.createdAt);
              return (
                <li key={t.id} className={styles.tapeRow}>
                  <span
                    className={cn(
                      styles.tapeTypePill,
                      rarity && styles[`rarity_${rarity}`],
                      t.itemType === 'drone' && styles.tapePillDrone,
                    )}
                  >
                    {t.itemType}
                  </span>
                  <span className={styles.tapeName}>{name}</span>
                  <span
                    className={cn(
                      styles.tapeRarity,
                      rarity && styles[`tapeRarity_${rarity}`],
                    )}
                  >
                    {rarity ?? '-'}
                  </span>
                  <span className={styles.tapeSeller}>{sellerName}</span>
                  <span className={styles.tapeBuyer}>{buyerName}</span>
                  <span className={styles.tapeWhen}>{when}</span>
                  <span className={styles.tapePrice}>
                    <VoltIcon size={10} />
                    {Number(t.price).toLocaleString()}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {(page > 1 || hasMore || transactions.length > 0) && (
        <div className={styles.tapePagination}>
          <button
            type="button"
            className={styles.tapePageBtn}
            onClick={onPrev}
            disabled={page <= 1}
          >
            Previous
          </button>
          <span className={styles.tapePageLabel}>Page {page}</span>
          <button
            type="button"
            className={styles.tapePageBtn}
            onClick={onNext}
            disabled={!hasMore}
          >
            Next
          </button>
        </div>
      )}
    </section>
  );
}

/* Sortable header cell for the SalesTape. Renders the column label as a
   <button> so the click target inherits the proper a11y semantics; the
   currently active column shows a chevron in its sort direction. */
function SortLabel({ sort, colKey, onClick, alignEnd, children }) {
  const isActive = sort.key === colKey;
  return (
    <button
      type="button"
      onClick={() => onClick(colKey)}
      className={cn(
        styles.tapeColLabel,
        styles.tapeColLabelBtn,
        isActive && styles.tapeColLabelActive,
        alignEnd && styles.tapeColLabelEnd,
      )}
      aria-sort={
        isActive
          ? sort.dir === 'asc'
            ? 'ascending'
            : 'descending'
          : 'none'
      }
    >
      <span>{children}</span>
      {isActive && (
        sort.dir === 'asc' ? (
          <ChevronUp size={9} aria-hidden="true" />
        ) : (
          <ChevronDown size={9} aria-hidden="true" />
        )
      )}
    </button>
  );
}

function formatRelativeTime(iso) {
  if (!iso) return '-';
  const then = new Date(iso);
  const diffMs = Date.now() - then.getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return then.toLocaleDateString();
}

/* Drone listings don't carry an intrinsic rarity in the schema (only
   skins + mods do). For the Recent Sales rarity column, fall back to
   the drone's level-tier band when no applied skin is present. Mirrors
   the PRICE_TIERS bands used elsewhere (T1-T4 -> common/rare/epic/legendary). */
function droneLevelRarity(level) {
  if (level == null) return null;
  if (level >= 16) return 'legendary';
  if (level >= 11) return 'epic';
  if (level >= 6) return 'rare';
  if (level >= 1) return 'common';
  return null;
}

/* -------------------------------------------------------------------------- */
/* Packs showcase - hero Legendary, medium Premium, compact Starter.           */
/*                                                                             */
/* Every card: left column has title + price + description + odds text +       */
/* "What's Inside" expander. Right column has 3 card silhouettes whose glows   */
/* reflect each slot's guaranteed rarity (mystery slots get a shifting glow    */
/* + "?"). Buy button spans the card width at the bottom.                      */
/* -------------------------------------------------------------------------- */

function PacksShowcase({ userPoints, openingId, onOpen, onOpenCapsule }) {
  // 'skins' (default) renders the existing skin pack lineup;
  // 'capsules' swaps to the mod (capsule) pack lineup. Display-only
  // toggle - both sets read from their own defs and rendering paths.
  const [packsView, setPacksView] = useState('skins');

  const legendary = PACK_DEFS.find((p) => p.id === 'legendary');
  const premium = PACK_DEFS.find((p) => p.id === 'premium');
  const starter = PACK_DEFS.find((p) => p.id === 'starter');

  const capsuleLegendary = CAPSULE_PACK_DEFS.find(
    (p) => p.id === 'capsule-legendary',
  );
  const capsulePremium = CAPSULE_PACK_DEFS.find(
    (p) => p.id === 'capsule-premium',
  );
  const capsuleStarter = CAPSULE_PACK_DEFS.find(
    (p) => p.id === 'capsule-starter',
  );

  // Fetch the image-backed skin catalog once on mount; group by rarity
  // and feed it to each pack's preview row. Catalog excludes the legacy
  // placeholder rows (their image_url doesn't point to a real /skins/...
  // .webp), so what the user sees here matches what packs can actually
  // drop.
  const [skinPool, setSkinPool] = useState({});

  useEffect(() => {
    let cancelled = false;
    fetch('/api/skins/catalog')
      .then((r) => r.json())
      .then((body) => {
        if (cancelled || !body?.data) return;
        // The catalog returns every image-backed skin row, including the
        // multiple vault-stock duplicates per name (15+ rows per legendary
        // by the seed's design). Dedupe by name within each rarity so the
        // preview pool has each distinct skin once - otherwise the cursor
        // walk in pickPreviewSamples can land on the same name twice when
        // a single name appears multiple times early in the shuffle.
        const grouped = {};
        const seenByRarity = {};
        for (const skin of body.data) {
          if (!grouped[skin.rarity]) {
            grouped[skin.rarity] = [];
            seenByRarity[skin.rarity] = new Set();
          }
          if (seenByRarity[skin.rarity].has(skin.name)) continue;
          seenByRarity[skin.rarity].add(skin.name);
          grouped[skin.rarity].push(skin);
        }
        setSkinPool(grouped);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const previews = useMemo(
    () => ({
      starter: pickPreviewSamples('starter', skinPool),
      premium: pickPreviewSamples('premium', skinPool),
      legendary: pickPreviewSamples('legendary', skinPool),
    }),
    [skinPool],
  );

  const packProps = (pack) => ({
    pack: { ...pack, possible: previews[pack.id] ?? [] },
    canAfford: userPoints >= pack.price,
    pointsShort: Math.max(0, pack.price - userPoints),
    isOpening: openingId === pack.id,
    onOpen: () => onOpen(pack.id),
  });

  return (
    <div className={styles.packsShowcase}>
      <div className={styles.packsViewToggle} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={packsView === 'skins'}
          className={cn(
            styles.packsViewWord,
            packsView === 'skins' && styles.packsViewWordActive,
          )}
          onClick={() => setPacksView('skins')}
        >
          Skins
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={packsView === 'capsules'}
          className={cn(
            styles.packsViewWord,
            packsView === 'capsules' && styles.packsViewWordActive,
          )}
          onClick={() => setPacksView('capsules')}
        >
          Mods
        </button>
      </div>
      <LiveTicker />
      {packsView === 'skins' ? (
        <>
          <LegendaryHero {...packProps(legendary)} />
          <div className={styles.packsRow}>
            <PackCard {...packProps(premium)} />
            <PackCard {...packProps(starter)} />
          </div>
        </>
      ) : (
        <>
          <CapsuleHero pack={capsuleLegendary} onOpen={onOpenCapsule} />
          <div className={styles.packsRow}>
            <CapsuleCard pack={capsulePremium} onOpen={onOpenCapsule} />
            <CapsuleCard pack={capsuleStarter} onOpen={onOpenCapsule} />
          </div>
        </>
      )}
    </div>
  );
}

/* Thin activity strip at the top - LIVE dot + packs-opened-today + latest
   legendary pull. Hardcoded for now; wire to real data later. */
function LiveTicker() {
  const t = LIVE_TICKER;
  return (
    <div className={styles.ticker} role="status" aria-live="polite">
      <span className={styles.tickerLive}>
        <span className={styles.tickerDot} aria-hidden="true" />
        Live
      </span>
      <span className={styles.tickerMetric}>
        <strong>{t.packsOpenedToday.toLocaleString()}</strong> packs opened today
      </span>
      <span className={styles.tickerSep} aria-hidden="true" />
      <span className={styles.tickerPull}>
        <strong className={styles.tickerUser}>{t.lastPull.username}</strong>
        <span className={styles.tickerPullText}> pulled </span>
        <span
          className={cn(
            styles.tickerPullRarity,
            styles[`rarity_${t.lastPull.rarity}`],
          )}
        >
          Legendary: {t.lastPull.name}
        </span>
      </span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* GET POINTS tab - 6-card grid for purchasing points with $TOKEN.            */
/* -------------------------------------------------------------------------- */

function PointsShowcase() {
  const [voltsModal, setVoltsModal] = useState(null);
  return (
    <>
      <div className={styles.pointsShowcase}>
        <div className={styles.pointsHeader}>
          <h2 className={styles.pointsTitle}>GET VOLTS</h2>
          <p className={styles.pointsSubtitle}>Better value the more you buy</p>
        </div>
        <div className={styles.pointsGrid}>
          {POINTS_OPTIONS.map((opt) => (
            <PointsCard
              key={opt.id}
              opt={opt}
              onSelect={() => setVoltsModal(opt)}
            />
          ))}
        </div>
      </div>

      <Modal
        isOpen={!!voltsModal}
        onClose={() => setVoltsModal(null)}
        chromeless
        className={styles.voltsModal}
        overlayClassName={styles.voltsOverlay}
      >
        {voltsModal && (
          <VoltsModalBody
            opt={voltsModal}
            onClose={() => setVoltsModal(null)}
          />
        )}
      </Modal>
    </>
  );
}

function PointsCard({ opt, onSelect }) {
  const handleClick = (e) => {
    if (e.target.closest('[data-stop-card-click]')) return;
    onSelect();
  };
  return (
    <article
      className={styles.pointsCard}
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      aria-label={`Buy ${opt.points.toLocaleString()} volts for ${opt.price.toLocaleString()} TOKEN`}
    >
      {/* Fixed-height pill area so the chest below sits at the same
          vertical position whether the card has 0, 1, or 2 pills.
          Pills cluster at the BOTTOM of the area (justify-content:
          flex-end), so absent pills become empty space above. */}
      <div className={styles.pointsPillsArea}>
        {opt.bestValue && (
          <span className={styles.pointsBestValuePill}>BEST VALUE</span>
        )}
        {opt.bonus && (
          <span
            className={cn(
              styles.pointsBonusPill,
              styles[`pointsBonusPill_${opt.tier}`],
            )}
          >
            {opt.bonus}
          </span>
        )}
      </div>
      <div
        className={cn(
          styles.chestFrame,
          styles[`chestFrame_${opt.tier}`],
          opt.bestValue && styles.chestFrameBestValue,
        )}
      >
        <img
          src={opt.chest}
          alt={`${opt.tier} treasure chest containing ${opt.points.toLocaleString()} volts`}
          className={styles.pointsChestImg}
        />
      </div>
      <div
        className={cn(
          styles.pointsAmount,
          styles[`pointsAmount_${opt.tier}`],
        )}
      >
        <VoltIcon size={28} className={styles.pointsAmountIcon} style={{ color: 'currentColor' }} />
        {opt.points.toLocaleString()}
      </div>
      <div className={styles.pointsPrice}>
        {opt.price.toLocaleString()} $TOKEN
      </div>
      <button
        type="button"
        data-stop-card-click=""
        className={cn(
          styles.pointsBuyBtn,
          styles[`pointsBuyBtn_${opt.tier}`],
        )}
        onClick={(e) => {
          e.stopPropagation();
          onSelect();
        }}
      >
        Buy Now
      </button>
    </article>
  );
}

/* Volts purchase modal body. Cinematic mirror of PurchaseModalBody but
   pricing is in $TOKEN (the on-chain currency). Hero shows the chest
   floating, then points + bonus + $TOKEN price, then a confirm CTA.
   Wallet integration isn't wired yet so the user's $TOKEN balance is
   treated as 0 - the CTA stays active-styled (matching the Cancel
   button shape/size) but communicates the shortfall via in-button
   text, same pattern as the listing cards' "Need +X" treatment. When
   the wallet flow lands, replace `userTokenBalance` with the real
   balance and `onClose` with the actual purchase handler. */
function VoltsModalBody({ opt, onClose }) {
  const userTokenBalance = 0;
  const shortBy = Math.max(0, opt.price - userTokenBalance);
  const canAfford = shortBy === 0;
  return (
    <div className={styles.voltsStage}>
      <button
        type="button"
        className={styles.purchaseCloseBtn}
        onClick={onClose}
        aria-label="Close"
      >
        <X size={18} />
      </button>

      <div className={styles.voltsHero}>
        <div
          className={cn(
            styles.chestFrame,
            styles[`chestFrame_${opt.tier}`],
            opt.bestValue && styles.chestFrameBestValue,
          )}
        >
          <img
            src={opt.chest}
            alt=""
            className={styles.pointsChestImg}
          />
        </div>
      </div>

      <div className={styles.voltsTitleRow}>
        <h3 className={cn(styles.voltsAmount, styles[`pointsAmount_${opt.tier}`])}>
          <VoltIcon size={28} style={{ color: 'currentColor' }} />
          {opt.points.toLocaleString()}
        </h3>
        {opt.bonus && (
          <span
            className={cn(
              styles.pointsBonusPill,
              styles[`pointsBonusPill_${opt.tier}`],
            )}
          >
            {opt.bonus}
          </span>
        )}
      </div>

      <div className={styles.voltsPrice}>
        {opt.price.toLocaleString()} $TOKEN
      </div>

      <p className={styles.voltsHint}>
        Volts spend instantly across the marketplace, packs, and stat
        upgrades.
      </p>

      <div className={styles.voltsActions}>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" onClick={onClose}>
          {canAfford ? (
            'Buy Now'
          ) : (
            <>Need +{shortBy.toLocaleString()} $TOKEN</>
          )}
        </Button>
      </div>
    </div>
  );
}

/* Hero legendary pack. Left column = copy + odds + possible pulls +
   CTA; right column = a big tilted gold "L" card that slowly floats.
   Ambient particle FX + border-glow pulse are scoped to the L-card
   container (`.heroCardWrap`) so the attention-pull is right on the
   pack art, not the surrounding article. The L card itself stays
   untouched - particles are a sibling, glow pulse is on the parent. */
function LegendaryHero({ pack, canAfford, pointsShort, isOpening, onOpen }) {
  return (
    <article
      className={cn(
        styles.packCard,
        styles[`pack_${pack.variant}`],
        styles.packCardHero,
        styles.packCard_legendary,
      )}
    >
      <div className={styles.heroGrid}>
        <div className={styles.packTopRow}>
          <div className={styles.packTopLeft}>
            <span className={styles.packImgWrap} aria-hidden="true">
              <img
                src={`/skin_packs/${pack.id}_pack.webp`}
                alt=""
                className={cn(styles.packPackImg, styles.packPackImg_legendary)}
              />
            </span>
          </div>
          <div className={styles.packTopRight}>
            <div className={styles.pillRowSpacer} aria-hidden="true" />
            <h3
              className={cn(styles.packCardName, styles.packCardName_legendary)}
            >
              {pack.name}
            </h3>
            <p
              className={cn(
                styles.packCardDescription,
                styles.legendaryDescription,
              )}
            >
              {pack.description}
            </p>
            <p
              className={cn(
                styles.packCardDescription,
                styles.legendaryDescription,
                styles.legendaryTagline,
              )}
            >
              The only way to pull{' '}
              <span className={styles.legendarySkinName}>Mach Zero</span>,{' '}
              <span className={styles.legendarySkinName}>Overdrive</span>, or{' '}
              <span className={styles.legendarySkinName}>Apex Prime</span>.
            </p>
            <OddsText packId={pack.id} />
            <span className={styles.packPriceLarge}>
              <VoltIcon size={14} />
              {pack.price.toLocaleString()}
              <span className={styles.packPriceSuffix}>(3 skins included)</span>
            </span>
            <Button
              variant="secondary"
              onClick={onOpen}
              disabled={!canAfford || isOpening}
              loading={isOpening}
              className={cn(styles.packBtn, styles.packBtnGold)}
            >
              {!canAfford ? (
                <>
                  Need <VoltIcon size={15} style={{ color: 'currentColor' }} />
                  {pointsShort.toLocaleString()}
                </>
              ) : (
                'Buy Pack'
              )}
            </Button>
            <span className={cn(styles.heroHint, styles.heroHintBelow)}>
              Earn volts by racing or buy from the marketplace
            </span>
          </div>
        </div>
        <div className={styles.heroCardWrap} aria-hidden="true">
          <div className={styles.heroCardStack}>
            <LegendaryParticles />
            <div className={styles.bigLegendaryCard}>
              <span className={styles.bigCardL}>L</span>
              <span className={styles.bigCardLabel}>Legendary</span>
            </div>
          </div>
        </div>
      </div>
      <PossibleGroup items={pack.possible} />
    </article>
  );
}

/* -------------------------------------------------------------------------- */
/* Ambient particle FX over the Legendary Pack hero.                          */
/* -------------------------------------------------------------------------- */

let particleNextId = 0;

/** Roll a single particle. Single smooth upward trajectory - no
 *  radial bursts, no direction reversals. Each particle:
 *  - spawns somewhere on the card's surface
 *  - drifts gently upward (never sideways or downward)
 *  - has a small per-particle horizontal sway (consistent direction)
 *  - shrinks + fades over its lifetime
 *  Eye reads it as a continuous rising glitter rather than zigzagging
 *  dots. */
function spawnParticle() {
  // Size variety for depth parallax - small/medium/large round dots.
  const sizeRoll = Math.random();
  const size = sizeRoll < 0.55 ? 'sm' : sizeRoll < 0.85 ? 'md' : 'lg';

  // Color hierarchy: 55% gold, 30% white, 15% amber.
  const r = Math.random();
  const color = r < 0.55 ? 'gold' : r < 0.85 ? 'white' : 'amber';

  // Spawn distribution: 75% halo around the card, 25% on the card itself.
  let left;
  let top;
  if (Math.random() < 0.75) {
    let attempts = 0;
    do {
      left = -25 + Math.random() * 150;
      top = -10 + Math.random() * 125;
      attempts += 1;
    } while (
      left >= 10 && left <= 90 && top >= 10 && top <= 90 && attempts < 8
    );
  } else {
    left = 15 + Math.random() * 70;
    top = 15 + Math.random() * 70;
  }

  // Single smooth upward drift. Horizontal sway ±20px, vertical 60-110px.
  const dx = (Math.random() - 0.5) * 40;
  const dy = -60 - Math.random() * 50;

  return {
    id: particleNextId++,
    size,
    color,
    left,
    top,
    dx,
    dy,
    duration: 2600 + Math.random() * 1400, // 2.6-4s
    born: typeof performance !== 'undefined' ? performance.now() : Date.now(),
  };
}

const PARTICLE_MAX_LIFETIME_MS = 4200;
const PARTICLE_MAX_COUNT = 24;
const PARTICLE_SPAWN_INTERVAL_MS = 180;

/**
 * 20-30 particles continuously emitted from the legendary card edges,
 * drifting upward + outward with sinusoidal horizontal motion, fading +
 * shrinking over their 2-4s lifetime. Pure CSS keyframes; only the
 * spawn/prune loop is in JS.
 */
function LegendaryParticles() {
  const [particles, setParticles] = useState([]);

  useEffect(() => {
    const id = setInterval(() => {
      setParticles((prev) => {
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        // Drop dead particles, then add a new one, capping at PARTICLE_MAX_COUNT.
        const alive = prev.filter((p) => now - p.born < PARTICLE_MAX_LIFETIME_MS);
        const next = [...alive, spawnParticle()];
        return next.length > PARTICLE_MAX_COUNT
          ? next.slice(next.length - PARTICLE_MAX_COUNT)
          : next;
      });
    }, PARTICLE_SPAWN_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <div className={styles.particleLayer} aria-hidden="true">
      {particles.map((p) => (
        <span
          key={p.id}
          className={cn(
            styles.particle,
            styles[`particle_${p.size}`],
            styles[`particle_${p.color}`],
          )}
          style={{
            left: `${p.left}%`,
            top: `${p.top}%`,
            animationDuration: `${p.duration}ms`,
            '--dx': `${p.dx}px`,
            '--dy': `${p.dy}px`,
          }}
        />
      ))}
    </div>
  );
}

function PackCard({ pack, canAfford, pointsShort, isOpening, onOpen }) {
  const tone = pack.id === 'premium' ? 'premium' : 'starter';
  return (
    <article
      className={cn(
        styles.packCard,
        styles[`pack_${pack.variant}`],
        styles[`packCard_${tone}`],
      )}
    >
      <div className={styles.packTopRow}>
        <div className={styles.packTopLeft}>
          <span className={styles.packImgWrap} aria-hidden="true">
            <img
              src={`/skin_packs/${pack.id}_pack.webp`}
              alt=""
              className={cn(styles.packPackImg, styles[`packPackImg_${pack.id}`])}
            />
          </span>
        </div>
        <div className={styles.packTopRight}>
          {pack.pills ? (
            <div className={styles.pillRow}>
              {pack.pills.map((p, i) => (
                <span
                  key={i}
                  className={cn(styles.pill, styles[`pill_${p.tone}`])}
                >
                  {p.label}
                </span>
              ))}
            </div>
          ) : (
            /* Spacer keeps the title (and everything below it) at the
               same y across packs that don't carry pills. */
            <div className={styles.pillRowSpacer} aria-hidden="true" />
          )}
          <h3 className={cn(styles.packCardName, styles[`packCardName_${tone}`])}>
            {pack.name}
          </h3>
          <p className={styles.packCardDescription}>{pack.description}</p>
          <OddsText packId={pack.id} />
          <span className={styles.packPriceLarge}>
            <VoltIcon size={14} />
            {pack.price.toLocaleString()}
            <span className={styles.packPriceSuffix}>(3 skins included)</span>
          </span>
          <Button
            variant={pack.buttonVariant === 'gold' ? 'secondary' : pack.buttonVariant}
            onClick={onOpen}
            disabled={!canAfford || isOpening}
            loading={isOpening}
            className={cn(
              styles.packBtn,
              tone === 'premium' && styles.packBtnPurple,
              tone === 'starter' && styles.packBtnTeal,
            )}
          >
            {!canAfford ? (
              <>
                Need <VoltIcon size={15} style={{ color: 'currentColor' }} />
                {pointsShort.toLocaleString()}
              </>
            ) : (
              'Buy Pack'
            )}
          </Button>
        </div>
      </div>
      <PossibleGroup items={pack.possible} />
    </article>
  );
}

/* "What You Could Pull" group - 6 named card slots with rarity glow. */
function PossibleGroup({ items }) {
  return (
    <div className={styles.possibleGroup}>
      <span className={styles.possibleLabel}>What You Could Pull</span>
      <div className={styles.possibleGrid}>
        {items.map((item, i) => (
          <PossibleCard key={i} item={item} />
        ))}
      </div>
    </div>
  );
}

/* Renders one slot in the "WHAT YOU COULD PULL" preview grid. Items are
   real skins sampled from the image-backed catalog. Legendary slots get
   the gold "L" letter treatment (matches the hero's bigCardL). All other
   rarities show the actual skin swatch via SkinThumb. */
function PossibleCard({ item }) {
  const isLegendary = item.rarity === 'legendary';
  return (
    <div className={cn(styles.possibleCard, styles[`possibleCard_${item.rarity}`])}>
      <div className={styles.possibleInner}>
        {isLegendary ? (
          <span className={styles.possibleL} aria-hidden="true">L</span>
        ) : (
          <SkinThumb
            skin={item}
            rarity={item.rarity}
            alt={item.name}
            className={styles.possibleSkinThumb}
          />
        )}
      </div>
      <span className={styles.possibleName}>{item.name}</span>
      <span
        className={cn(styles.possibleRarity, styles[`rarity_${item.rarity}`])}
      >
        {RARITY_LABELS[item.rarity]}
      </span>
    </div>
  );
}


/* -------------------------------------------------------------------------- */
/* Capsule (mod) packs                                                         */
/*                                                                             */
/* Mirror the skin pack visual structure exactly - same wrapper classes, same  */
/* hero/premium/starter hierarchy. Differences: image src, preview slot uses   */
/* ModPlaceholder hex chip instead of SkinThumb swatch, click is a no-op       */
/* (purchase logic not wired yet), and the card adds a "Contains 3 Mods"       */
/* footer caption. Skin pack components are not modified.                      */
/* -------------------------------------------------------------------------- */

function CapsuleHero({ pack, onOpen }) {
  return (
    <article
      className={cn(
        styles.packCard,
        styles[`pack_${pack.variant}`],
        styles.packCardHero,
        styles.packCard_legendary,
      )}
    >
      <div className={styles.heroGrid}>
        <div className={styles.packTopRow}>
          <div className={styles.packTopLeft}>
            <span className={styles.packImgWrap} aria-hidden="true">
              <img
                src={`/capsules/${pack.id.replace('capsule-', 'capsule_')}.webp`}
                alt=""
                className={cn(styles.packPackImg, styles.packPackImg_legendary)}
              />
            </span>
          </div>
          <div className={styles.packTopRight}>
            <div className={styles.pillRowSpacer} aria-hidden="true" />
            <h3
              className={cn(styles.packCardName, styles.packCardName_legendary)}
            >
              {pack.name}
            </h3>
            <p
              className={cn(
                styles.packCardDescription,
                styles.legendaryDescription,
              )}
            >
              {pack.description}
            </p>
            {/* Parallel tagline to the legendary skin pack so the price +
                Buy Pack button sit at the same vertical position across the
                two legendary heroes. Same .legendaryTagline classes; just
                names the three legendary mods instead of skins. */}
            <p
              className={cn(
                styles.packCardDescription,
                styles.legendaryDescription,
                styles.legendaryTagline,
              )}
            >
              The only way to pull{' '}
              <span className={styles.legendarySkinName}>Phantom Drive</span>,{' '}
              <span className={styles.legendarySkinName}>Quantum Sync</span>, or{' '}
              <span className={styles.legendarySkinName}>Storm Rider</span>.
            </p>
            <OddsText packId={pack.id} odds={CAPSULE_PACK_ODDS[pack.id]} />
            <span className={styles.packPriceLarge}>
              <VoltIcon size={14} />
              {pack.price.toLocaleString()}
              <span className={styles.packPriceSuffix}>(3 mods included)</span>
            </span>
            <Button
              variant="secondary"
              onClick={() => onOpen?.(pack)}
              className={cn(styles.packBtn, styles.packBtnGold)}
            >
              Buy Pack
            </Button>
            <span className={cn(styles.heroHint, styles.heroHintBelow)}>
              Earn volts by racing or buy volts from the marketplace
            </span>
          </div>
        </div>
        <div className={styles.heroCardWrap} aria-hidden="true">
          <div className={styles.heroCardStack}>
            <LegendaryParticles />
            <div className={styles.bigLegendaryCard}>
              <span className={styles.bigCardL}>L</span>
              <span className={styles.bigCardLabel}>Legendary</span>
            </div>
          </div>
        </div>
      </div>
      <CapsulePossibleGroup packId={pack.id} />
    </article>
  );
}

function CapsuleCard({ pack, onOpen }) {
  const tone = pack.id === 'capsule-premium' ? 'premium' : 'starter';
  const imgSlug = pack.id.replace('capsule-', 'capsule_');
  return (
    <article
      className={cn(
        styles.packCard,
        styles[`pack_${pack.variant}`],
        styles[`packCard_${tone}`],
      )}
    >
      <div className={styles.packTopRow}>
        <div className={styles.packTopLeft}>
          <span className={styles.packImgWrap} aria-hidden="true">
            <img
              src={`/capsules/${imgSlug}.webp`}
              alt=""
              className={cn(styles.packPackImg, styles[`packPackImg_${tone}`])}
            />
          </span>
        </div>
        <div className={styles.packTopRight}>
          {pack.pills ? (
            <div className={styles.pillRow}>
              {pack.pills.map((p, i) => (
                <span
                  key={i}
                  className={cn(styles.pill, styles[`pill_${p.tone}`])}
                >
                  {p.label}
                </span>
              ))}
            </div>
          ) : (
            <div className={styles.pillRowSpacer} aria-hidden="true" />
          )}
          <h3 className={cn(styles.packCardName, styles[`packCardName_${tone}`])}>
            {pack.name}
          </h3>
          <p className={styles.packCardDescription}>{pack.description}</p>
          <OddsText packId={pack.id} odds={CAPSULE_PACK_ODDS[pack.id]} />
          <span className={styles.packPriceLarge}>
            <VoltIcon size={14} />
            {pack.price.toLocaleString()}
            <span className={styles.packPriceSuffix}>(3 mods included)</span>
          </span>
          <Button
            variant={pack.buttonVariant === 'gold' ? 'secondary' : pack.buttonVariant}
            onClick={() => onOpen?.(pack)}
            className={cn(
              styles.packBtn,
              tone === 'premium' && styles.packBtnPurple,
              tone === 'starter' && styles.packBtnTeal,
            )}
          >
            Buy Pack
          </Button>
        </div>
      </div>
      <CapsulePossibleGroup packId={pack.id} />
    </article>
  );
}

/* Capsule preview grid - 6 hex-chip slots reflecting the pack's drop
   distribution (CAPSULE_PREVIEW_DISTRIBUTION). Non-legendary slots render
   a rarity-tinted ModPlaceholder; legendary slots render the gold "L"
   treatment that the skin packs use. */
function CapsulePossibleGroup({ packId }) {
  // Re-shuffles on every mount/re-render. Same cadence as the skin pack
  // previews. Each row gets unique names per rarity (cursor-walks a
  // shuffled list).
  const samples = useMemo(() => pickModPreviewSamples(packId), [packId]);
  return (
    <div className={styles.possibleGroup}>
      <span className={styles.possibleLabel}>What You Could Pull</span>
      <div className={styles.possibleGrid}>
        {samples.map((s, i) => (
          <CapsulePossibleCard key={`${s.name}-${i}`} sample={s} />
        ))}
      </div>
    </div>
  );
}

function CapsulePossibleCard({ sample }) {
  const { name, rarity } = sample;
  return (
    <div className={cn(styles.possibleCard, styles[`possibleCard_${rarity}`])}>
      <div className={styles.possibleInner}>
        <ModPlaceholder
          rarity={rarity}
          size={120}
          className={styles.possibleModChip}
        />
      </div>
      <span className={styles.possibleName}>{name}</span>
      <span
        className={cn(styles.possibleRarity, styles[`rarity_${rarity}`])}
      >
        {RARITY_LABELS[rarity]}
      </span>
    </div>
  );
}

/* Odds as colored text, one entry per rarity present in the pack. Accepts
   an explicit `odds` map (capsules) or falls back to PACK_ODDS by packId
   (skins). The guaranteed rarity (100%) leads the row; remaining rarities
   follow in normal common→legendary order. Values use 1-decimal precision
   when fractional (2.5%, 0.5%) so per-spec percentages aren't rounded. */
function formatOddsPct(v) {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

function OddsText({ packId, odds: oddsProp }) {
  const odds = oddsProp ?? PACK_ODDS[packId];
  if (!odds) return null;
  const present = RARITY_LIST.filter((r) => odds[r] > 0);
  // Lead with the 100% guaranteed rarity if any; otherwise lead with the
  // highest-tier rarity present (legendary > epic > rare > common) so the
  // pack's namesake rarity sits first. Other rarities follow in the
  // common→legendary RARITY_LIST order.
  const guaranteed = present.find((r) => odds[r] === 100);
  // present is RARITY_LIST-ordered (common→legendary), so the last
  // element is the highest tier present in this pack.
  const lead = guaranteed ?? present[present.length - 1] ?? null;
  const others = lead ? present.filter((r) => r !== lead) : present;
  const entries = lead ? [lead, ...others] : others;
  return (
    <div className={styles.oddsText}>
      {entries.map((r, i) => (
        <span key={r} className={styles.oddsTextItem}>
          <span className={cn(styles.oddsTextLabel, styles[`rarity_${r}`])}>
            {RARITY_LABELS[r]}
          </span>{' '}
          <span className={styles.oddsTextValue}>
            {formatOddsPct(odds[r])}%
          </span>
          {i < entries.length - 1 && (
            <span className={styles.oddsTextSep} aria-hidden="true">
              ·
            </span>
          )}
        </span>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Listing card                                                               */
/* -------------------------------------------------------------------------- */

function ListingCard({
  listing,
  isOwner,
  canAfford,
  pointsShort,
  onBuy,
  onCancel,
}) {
  const router = useRouter();
  const isDrone = listing.itemType === 'drone';
  const isMod = listing.itemType === 'mod';
  const isSkin = listing.itemType === 'skin';
  const drone = listing.drone;
  const skin = listing.skin;
  const mod = listing.mod;
  const rarity = isMod ? mod?.rarity : skin?.rarity;

  const goToSeller = (e) => {
    // Prevent the surrounding drone-card <Link> from also firing — nested
    // anchors are invalid HTML, so the seller name is a clickable span
    // that pushes the route programmatically.
    e.preventDefault();
    e.stopPropagation();
    if (listing.seller?.id) {
      router.push(`/profile/${listing.seller.id}`);
    }
  };

  const rarityClass =
    !isDrone && rarity
      ? styles[`card_${rarity}`]
      : '';

  const itemName = isDrone
    ? drone?.name
    : isMod
      ? mod?.name
      : skin?.name;

  const levelClass =
    isDrone && drone?.level != null
      ? styles[`card_level_${getLevelTier(drone.level)}`]
      : '';

  const legendaryTheme =
    isDrone && drone?.appliedSkin?.rarity === 'legendary'
      ? getLegendaryTheme(drone.appliedSkin?.name)
      : null;
  const legendaryStyle = legendaryTheme
    ? {
        '--legendary-bg': legendaryTheme.bg,
        '--legendary-glow-1': legendaryTheme.glow1,
        // Body wash uses glow-2 (skin's bgTint, fallback to primary) so a
        // skin can have a border color distinct from its body tint -
        // Valiant: ice-blue border, white body wash. Was missing here so
        // every legendary marketplace card fell through to the
        // glow-1-only ::after rule and read near-black.
        '--legendary-glow-2': legendaryTheme.glow2,
      }
    : undefined;

  const cardActionAvailable = isOwner ? true : canAfford;
  const handleCardClick = (e) => {
    // The card surface is the click target. Inner buttons / links call
    // stopPropagation so this only fires on body clicks. Owner cards
    // open the cancel modal; non-owner cards always open the buy modal -
    // affordability gating happens inside the modal so users can still
    // see item details when they can't afford it.
    if (e.target.closest('[data-stop-card-click]')) return;
    if (isOwner) {
      onCancel();
    } else {
      onBuy();
    }
  };

  return (
    <div
      className={cn(
        styles.listingCard,
        rarityClass,
        levelClass,
        isMod && styles.cardMod,
        isOwner && styles.cardMine,
        !isDrone && rarity === 'legendary' && styles.cardLegendaryShimmer,
        legendaryTheme && styles.skinRarity_legendary,
      )}
      style={legendaryStyle}
      role="button"
      tabIndex={0}
      onClick={handleCardClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (isOwner) onCancel();
          else onBuy();
        }
      }}
      aria-label={
        isOwner
          ? `Cancel listing for ${itemName ?? 'item'}`
          : cardActionAvailable
            ? `Buy ${itemName ?? 'item'} for ${listing.price} volts`
            : `View ${itemName ?? 'item'} listing`
      }
    >
      {isOwner && <span className={styles.ownerChip}>YOUR LISTING</span>}

      <div className={styles.listingImage}>
        {isDrone ? (
          <DroneImage
            drone={drone}
            alt={drone?.name ?? 'Drone'}
            className={styles.droneImg}
          />
        ) : isMod ? (
          <ModPlaceholder
            rarity={rarity}
            size={92}
            className={styles.listingImageMod}
          />
        ) : (
          <SkinSlot skin={skin} rarity={rarity} alt={skin?.name} />
        )}
      </div>

      <div className={styles.listingBody}>
        <div className={styles.listingTitleRow}>
          <span className={styles.listingName}>{itemName ?? 'Unknown'}</span>
          {isDrone && drone?.level != null && (
            <span
              className={styles.listingLevel}
              style={{ color: getLevelColor(drone.level) }}
            >
              LV {drone.level}
            </span>
          )}
          {!isDrone && rarity && (
            <span className={cn(styles.rarityTag, styles[`rarity_${rarity}`])}>
              {RARITY_LABELS[rarity]}
            </span>
          )}
        </div>

        {/* Middle slot - absorbs all variable content (drone stat bars,
            mod description, skin compat note) so the title above and
            the price/seller/button below stay pinned to identical
            vertical positions across every card. */}
        <div className={styles.cardMiddle}>
          {isDrone && drone && (
            <div className={styles.statBars}>
              <StatMiniBar label="SPD" value={drone.speed} />
              <StatMiniBar label="TRN" value={drone.turning} />
              <StatMiniBar label="DUR" value={drone.durability} />
            </div>
          )}

          {isMod && mod?.description && (
            <div className={styles.modDesc}>{mod.description}</div>
          )}

          {!isDrone && (
            <div className={styles.compat}>Compatible with any drone</div>
          )}
        </div>

        <div className={styles.priceRow}>
          <VoltIcon size={13} />
          <span className={styles.price}>
            {listing.price.toLocaleString()}
          </span>
        </div>

        {isDrone && drone ? (
          <div className={styles.collectionRow}>
            <span className={styles.collectionItem}>
              <span className={styles.collectionLabel}>MODS</span>
              <span className={styles.collectionCountMod}>
                {drone.boundModCount ?? 0}
              </span>
            </span>
            <span className={styles.collectionItem}>
              <span className={styles.collectionLabel}>SKINS</span>
              <span className={styles.collectionCountSkin}>
                {drone.boundSkinCount ?? 0}
              </span>
            </span>
          </div>
        ) : (
          <div className={styles.collectionPlaceholder} aria-hidden="true" />
        )}

        <div className={styles.seller}>
          by{' '}
          {listing.seller?.username ? (
            <span
              className={styles.sellerLink}
              role="link"
              tabIndex={0}
              data-stop-card-click=""
              onClick={goToSeller}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') goToSeller(e);
              }}
            >
              {listing.seller.username}
            </span>
          ) : (
            'anonymous'
          )}
        </div>

        {/* Wrapper swallows clicks so the card-level click handler doesn't
            also fire when the user clicks the inner button. The
            data-stop-card-click attr is a belt-and-braces fallback for the
            closest() check in handleCardClick. */}
        <div
          className={styles.cardBtnWrap}
          data-stop-card-click=""
          onClick={(e) => e.stopPropagation()}
        >
          {isOwner ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onCancel();
              }}
              className={styles.cardBtn}
            >
              Cancel
            </Button>
          ) : (
            <Button
              variant="primary"
              size="sm"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (canAfford) onBuy();
              }}
              disabled={!canAfford}
              className={styles.cardBtn}
            >
              {canAfford ? (
                'Buy Now'
              ) : (
                <>
                  Need <VoltIcon size={14} style={{ color: 'currentColor' }} />
                  {pointsShort.toLocaleString()}
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Visual picker for the List Item modal. Mirrors the bind-skin/bind-mod      */
/* pattern in app/drones/[droneId]: thumbnail card grid with rarity-tinted    */
/* borders and a single-select check.                                          */
/* -------------------------------------------------------------------------- */

function ListingItemPicker({ kind, items, selectedId, onSelect }) {
  if (!items || items.length === 0) {
    return (
      <div className={styles.listFormEmpty}>
        {kind === 'drone'
          ? 'No inactive drones available to list.'
          : kind === 'skin'
            ? 'No unbound skins available to list.'
            : 'No unbound mods available to list.'}
      </div>
    );
  }
  return (
    <div className={styles.listFormGrid}>
      {items.map((item) => {
        const isSelected = String(selectedId) === String(item.id);
        const tierClass =
          kind === 'drone' && item.level != null
            ? styles[`listFormCard_level_${getLevelTier(item.level)}`]
            : kind !== 'drone' && item.rarity
              ? styles[`listFormCard_${item.rarity}`]
              : '';
        return (
          <button
            key={item.id}
            type="button"
            className={cn(
              styles.listFormCard,
              tierClass,
              isSelected && styles.listFormCardSelected,
            )}
            onClick={() => onSelect(isSelected ? '' : String(item.id))}
            aria-pressed={isSelected}
          >
            {isSelected && (
              <span className={styles.listFormCardCheck} aria-hidden="true">
                <Check size={12} strokeWidth={3} />
              </span>
            )}
            <div className={styles.listFormCardImage}>
              {kind === 'drone' ? (
                <DroneImage drone={item} alt={item.name} />
              ) : kind === 'skin' ? (
                <SkinThumb skin={item} rarity={item.rarity} alt={item.name} />
              ) : (
                <ModPlaceholder rarity={item.rarity} size={64} />
              )}
            </div>
            <div className={styles.listFormCardName}>{item.name}</div>
            <div className={styles.listFormCardMeta}>
              {kind === 'drone'
                ? `LV ${item.level}`
                : RARITY_LABELS[item.rarity] ?? item.rarity}
            </div>
          </button>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Skin slot - renders the actual skin image when image-backed, otherwise     */
/* the marketplace-local folded-pentagon placeholder. Bypasses SkinThumb so   */
/* the marketplace can ship its own placeholder shape without affecting       */
/* skin previews on other surfaces (drone management, packs, purchase modal). */
/* -------------------------------------------------------------------------- */

function SkinSlot({ skin, rarity, alt }) {
  // Defer to SkinThumb so the placeholder fallback uses the shared
  // SkinMini diamond/prism — same shape as the pack-preview cards. Wrap
  // gives the rarity-tinted SVG room to breathe inside the listing's
  // image slot without imposing an aspect ratio at this level.
  return (
    <SkinThumb
      skin={skin}
      rarity={rarity}
      alt={alt}
      className={styles.skinImg}
    />
  );
}

/* Open-envelope-pointing-down swatch placeholder. Five corners: a narrow
   top edge between the two top apexes, side anchors that spread out wide,
   and a sharp bottom point. The center facet is a slim downward triangle
   (the "envelope spine"); the side facets are wider flaps that fold out
   from the spine. Fills + strokes inherit currentColor (set per rarity by
   the wrapper) so all variants share one SVG. */
function MarketplaceSkinPlaceholder({ rarity }) {
  const rarityClass = rarity
    ? styles[`skinPlaceholder_${rarity}`]
    : styles.skinPlaceholder_common;
  return (
    <span
      className={cn(styles.skinPlaceholderWrap, rarityClass)}
      aria-hidden="true"
    >
      <svg viewBox="0 0 200 158" className={styles.skinPlaceholderSvg}>
        {/* Back wall facet (between the two folds). */}
        <polygon points="14,14 186,14 100,148" fill="currentColor" fillOpacity="0.22" />
        {/* Left flap. */}
        <polygon points="14,14 22,108 100,148" fill="currentColor" fillOpacity="0.10" />
        {/* Right flap - mirror of the left. */}
        <polygon points="186,14 178,108 100,148" fill="currentColor" fillOpacity="0.10" />
        {/* Outer pentagon: top edge pulled in slightly + viewBox a touch
            taller so the silhouette reads a little taller and narrower. */}
        <path
          d="M 14,14 L 186,14 L 178,108 L 100,148 L 22,108 Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeOpacity="0.7"
          strokeLinejoin="round"
        />
        {/* V fold lines from the top corners to the apex. */}
        <line
          x1="14" y1="14" x2="100" y2="148"
          stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.7"
        />
        <line
          x1="186" y1="14" x2="100" y2="148"
          stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.7"
        />
      </svg>
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Mini bar (3 key stats on drone cards)                                      */
/* -------------------------------------------------------------------------- */

function StatMiniBar({ label, value }) {
  // Stats are bounded ~1-100 in-game; clamp for display safety.
  const pct = Math.max(0, Math.min(100, (Number(value) || 0)));
  return (
    <div className={styles.statBar}>
      <span className={styles.statBarLabel}>{label}</span>
      <div className={styles.statBarTrack}>
        <div className={styles.statBarFill} style={{ width: `${pct}%` }} />
      </div>
      <span className={styles.statBarValue}>{value ?? 0}</span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Cinematic purchase modal body. Branches on listing.itemType to render      */
/* an item-specific hero + compact details; shared bottom (price, CTA, fee).  */
/* The hero uses a CSS floating animation; on success a radial glow pulse     */
/* radiates from the item and the body collapses to PURCHASED + name. The    */
/* parent controls the auto-close timer (handleBuy at ~2s).                  */
/* -------------------------------------------------------------------------- */

const RARITY_GLOW = {
  common: '#9E9E9E',
  rare: '#03DAC6',
  epic: '#BB86FC',
  legendary: '#FFD700',
};

/* -------------------------------------------------------------------------- */
/* Cancel-listing modal body. Same cinematic shape as PurchaseModalBody but   */
/* trimmed for confirm/dismiss only: hero (item w/ float), name + rarity,    */
/* current price, prompt text, and Keep / Cancel CTAs. Calls onConfirm when  */
/* the user commits; the parent owns the API call and pending state.         */
/* -------------------------------------------------------------------------- */

function CancelModalBody({
  listing,
  pending,
  onConfirm,
  onClose,
  editPrice,
  onEditPriceChange,
  onUpdatePrice,
  updatePending,
  updateError,
}) {
  const isDrone = listing.itemType === 'drone';
  const isMod = listing.itemType === 'mod';
  const isSkin = listing.itemType === 'skin';
  const drone = listing.drone;
  const mod = listing.mod;
  const skin = listing.skin;
  const itemName = drone?.name ?? mod?.name ?? skin?.name ?? 'Item';
  const rarity = mod?.rarity ?? skin?.rarity;

  // Shadow-color logic mirrors the purchase modal exactly so cancel reads
  // as the same visual family. Legendary drones (with applied legendary
  // skin) and standalone legendary skins both take their per-skin glow1
  // so each legendary's modal feels unique instead of defaulting to gold.
  const glowColor = isDrone
    ? drone?.appliedSkin?.rarity === 'legendary'
      ? getLegendaryTheme(drone.appliedSkin?.name).glow1
      : getLevelColor(drone?.level ?? 1)
    : isSkin && skin?.rarity === 'legendary'
      ? getLegendaryTheme(skin?.name).glow1
      : (RARITY_GLOW[rarity ?? 'common'] ?? RARITY_GLOW.common);

  return (
    <div className={styles.purchaseStage} style={{ '--glow-color': glowColor }}>
      <button
        type="button"
        className={styles.purchaseCloseBtn}
        onClick={onClose}
        aria-label="Close"
        disabled={pending}
      >
        <X size={18} />
      </button>

      <div className={styles.purchaseHero}>
        <span className={styles.purchaseHeroShadow} aria-hidden="true" />
        <div className={styles.purchaseHeroFloat}>
          {isDrone && drone && (
            <DroneImage
              drone={drone}
              alt={drone.name}
              className={styles.purchaseHeroImg}
            />
          )}
          {isMod && mod && (
            <span className={styles.purchaseHeroMod}>
              <ModPlaceholder rarity={mod.rarity} size={200} />
            </span>
          )}
          {isSkin && skin && (
            <SkinThumb
              skin={skin}
              rarity={skin.rarity}
              alt={skin.name}
              className={styles.purchaseHeroSkin}
            />
          )}
        </div>
      </div>

      <div className={styles.purchaseTitleRow}>
        <h3 className={styles.purchaseName}>{itemName}</h3>
        {isDrone && drone?.level != null && (
          <span
            className={styles.purchaseLevel}
            style={{ color: getLevelColor(drone.level) }}
          >
            LV {drone.level}
          </span>
        )}
        {!isDrone && rarity && (
          <span
            className={cn(
              styles.purchaseRarityTag,
              styles[`rarity_${rarity}`],
            )}
          >
            {RARITY_LABELS[rarity]}
          </span>
        )}
      </div>

      <hr className={styles.purchaseDivider} aria-hidden="true" />

      <div className={styles.purchasePriceRow}>
        <VoltIcon size={24} />
        <span className={styles.purchasePrice}>
          {listing.price.toLocaleString()}
        </span>
      </div>

      <div className={styles.cancelEditBlock}>
        <span className={styles.cancelEditLabel}>Modify Price</span>
        <div className={styles.cancelEditRow}>
          <VoltIcon size={14} />
          <input
            type="number"
            inputMode="numeric"
            min="10"
            className={styles.cancelEditInput}
            value={editPrice}
            onChange={(e) => onEditPriceChange(e.target.value)}
            disabled={updatePending || pending}
          />
        </div>
      </div>

      <button
        type="button"
        className={styles.cancelUpdateBtn}
        onClick={onUpdatePrice}
        disabled={updatePending || pending}
      >
        {updatePending ? 'Updating...' : 'Update Price'}
      </button>

      {updateError && (
        <div className={styles.cancelUpdateError}>{updateError}</div>
      )}

      <p className={styles.cancelPrompt}>Cancel this listing?</p>

      <div className={styles.cancelActions}>
        <button
          type="button"
          className={styles.cancelKeepBtn}
          onClick={onClose}
          disabled={pending || updatePending}
        >
          Keep Listed
        </button>
        <button
          type="button"
          className={styles.cancelDangerBtn}
          onClick={onConfirm}
          disabled={pending || updatePending}
        >
          {pending ? 'Cancelling...' : 'Cancel Listing'}
        </button>
      </div>
    </div>
  );
}

function PurchaseModalBody({
  listing,
  userPoints,
  pending,
  success,
  error,
  onConfirm,
  onClose,
}) {
  const isDrone = listing.itemType === 'drone';
  const isMod = listing.itemType === 'mod';
  const isSkin = listing.itemType === 'skin';
  const drone = listing.drone;
  const mod = listing.mod;
  const skin = listing.skin;

  const itemName = drone?.name ?? mod?.name ?? skin?.name ?? 'Item';
  const sellerName = listing.seller?.username;
  const canAfford = userPoints >= listing.price;
  const shortBy = canAfford ? 0 : listing.price - userPoints;

  // Shadow color piped via --glow-color CSS variable. Drones with a
  // legendary skin and legendary skin listings both take their per-skin
  // glow1; other drones use their level tier color; other mods/skins
  // use the rarity color.
  const rarity = mod?.rarity ?? skin?.rarity ?? 'common';
  const glowColor = isDrone
    ? drone?.appliedSkin?.rarity === 'legendary'
      ? getLegendaryTheme(drone.appliedSkin?.name).glow1
      : getLevelColor(drone?.level ?? 1)
    : isSkin && skin?.rarity === 'legendary'
      ? getLegendaryTheme(skin?.name).glow1
      : (RARITY_GLOW[rarity] ?? RARITY_GLOW.common);

  const totalRaces = (drone?.wins ?? 0) + (drone?.losses ?? 0);
  const winRate = totalRaces > 0
    ? Math.round(((drone?.wins ?? 0) / totalRaces) * 100)
    : 0;

  // CTA is always the accent teal across drone / skin / mod purchases -
  // it's the universal "confirm" colour and stays consistent with every
  // other modal CTA in the app. The hero glow above still tints to the
  // item rarity / level tier; only the action button is fixed.
  const ctaBg = 'var(--accent-primary)';
  const ctaText = '#000';

  const showClose = !pending && !success;

  return (
    <div
      className={cn(styles.purchaseStage, success && styles.purchaseStageSuccess)}
      style={{ '--glow-color': glowColor }}
    >
      {showClose && (
        <button
          type="button"
          className={styles.purchaseCloseBtn}
          onClick={onClose}
          aria-label="Close"
        >
          <X size={18} />
        </button>
      )}

      <div className={styles.purchaseHero}>
        {success && <span className={styles.purchaseGlowPulse} aria-hidden="true" />}
        {/* Static ground shadow under the floating item. Stays anchored
            so the item appears to hover over its own shadow. */}
        <span className={styles.purchaseHeroShadow} aria-hidden="true" />
        <div className={styles.purchaseHeroFloat}>
          {isDrone && drone && (
            <DroneImage
              drone={drone}
              alt={drone.name}
              className={styles.purchaseHeroImg}
            />
          )}
          {isMod && mod && (
            <span className={styles.purchaseHeroMod}>
              <ModPlaceholder rarity={mod.rarity} size={200} />
            </span>
          )}
          {isSkin && skin && (
            <SkinThumb
              skin={skin}
              rarity={skin.rarity}
              alt={skin.name}
              className={styles.purchaseHeroSkin}
            />
          )}
        </div>
      </div>

      {success ? (
        <div className={styles.purchaseSuccessBlock}>
          <div className={styles.purchaseSuccessHeading}>PURCHASED</div>
          <div className={styles.purchaseSuccessName}>{success.name}</div>
        </div>
      ) : (
        <>
          <div className={styles.purchaseTitleRow}>
            <h3 className={styles.purchaseName}>{itemName}</h3>
            {isDrone && drone?.level != null && (
              <span
                className={styles.purchaseLevel}
                style={{ color: getLevelColor(drone.level) }}
              >
                LV {drone.level}
              </span>
            )}
            {isMod && mod?.rarity && (
              <span
                className={cn(
                  styles.purchaseRarityTag,
                  styles[`rarity_${mod.rarity}`],
                )}
              >
                {RARITY_LABELS[mod.rarity]}
              </span>
            )}
            {isSkin && skin?.rarity && (
              <span
                className={cn(
                  styles.purchaseRarityTag,
                  styles[`rarity_${skin.rarity}`],
                )}
              >
                {RARITY_LABELS[skin.rarity]}
              </span>
            )}
          </div>

          {isMod && mod && (mod.specialAbility || mod.description) && (
            <div className={styles.purchaseModDesc}>
              {mod.specialAbility ?? mod.description}
            </div>
          )}

          {isDrone && drone && (
            <div className={styles.purchaseDetails}>
              <span className={styles.purchaseDet}>
                <span className={styles.purchaseDetLabel}>ELO</span>
                {drone.eloRating ?? 0}
              </span>
              <span className={styles.purchaseDet}>
                <span className={styles.purchaseDetLabel}>WIN</span>
                {winRate}%
              </span>
              <span className={styles.purchaseDet}>
                <span className={styles.purchaseDetLabel}>MODS</span>
                {drone.boundModCount ?? 0}
              </span>
              <span className={styles.purchaseDet}>
                <span className={styles.purchaseDetLabel}>SKINS</span>
                {drone.boundSkinCount ?? 0}
              </span>
            </div>
          )}

          {isDrone && drone?.id && (
            <Link
              href={`/drones/${drone.id}`}
              className={styles.purchaseDroneDetailsLink}
            >
              View drone details →
            </Link>
          )}

          {(isSkin || isMod) && (
            <div className={styles.purchaseCompat}>Compatible with any drone</div>
          )}

          {sellerName && (
            <div className={styles.purchaseSeller}>Listed by {sellerName}</div>
          )}

          <hr className={styles.purchaseDivider} aria-hidden="true" />

          <div className={styles.purchasePriceRow}>
            <VoltIcon size={24} />
            <span className={styles.purchasePrice}>
              {listing.price.toLocaleString()}
            </span>
          </div>
          <div className={styles.purchaseBalance}>
            Your balance: <VoltIcon size={12} />
            {userPoints.toLocaleString()}
          </div>

          <button
            type="button"
            className={cn(
              styles.purchaseCta,
              !canAfford && styles.purchaseCtaShort,
            )}
            style={{ '--cta-bg': ctaBg, '--cta-text': ctaText }}
            onClick={onConfirm}
            disabled={!canAfford || pending}
          >
            {pending
              ? 'Processing...'
              : !canAfford
                ? 'Not enough Volts'
                : 'Confirm Purchase'}
          </button>

          {error && <div className={styles.purchaseError}>{error}</div>}

          <p className={styles.purchaseFee}>10% marketplace fee included</p>
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Pack flow modal body - ONE component, THREE stages.                          */
/*                                                                              */
/* Modal shell never unmounts. Sections (slot, title, price, action) occupy     */
/* the EXACT same space across all 3 stages - the price block is always         */
/* rendered with `visibility` toggled, never removed from layout, so nothing    */
/* shifts when the user moves confirm → ready → opened.                         */
/*                                                                              */
/*   confirm → pack hero (aura + float) + price + Unlock Pack                   */
/*   ready   → pack hero in same slot + Open Pack (price block invisible)       */
/*   opened  → same pack image rumbles 3s then explodes (burst + sparks +       */
/*             fog), 3 cards fade in 3.2-3.8s + Equip                           */
/*                                                                              */
/* Action buttons use the standard <Button variant="primary" size="sm">         */
/* primitive so dimensions match every other modal CTA in the app (bind,        */
/* recruit, listing purchase). Pending state on confirm flips Button's          */
/* loading prop for the spinner.                                                */
/* -------------------------------------------------------------------------- */

function PackFlowModalBody({ flow, onConfirm, onOpen, onEquip, onClose }) {
  const { stage, kind, pack, awarded, pending } = flow;
  const tier = pack.id.includes('legendary')
    ? 'legendary'
    : pack.id.includes('premium')
      ? 'premium'
      : 'starter';
  // glowColor still drives the rarity-tinted aura, sparks, burst, and fog
  // via `--glow-color` set on the stage element. The action button is plain
  // teal `<Button variant="primary">` to match every other modal button.
  const glowColor =
    tier === 'legendary'
      ? '#FFD700'
      : tier === 'premium'
        ? '#BB86FC'
        : '#03DAC6';
  const imgSrc =
    kind === 'skin'
      ? `/skin_packs/${pack.id}_pack.webp`
      : `/capsules/${pack.id.replace('capsule-', 'capsule_')}.webp`;

  const title =
    stage === 'confirm'
      ? pack.name
      : stage === 'ready'
        ? 'Ready to Open'
        : 'Pack Opened';

  let buttonLabel;
  let buttonAction;
  if (stage === 'confirm') {
    buttonLabel = 'Unlock Pack';
    buttonAction = onConfirm;
  } else if (stage === 'ready') {
    buttonLabel = 'Open Pack';
    buttonAction = onOpen;
  } else {
    buttonLabel = 'Go to Drones';
    buttonAction = onEquip;
  }

  const showClose = !pending;
  const showPrice = stage === 'confirm';

  return (
    <div
      className={cn(styles.purchaseStage, styles.flowStage)}
      style={{ '--glow-color': glowColor }}
    >
      {showClose && (
        <button
          type="button"
          className={styles.purchaseCloseBtn}
          onClick={onClose}
          aria-label="Close"
        >
          <X size={18} />
        </button>
      )}

      {/* Shared content slot. Same DOM box across all 3 stages. */}
      <div className={styles.flowSlot}>
        {stage !== 'opened' ? (
          <div className={styles.flowPack}>
            <span className={styles.flowAura} aria-hidden="true" />
            <span className={styles.purchaseHeroShadow} aria-hidden="true" />
            <div className={styles.purchaseHeroFloat}>
              <img src={imgSrc} alt="" className={styles.purchaseHeroPack} />
            </div>
          </div>
        ) : (
          <div className={styles.flowReveal}>
            {/* Paint stack: pack (z2) under the orb (z3) which grows from
                the pack's center, then burst (z4) + fog (z5) overlay at
                explosion, cards (z6) on top once they fade in. */}
            <img
              src={imgSrc}
              alt=""
              className={styles.flowExplodingPack}
              aria-hidden="true"
            />
            <span className={styles.flowOrb} aria-hidden="true" />
            <span className={styles.flowBurst} aria-hidden="true" />
            <span className={styles.flowFog} aria-hidden="true" />
            <div className={styles.flowCards}>
              {(awarded ?? []).map((item, i) => (
                <FlowRevealCard
                  key={item.id ?? i}
                  item={item}
                  kind={kind}
                  index={i}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <div
        className={styles.purchaseTitleRow}
        style={{ visibility: stage === 'opened' ? 'hidden' : 'visible' }}
        aria-hidden={stage === 'opened' ? 'true' : undefined}
      >
        <h3
          className={cn(styles.purchaseName, styles[`packCardName_${tier}`])}
        >
          {title}
        </h3>
      </div>

      {/* Price block: ALWAYS rendered, even on ready/opened. visibility is
          toggled instead of conditional render so the section keeps its
          space and nothing in the modal shifts between stages. */}
      <div
        className={styles.flowPriceBlock}
        style={{ visibility: showPrice ? 'visible' : 'hidden' }}
        aria-hidden={showPrice ? undefined : 'true'}
      >
        <span className={styles.flowPriceLabel}>Price</span>
        <div className={styles.flowPriceValue}>
          <VoltIcon size={26} />
          <span>{pack.price.toLocaleString()}</span>
        </div>
      </div>

      <div className={styles.flowActionRow}>
        <Button
          variant="primary"
          size="md"
          className={styles.flowActionBtn}
          onClick={buttonAction}
          disabled={pending && stage === 'confirm'}
          loading={pending && stage === 'confirm'}
        >
          {buttonLabel}
        </Button>
      </div>
    </div>
  );
}

/* Single revealed card inside the stage-3 grid. Same .possibleCard +
   .possibleCard_<rarity> classes as the "What You Could Pull" preview grid
   on the packs screen, so the rarity surface (gradient + border + ambient
   pulses) matches everywhere else in the app. The 3-up grid sizing and
   stagger delay come from .flowCards / .flowCard. */
function FlowRevealCard({ item, kind, index }) {
  return (
    <div
      className={cn(
        styles.possibleCard,
        styles[`possibleCard_${item.rarity}`],
        styles.flowCard,
      )}
      style={{ animationDelay: `${1300 + index * 140}ms` }}
    >
      <div className={styles.possibleInner}>
        {kind === 'capsule' ? (
          <ModPlaceholder
            rarity={item.rarity}
            size={72}
            className={styles.possibleSkinThumb}
          />
        ) : (
          // Revealed skin card shows the actual skin image when one is
          // available (SkinThumb resolves real /skins/...webp URLs and
          // falls back to the rarity-tinted SkinMini prism only when the
          // skin has no image). All four rarities, including legendary,
          // use the same path - the prior legendary-only "L" placeholder
          // hid real legendary art on opens.
          <SkinThumb
            skin={item}
            rarity={item.rarity}
            alt={item.name}
            className={styles.possibleSkinThumb}
          />
        )}
      </div>
      <span className={styles.possibleName}>{item.name}</span>
      <span
        className={cn(
          styles.possibleRarity,
          styles[`rarity_${item.rarity}`],
        )}
      >
        {RARITY_LABELS[item.rarity]}
      </span>
    </div>
  );
}

