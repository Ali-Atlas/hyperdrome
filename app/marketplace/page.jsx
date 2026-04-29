'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Search, Plus, ChevronDown, ChevronRight, X, Check } from 'lucide-react';
import NavShell from '@/components/ui/NavShell';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import Skeleton from '@/components/ui/Skeleton';
import EmptyState from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/Toast';
import { useSession } from '@/hooks/useSession';
import {
  cn,
  getLevelColor,
  getLevelTier,
  getLegendaryTheme,
} from '@/lib/utils';
import DroneImage from '@/components/ui/DroneImage';
import VoltIcon from '@/components/ui/VoltIcon';
import ModPlaceholder from '@/components/ui/ModPlaceholder';
import SkinThumb, { SkinMini } from '@/components/ui/SkinThumb';
import styles from './page.module.css';

const PACK_DEFS = [
  {
    id: 'starter',
    name: 'Starter Pack',
    price: 2_000,
    variant: 'gray',
    contents: '3 Skins - 2 Common guaranteed, 1 Rare or higher',
    description:
      'Cheapest way to start a collection. Two commons plus a wild slot that bumps to rare on every open.',
    slots: [
      { variant: 'common' },
      { variant: 'common' },
      { variant: 'rare', mystery: true },
    ],
    rates: [
      { label: 'Common (×2)', rarity: 'common', chance: 'Guaranteed' },
      { label: 'Rare', rarity: 'rare', chance: '70%' },
      { label: 'Epic', rarity: 'epic', chance: '25%' },
      { label: 'Legendary', rarity: 'legendary', chance: '5%' },
    ],
    buttonVariant: 'secondary',
  },
  {
    id: 'premium',
    name: 'Premium Pack',
    price: 25_000,
    variant: 'purple',
    contents: '3 Skins - 1 Rare guaranteed, 1 Epic or higher, 1 any rarity',
    description:
      'Guaranteed rare plus an epic-or-better slot. The sweet spot between cost and shot at a legendary.',
    pills: [
      { label: 'Most Popular', tone: 'accent' },
      { label: 'Save 30% vs Singles', tone: 'muted' },
    ],
    slots: [
      { variant: 'rare' },
      { variant: 'epic' },
      { variant: 'rainbow', mystery: true },
    ],
    rates: [
      { label: 'Rare (guaranteed)', rarity: 'rare', chance: '100%' },
      { label: 'Epic (slot 2)', rarity: 'epic', chance: '60%' },
      { label: 'Legendary (slot 2)', rarity: 'legendary', chance: '40%' },
      { label: 'Wild slot - any rarity', rarity: 'epic', chance: '40% / 35% / 20% / 5%' },
    ],
    buttonVariant: 'primary',
  },
  {
    id: 'legendary',
    name: 'Legendary Pack',
    price: 100_000,
    variant: 'gold',
    contents: '3 Skins - 1 Epic guaranteed, 1 Legendary, 1 Rare or higher',
    description:
      '1 Epic guaranteed · 1 Legendary guaranteed · 1 Rare+ wild slot.',
    slots: [
      { variant: 'epic' },
      { variant: 'legendary' },
      { variant: 'rainbow', mystery: true },
    ],
    rates: [
      { label: 'Epic (guaranteed)', rarity: 'epic', chance: '100%' },
      { label: 'Legendary (guaranteed)', rarity: 'legendary', chance: '100%' },
      { label: 'Rare+ (slot 3)', rarity: 'rare', chance: '30% / 50% / 20%' },
    ],
    buttonVariant: 'gold',
  },
];

/* 6-card preview composition per pack id. Mirrors the drop-table emphasis
 * (starter leans common, premium leans rare/epic, legendary leans epic/leg)
 * so users see real examples of what each pack tends to yield. Items are
 * sampled from the live image-backed catalog. Only the rarities listed
 * here are sampled - other rarities the pack can technically drop are
 * still drop-eligible; the preview just doesn't surface them. */
const PREVIEW_DISTRIBUTION = {
  starter:   ['common', 'common', 'common', 'rare', 'rare', 'epic'],
  premium:   ['rare', 'rare', 'epic', 'epic', 'legendary', 'legendary'],
  legendary: ['rare', 'epic', 'epic', 'legendary', 'legendary', 'legendary'],
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

// Aggregate rarity % per pack across all 3 slots. Mirrors the probabilities
// encoded in services/pack.service.js PACK_SLOTS so the visual odds bar
// and the backend roller stay in sync.
const PACK_ODDS = {
  starter:   { common: 66.7, rare: 23.3, epic: 8.3,  legendary: 1.7  },
  premium:   { common: 13.3, rare: 45.0, epic: 26.7, legendary: 15.0 },
  legendary: { common: 0,    rare: 10.0, epic: 50.0, legendary: 40.0 },
};

/* Capsule (mod) packs - parallel to skin packs but yielding mods. Content is
 * display-only for now; opening logic will wire later. Visual structure
 * mirrors the skin packs (variant colors, pills, three-tier hierarchy). */
const CAPSULE_PACK_DEFS = [
  {
    id: 'capsule-starter',
    name: 'Starter Capsule',
    price: 1_000,
    variant: 'gray',
    description:
      '3 mods to boost your drone. Common-heavy with a chance at rare.',
    buttonVariant: 'secondary',
  },
  {
    id: 'capsule-premium',
    name: 'Premium Capsule',
    price: 12_000,
    variant: 'purple',
    description:
      'Guaranteed rare plus an epic-or-better slot. Best value for competitive upgrades.',
    pills: [
      { label: 'Most Popular', tone: 'accent' },
      { label: 'Save 30% vs Singles', tone: 'muted' },
    ],
    buttonVariant: 'primary',
  },
  {
    id: 'capsule-legendary',
    name: 'Legendary Capsule',
    price: 50_000,
    variant: 'gold',
    description:
      '1 Epic guaranteed · 1 Legendary guaranteed · 1 Rare+ wild slot. The only way to pull exclusive legendary mods.',
    buttonVariant: 'gold',
  },
];

const CAPSULE_PACK_ODDS = {
  'capsule-starter':   { common: 67, rare: 23, epic: 8,  legendary: 2  },
  'capsule-premium':   { common: 13, rare: 45, epic: 27, legendary: 15 },
  'capsule-legendary': { common: 0,  rare: 10, epic: 50, legendary: 40 },
};

const CAPSULE_PREVIEW_DISTRIBUTION = {
  'capsule-starter':   ['common', 'common', 'common', 'rare', 'rare', 'epic'],
  'capsule-premium':   ['rare', 'rare', 'epic', 'epic', 'legendary', 'legendary'],
  'capsule-legendary': ['epic', 'epic', 'epic', 'legendary', 'legendary', 'legendary'],
};


export default function MarketplacePage() {
  const { user } = useSession();
  const { showToast } = useToast();

  const [tab, setTab] = useState('drones'); // 'drones' | 'mods' | 'skins' | 'packs' | 'points'
  const [view, setView] = useState('all'); // 'all' | 'mine'
  const [packOpening, setPackOpening] = useState(null); // pack id currently being opened
  const [packReveal, setPackReveal] = useState(null); // { awarded, packType }
  const [packRevealStep, setPackRevealStep] = useState(0);
  const [packOpened, setPackOpened] = useState(false);
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
  // Pack purchase confirmation modal: { kind: 'skin'|'capsule', pack }
  const [packBuyModal, setPackBuyModal] = useState(null);
  const [packBuyCapsuleNote, setPackBuyCapsuleNote] = useState(false);
  const [listModal, setListModal] = useState(false);
  const [listingType, setListingType] = useState('drone');
  const [listingItemId, setListingItemId] = useState('');
  const [listingPrice, setListingPrice] = useState('');
  const [listingPending, setListingPending] = useState(false);
  const [ownedInactive, setOwnedInactive] = useState([]);
  const [ownedSkins, setOwnedSkins] = useState([]);
  const [ownedUnboundMods, setOwnedUnboundMods] = useState([]);

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

  const ROWS_PER_PAGE = 3;
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

  const fee = listingPrice ? Math.floor(Number(listingPrice) * 0.05) : 0;
  const payout = listingPrice ? Number(listingPrice) - fee : 0;

  const userPoints = user?.points ?? 0;

  // Click on a "Buy Pack" CTA - opens the cinematic confirmation modal.
  // Skin packs and capsule packs share the modal layout; the kind drives
  // image src + Confirm action + the message shown after Confirm.
  const openPackBuyModal = (kind, pack) => {
    if (!user) {
      showToast('Sign in to buy packs.', 'error');
      return;
    }
    setPackBuyModal({ kind, pack });
    setPackBuyCapsuleNote(false);
  };

  const closePackBuyModal = () => {
    if (packOpening) return;
    setPackBuyModal(null);
    setPackBuyCapsuleNote(false);
  };

  // Skin pack confirm path. Hits the existing pack-open API; on success
  // closes the buy modal and triggers the reveal modal flow. On failure,
  // surfaces the error as a toast (matching every other error path in
  // the app) and leaves the buy modal open so the user can retry.
  const confirmSkinPackPurchase = async () => {
    if (!packBuyModal || packBuyModal.kind !== 'skin') return;
    const packId = packBuyModal.pack.id;
    setPackOpening(packId);
    try {
      const res = await fetch('/api/marketplace/packs/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packType: packId }),
      });
      const body = await res.json();
      if (!res.ok) {
        showToast(body?.error || 'Pack purchase failed', 'error');
        return;
      }
      const awarded = body.data?.awarded ?? [];
      setPackBuyModal(null);
      // kind:'skin' for now since only skin pack opens reach this path.
      // When mod-capsule open lands, the mod-confirm callback will pass
      // kind:'mod' and the reveal modal will switch shapes accordingly.
      setPackReveal({ awarded, packType: packId, kind: 'skin' });
      setPackRevealStep(0);
      setPackOpened(false);
    } catch (err) {
      showToast(String(err), 'error');
    } finally {
      setPackOpening(null);
    }
  };

  // Capsule pack confirm path - no backend wired yet. Shows a quiet
  // inline note under the CTA.
  const confirmCapsulePackPurchase = () => {
    setPackBuyCapsuleNote(true);
  };

  const handleRevealPack = () => {
    if (!packReveal) return;
    setPackOpened(true);
    // Stagger reveals 500ms apart.
    packReveal.awarded.forEach((_, i) => {
      setTimeout(
        () => setPackRevealStep((s) => Math.max(s, i + 1)),
        (i + 1) * 500,
      );
    });
  };

  const closePackReveal = () => {
    setPackReveal(null);
    setPackRevealStep(0);
    setPackOpened(false);
  };

  return (
    <NavShell>
      <div className={styles.page}>
        {/* ---- Top row: tabs + list-item (left), balance (right) ---- */}
        <div className={styles.topRow}>
          <div className={styles.topLeft}>
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
          </div>

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
          <aside className={styles.filters}>
            <div className={styles.filtersInner}>
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
                openingId={packOpening}
                onOpen={(packId) =>
                  openPackBuyModal(
                    'skin',
                    PACK_DEFS.find((p) => p.id === packId),
                  )
                }
                onOpenCapsule={(pack) => openPackBuyModal('capsule', pack)}
              />
            ) : loading ? (
              <div className={styles.grid}>
                <Skeleton variant="card" height={260} />
                <Skeleton variant="card" height={260} />
                <Skeleton variant="card" height={260} />
                <Skeleton variant="card" height={260} />
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

      {/* ---- Pack purchase confirmation modal (skin packs + capsules) ---- */}
      <Modal
        isOpen={!!packBuyModal}
        onClose={closePackBuyModal}
        chromeless
        className={styles.purchaseModal}
        overlayClassName={styles.purchaseOverlay}
      >
        {packBuyModal && (
          <PackPurchaseModalBody
            kind={packBuyModal.kind}
            pack={packBuyModal.pack}
            pending={packOpening !== null}
            capsuleNote={packBuyCapsuleNote}
            onConfirm={
              packBuyModal.kind === 'skin'
                ? confirmSkinPackPurchase
                : confirmCapsulePackPurchase
            }
            onClose={closePackBuyModal}
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
        onClose={() => setListModal(false)}
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
                5% (<VoltIcon size={11} />
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

      {/* ---- Pack reveal modal (Ready to Open + Opened in same shell) ---- */}
      <Modal
        isOpen={!!packReveal}
        onClose={closePackReveal}
        chromeless
        className={styles.purchaseModal}
        overlayClassName={styles.purchaseOverlay}
      >
        {packReveal && (
          <PackRevealModalBody
            packReveal={packReveal}
            packOpened={packOpened}
            packRevealStep={packRevealStep}
            onReveal={handleRevealPack}
            onClose={closePackReveal}
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

function SalesTape({ transactions, page, hasMore, onPrev, onNext }) {
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
        <ul className={styles.tapeList}>
          {transactions.map((t) => {
            const name =
              t.drone?.name ??
              t.skin?.name ??
              t.mod?.name ??
              (t.itemType === 'drone'
                ? 'Drone'
                : t.itemType === 'mod'
                  ? 'Mod'
                  : 'Skin');
            const typePill =
              t.itemType === 'skin'
                ? t.skin?.rarity
                : t.itemType === 'mod'
                  ? t.mod?.rarity
                  : null;
            return (
              <li key={t.id} className={styles.tapeRow}>
                <span
                  className={cn(
                    styles.tapeTypePill,
                    typePill && styles[`rarity_${typePill}`],
                    t.itemType === 'drone' && styles.tapePillDrone,
                  )}
                >
                  {t.itemType}
                </span>
                <span className={styles.tapeName}>{name}</span>
                <span className={styles.tapeMeta}>
                  {formatRelativeTime(t.soldAt)}
                  {t.buyer?.username ? ` · by ${t.buyer.username}` : ''}
                </span>
                <span className={styles.tapePrice}>
                  <VoltIcon size={11} />
                  {Number(t.price).toLocaleString()}
                </span>
              </li>
            );
          })}
        </ul>
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
        const grouped = {};
        for (const skin of body.data) {
          if (!grouped[skin.rarity]) grouped[skin.rarity] = [];
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
  const distribution = CAPSULE_PREVIEW_DISTRIBUTION[packId] ?? [];
  return (
    <div className={styles.possibleGroup}>
      <span className={styles.possibleLabel}>What You Could Pull</span>
      <div className={styles.possibleGrid}>
        {distribution.map((rarity, i) => (
          <CapsulePossibleCard key={i} rarity={rarity} />
        ))}
      </div>
    </div>
  );
}

function CapsulePossibleCard({ rarity }) {
  const isLegendary = rarity === 'legendary';
  return (
    <div className={cn(styles.possibleCard, styles[`possibleCard_${rarity}`])}>
      <div className={styles.possibleInner}>
        {isLegendary ? (
          <span className={styles.possibleL} aria-hidden="true">L</span>
        ) : (
          <ModPlaceholder
            rarity={rarity}
            size={120}
            className={styles.possibleModChip}
          />
        )}
      </div>
      <span
        className={cn(styles.possibleRarity, styles[`rarity_${rarity}`])}
      >
        {RARITY_LABELS[rarity]}
      </span>
    </div>
  );
}

/* Odds as colored text, one entry per rarity present in the pack.
   Accepts an explicit `odds` map (used by capsule packs); otherwise
   falls back to PACK_ODDS lookup by packId (used by skin packs). */
function OddsText({ packId, odds: oddsProp }) {
  const odds = oddsProp ?? PACK_ODDS[packId];
  if (!odds) return null;
  const entries = RARITY_LIST.filter((r) => odds[r] > 0);
  return (
    <div className={styles.oddsText}>
      {entries.map((r, i) => (
        <span key={r} className={styles.oddsTextItem}>
          <span className={cn(styles.oddsTextLabel, styles[`rarity_${r}`])}>
            {RARITY_LABELS[r]}
          </span>{' '}
          <span className={styles.oddsTextValue}>{Math.round(odds[r])}%</span>
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

  // CTA themed to match the item being purchased. Drone level tier color,
  // legendary-skin drone uses the legendary glow1, mods/skins use rarity
  // tokens. Common (low-contrast grey) takes white text; everything else
  // takes black. Threaded into .purchaseCta via --cta-bg / --cta-text.
  const ctaBg = isDrone
    ? drone?.appliedSkin?.rarity === 'legendary'
      ? getLegendaryTheme(drone.appliedSkin?.name).glow1
      : `var(--level-${getLevelTier(drone?.level ?? 1)})`
    : isSkin || isMod
      ? `var(--rarity-${rarity})`
      : 'var(--accent-primary)';
  const ctaText =
    !isDrone && (isMod || isSkin) && rarity === 'common' ? '#fff' : '#000';

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

          <p className={styles.purchaseFee}>5% marketplace fee included</p>
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Pack purchase confirmation modal body                                       */
/*                                                                             */
/* Shared by skin packs (kind='skin') and capsule packs (kind='capsule').      */
/* Skin path hits the existing pack-open API on Confirm; capsule path is a     */
/* display-only flow that surfaces a quiet "launching soon" line under the     */
/* CTA. Reuses the listing purchase modal's hero/title/divider/price/CTA       */
/* classes so the two confirmation styles read as the same family.             */
/* -------------------------------------------------------------------------- */

function PackPurchaseModalBody({
  kind,
  pack,
  pending,
  capsuleNote,
  onConfirm,
  onClose,
}) {
  const tier = pack.id.includes('legendary')
    ? 'legendary'
    : pack.id.includes('premium')
      ? 'premium'
      : 'starter';
  const imgSrc =
    kind === 'skin'
      ? `/skin_packs/${pack.id}_pack.webp`
      : `/capsules/${pack.id.replace('capsule-', 'capsule_')}.webp`;
  const glowColor =
    tier === 'legendary'
      ? '#FFD700'
      : tier === 'premium'
        ? '#BB86FC'
        : '#03DAC6';
  // CTA themed per pack tier - starter teal, premium purple, legendary
  // gold. All three take black text. Threaded into .purchaseCta via the
  // --cta-bg / --cta-text custom properties.
  const ctaBg =
    tier === 'legendary'
      ? 'var(--rarity-legendary)'
      : tier === 'premium'
        ? 'var(--accent-secondary)'
        : 'var(--accent-primary)';
  const showClose = !pending;

  return (
    <div className={styles.purchaseStage} style={{ '--glow-color': glowColor }}>
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
        <span className={styles.purchaseHeroShadow} aria-hidden="true" />
        <div className={styles.purchaseHeroFloat}>
          <img
            src={imgSrc}
            alt=""
            className={styles.purchaseHeroPack}
          />
        </div>
      </div>

      <div className={styles.purchaseTitleRow}>
        <h3
          className={cn(styles.purchaseName, styles[`packCardName_${tier}`])}
        >
          {pack.name}
        </h3>
      </div>

      <hr className={styles.purchaseDivider} aria-hidden="true" />

      <div className={styles.purchasePriceRow}>
        <VoltIcon size={24} />
        <span className={styles.purchasePrice}>
          {pack.price.toLocaleString()}
        </span>
      </div>

      <button
        type="button"
        className={styles.purchaseCta}
        style={{ '--cta-bg': ctaBg, '--cta-text': '#000' }}
        onClick={onConfirm}
        disabled={pending}
      >
        {pending ? (
          <span className={styles.purchaseProcessing}>Processing...</span>
        ) : (
          'Confirm Purchase'
        )}
      </button>

      {capsuleNote && (
        <div className={styles.purchasePackNote}>
          Capsule packs launching soon
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Pack reveal modal body (Ready to Open + Opened)                             */
/*                                                                             */
/* Two stages share one shell so the user perceives a single "pack" modal      */
/* that flips its cards. Stage 1 shows 3 face-down placeholder cards using     */
/* the same .possibleCard / .possibleCard_<rarity> styling as the pack         */
/* preview grid in the packs section, so the rarity-tinted backs match the     */
/* user's expectation from the previews. Stage 2 reveals the awarded skins    */
/* in those same slots, styled identically to PossibleCard.                    */
/* -------------------------------------------------------------------------- */

function PackRevealModalBody({
  packReveal,
  packOpened,
  packRevealStep,
  onReveal,
  onClose,
}) {
  const { awarded, packType, kind = 'skin' } = packReveal;
  const tier =
    packType === 'legendary' || packType === 'premium' ? packType : 'starter';
  const glowColor =
    tier === 'legendary'
      ? '#FFD700'
      : tier === 'premium'
        ? '#BB86FC'
        : '#03DAC6';
  const ctaBg =
    tier === 'legendary'
      ? 'var(--rarity-legendary)'
      : tier === 'premium'
        ? 'var(--accent-secondary)'
        : 'var(--accent-primary)';

  return (
    <div className={styles.purchaseStage} style={{ '--glow-color': glowColor }}>
      <button
        type="button"
        className={styles.purchaseCloseBtn}
        onClick={onClose}
        aria-label="Close"
      >
        <X size={18} />
      </button>

      <div className={styles.purchaseTitleRow}>
        <h3
          className={cn(styles.purchaseName, styles[`packCardName_${tier}`])}
        >
          {packOpened ? 'Pack Opened' : 'Ready to Open'}
        </h3>
      </div>

      <div className={styles.revealGrid}>
        {awarded.map((skin, i) => {
          const isLegendary = skin.rarity === 'legendary';
          const isVisible = packOpened && i < packRevealStep;
          return (
            <div
              key={skin.id}
              className={cn(
                styles.possibleCard,
                styles[`possibleCard_${skin.rarity}`],
                isVisible && styles.revealVisible,
              )}
            >
              <div className={styles.possibleInner}>
                {!isVisible ? (
                  // Placeholder: SkinMini diamond for skin packs,
                  // ModPlaceholder hex chip for mod capsules. Both
                  // rarity-tinted so the rarity reads pre-reveal.
                  kind === 'mod' ? (
                    <ModPlaceholder
                      rarity={skin.rarity}
                      size={72}
                      className={styles.possibleSkinThumb}
                    />
                  ) : (
                    <span className={styles.possibleSkinThumb}>
                      <SkinMini rarity={skin.rarity} />
                    </span>
                  )
                ) : kind === 'mod' ? (
                  <ModPlaceholder
                    rarity={skin.rarity}
                    size={72}
                    className={styles.possibleSkinThumb}
                  />
                ) : isLegendary ? (
                  <span className={styles.possibleL} aria-hidden="true">L</span>
                ) : (
                  <SkinThumb
                    skin={skin}
                    rarity={skin.rarity}
                    alt={skin.name}
                    className={styles.possibleSkinThumb}
                  />
                )}
              </div>
              <span className={styles.possibleName}>
                {isVisible ? skin.name : ' '}
              </span>
              <span
                className={cn(
                  styles.possibleRarity,
                  styles[`rarity_${skin.rarity}`],
                  !isVisible && styles.revealHiddenLabel,
                )}
              >
                {RARITY_LABELS[skin.rarity]}
              </span>
            </div>
          );
        })}
      </div>

      {/* Bottom action row only on stage 1. The opened stage relies on
          the top-right X to close - one affordance, no duplicate. */}
      {!packOpened && (
        <div className={styles.revealActions}>
          <button
            type="button"
            className={styles.modalSecondaryBtn}
            onClick={onClose}
          >
            Save for Later
          </button>
          <button
            type="button"
            className={styles.purchaseCta}
            style={{ '--cta-bg': ctaBg, '--cta-text': '#000' }}
            onClick={onReveal}
          >
            Open Pack
          </button>
        </div>
      )}
    </div>
  );
}

