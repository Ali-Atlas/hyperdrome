'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Search, Plus, ChevronDown, ChevronRight, Check } from 'lucide-react';
import NavShell from '@/components/ui/NavShell';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import Skeleton from '@/components/ui/Skeleton';
import EmptyState from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/Toast';
import { useSession } from '@/hooks/useSession';
import { cn, getLevelColor, getLevelTier } from '@/lib/utils';
import DroneImage from '@/components/ui/DroneImage';
import VoltIcon from '@/components/ui/VoltIcon';
import ModPlaceholder from '@/components/ui/ModPlaceholder';
import styles from './page.module.css';

const PACK_DEFS = [
  {
    id: 'starter',
    name: 'Starter Pack',
    price: 500,
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
    possible: [
      { name: 'Carbon Fiber', rarity: 'common' },
      { name: 'Chrome Plate', rarity: 'common' },
      { name: 'Neon Pulse', rarity: 'rare' },
      { name: 'Prism', rarity: 'rare' },
      { name: 'Hologram', rarity: 'rare' },
      { name: 'Thunder Strike', rarity: 'epic', mystery: true },
    ],
  },
  {
    id: 'premium',
    name: 'Premium Pack',
    price: 2_000,
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
    possible: [
      { name: 'Neon Pulse', rarity: 'rare' },
      { name: 'Synthwave', rarity: 'rare' },
      { name: 'Data Stream', rarity: 'rare' },
      { name: 'Void Walker', rarity: 'epic' },
      { name: 'Inferno Core', rarity: 'epic' },
      { name: 'Hyperion', rarity: 'legendary', mystery: true },
    ],
  },
  {
    id: 'legendary',
    name: 'Legendary Pack',
    price: 10_000,
    variant: 'gold',
    contents: '3 Skins - 1 Epic guaranteed, 1 Legendary, 1 Rare or higher',
    description:
      '1 Epic guaranteed · 1 Legendary guaranteed · 1 Rare+ wild slot. The only way to pull Mach Zero, Overdrive, or Apex Prime.',
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
    possible: [
      { name: 'Thunder Strike', rarity: 'epic' },
      { name: 'Celestial Guard', rarity: 'epic' },
      { name: 'Tidal Surge', rarity: 'epic' },
      { name: 'Mach Zero', rarity: 'legendary' },
      { name: 'Overdrive', rarity: 'legendary' },
      { name: 'Apex Prime', rarity: 'legendary' },
    ],
  },
];

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


export default function MarketplacePage() {
  const { user } = useSession();
  const { showToast } = useToast();

  const [tab, setTab] = useState('drones'); // 'drones' | 'mods' | 'skins' | 'packs' | 'points'
  const [view, setView] = useState('all'); // 'all' | 'mine'
  const [packOpening, setPackOpening] = useState(null); // pack id currently being opened
  const [packReveal, setPackReveal] = useState(null); // { awarded, packType }
  const [packRevealStep, setPackRevealStep] = useState(0);
  const [listings, setListings] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({
    minPrice: '',
    maxPrice: '',
    minLevel: '',
    maxLevel: '',
    rarities: [],
    sort: 'priceHigh',
  });
  const [search, setSearch] = useState('');

  // Modals
  const [buyModal, setBuyModal] = useState(null);
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
        limit: '20',
      });
      const res = await fetch(`/api/marketplace?${params.toString()}`);
      const body = await res.json();
      if (body?.data) setTransactions(body.data.items ?? []);
    } catch {
      setTransactions([]);
    }
  }, [tab]);

  const fetchMine = useCallback(async () => {
    if (!user?.id) return;
    try {
      const [drones, skins, mods] = await Promise.all([
        fetch('/api/drones').then((r) => r.json()).catch(() => null),
        fetch('/api/skins').then((r) => r.json()).catch(() => null),
        fetch('/api/mods').then((r) => r.json()).catch(() => null),
      ]);
      if (drones?.data) setOwnedInactive(drones.data.filter((d) => !d.active));
      if (skins?.data) setOwnedSkins(skins.data);
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
      }, 1500);
    } catch (err) {
      setBuyError(String(err));
    } finally {
      setBuyPending(false);
    }
  };

  const handleCancel = async (id) => {
    try {
      const res = await fetch(`/api/marketplace/${id}/cancel`, { method: 'POST' });
      const body = await res.json();
      if (!res.ok) {
        showToast(body?.error || 'Cancel failed', 'error');
      } else {
        showToast('Listing cancelled', 'success');
        await fetchListings();
      }
    } catch (err) {
      showToast(String(err), 'error');
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

  const handleOpenPack = async (packId) => {
    if (!user) {
      showToast('Sign in to open packs.', 'error');
      return;
    }
    setPackOpening(packId);
    try {
      const res = await fetch('/api/marketplace/packs/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packType: packId }),
      });
      const body = await res.json();
      if (!res.ok) {
        showToast(body?.error || 'Pack open failed', 'error');
        return;
      }
      const awarded = body.data?.awarded ?? [];
      setPackReveal({ awarded, packType: packId });
      setPackRevealStep(0);
      // Stagger reveals 500ms apart.
      awarded.forEach((_, i) => {
        setTimeout(
          () => setPackRevealStep((s) => Math.max(s, i + 1)),
          (i + 1) * 500,
        );
      });
    } catch (err) {
      showToast(String(err), 'error');
    } finally {
      setPackOpening(null);
    }
  };

  const closePackReveal = () => {
    setPackReveal(null);
    setPackRevealStep(0);
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
            {tab !== 'packs' && tab !== 'points' && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => setListModal(true)}
              >
                <Plus size={12} aria-hidden="true" /> List Item
              </Button>
            )}
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
                      sort: 'priceHigh',
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
                onOpen={handleOpenPack}
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
                        onCancel={() => handleCancel(listing.id)}
                      />
                    );
                    // Drone cards navigate to the public drone profile. Skin
                    // cards have no detail page yet, so stay non-clickable.
                    const droneId =
                      listing.itemType === 'drone' ? listing.drone?.id : null;
                    if (droneId) {
                      return (
                        <Link
                          key={listing.id}
                          href={`/drones/${droneId}`}
                          className={styles.cardLink}
                        >
                          {card}
                        </Link>
                      );
                    }
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
          <SalesTape transactions={transactions} />
        )}
      </div>

      {/* ---- Purchase confirmation modal (drones / mods / skins) ---- */}
      <Modal
        isOpen={!!buyModal}
        onClose={closePurchaseModal}
        title="Confirm Purchase"
        size="sm"
        className={styles.purchaseModal}
      >
        {buyModal && (
          <PurchaseModalBody
            listing={buyModal}
            userPoints={userPoints}
            pending={buyPending}
            success={buySuccess}
            error={buyError}
            onConfirm={handleBuy}
          />
        )}
      </Modal>

      {/* ---- List modal ---- */}
      <Modal
        isOpen={listModal}
        onClose={() => setListModal(false)}
        title="List Item for Sale"
        size="md"
      >
        <div className={styles.modalBody}>
          <div className={styles.formRow}>
            <label className={styles.filterLabel}>Item Type</label>
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

          <div className={styles.formRow}>
            <label className={styles.filterLabel}>
              {listingType === 'drone'
                ? 'Choose drone (must be inactive)'
                : listingType === 'skin'
                  ? 'Choose skin'
                  : 'Choose mod (unbound only)'}
            </label>
            <select
              className={styles.select}
              value={listingItemId}
              onChange={(e) => setListingItemId(e.target.value)}
            >
              <option value="">Select one…</option>
              {(listingType === 'drone'
                ? ownedInactive
                : listingType === 'skin'
                  ? ownedSkins
                  : ownedUnboundMods
              ).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                  {listingType === 'drone'
                    ? ` - LV ${item.level}`
                    : ` - ${item.rarity}`}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.formRow}>
            <label className={styles.filterLabel}>Price (volts)</label>
            <input
              type="number"
              inputMode="numeric"
              className={styles.rangeInput}
              placeholder="1000"
              value={listingPrice}
              onChange={(e) => setListingPrice(e.target.value)}
            />
            <div className={styles.feeInfo}>
              Platform fee:{' '}
              <strong>
                5% (<VoltIcon size={11} />
                {fee})
              </strong>{' '}
              · You receive:{' '}
              <strong className={styles.mono}>
                <VoltIcon size={11} />
                {payout}
              </strong>
            </div>
          </div>

          <div className={styles.modalActions}>
            <Button variant="secondary" onClick={() => setListModal(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleCreateListing}
              loading={listingPending}
            >
              List for Sale
            </Button>
          </div>
        </div>
      </Modal>

      {/* ---- Pack reveal modal ---- */}
      <Modal
        isOpen={!!packReveal}
        onClose={closePackReveal}
        title="Pack Opened"
        size="md"
      >
        {packReveal && (
          <div className={styles.revealWrap}>
            <div className={styles.revealGrid}>
              {packReveal.awarded.map((skin, i) => (
                <div
                  key={skin.id}
                  className={cn(
                    styles.revealCard,
                    styles[`card_${skin.rarity}`],
                    i < packRevealStep && styles.revealVisible,
                  )}
                >
                  <div className={styles.revealImage}>
                    <SkinMini rarity={skin.rarity} />
                  </div>
                  <div className={styles.revealName}>{skin.name}</div>
                  <Badge variant="rarity" value={skin.rarity} />
                </div>
              ))}
            </div>
            <div className={styles.revealActions}>
              <Button variant="secondary" onClick={closePackReveal}>
                Close
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  setTab('skins');
                  setView('mine');
                  closePackReveal();
                }}
              >
                View in Inventory
              </Button>
            </div>
          </div>
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

function SalesTape({ transactions }) {
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
        <div className={styles.tapeEmpty}>No completed sales yet.</div>
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

function PacksShowcase({ userPoints, openingId, onOpen }) {
  const legendary = PACK_DEFS.find((p) => p.id === 'legendary');
  const premium = PACK_DEFS.find((p) => p.id === 'premium');
  const starter = PACK_DEFS.find((p) => p.id === 'starter');

  const packProps = (pack) => ({
    pack,
    canAfford: userPoints >= pack.price,
    pointsShort: Math.max(0, pack.price - userPoints),
    isOpening: openingId === pack.id,
    onOpen: () => onOpen(pack.id),
  });

  return (
    <div className={styles.packsShowcase}>
      <LiveTicker />
      <LegendaryHero {...packProps(legendary)} />
      <div className={styles.packsRow}>
        <PackCard {...packProps(premium)} />
        <PackCard {...packProps(starter)} />
      </div>
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
  return (
    <div className={styles.pointsShowcase}>
      <div className={styles.pointsHeader}>
        <h2 className={styles.pointsTitle}>GET VOLTS</h2>
        <p className={styles.pointsSubtitle}>Better value the more you buy</p>
      </div>
      <div className={styles.pointsGrid}>
        {POINTS_OPTIONS.map((opt) => (
          <PointsCard key={opt.id} opt={opt} />
        ))}
      </div>
    </div>
  );
}

function PointsCard({ opt }) {
  return (
    <article className={styles.pointsCard}>
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
        className={cn(
          styles.pointsBuyBtn,
          styles[`pointsBuyBtn_${opt.tier}`],
        )}
        disabled
      >
        Buy
      </button>
    </article>
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
      className={cn(styles.packCard, styles[`pack_${pack.variant}`], styles.packCardHero)}
    >
      <div className={styles.heroGrid}>
        <div className={styles.heroInfo}>
          <span className={styles.packSubtitle}>Legendary Pack</span>
          <p className={styles.heroDescription}>{pack.description}</p>
          <OddsText packId={pack.id} />
          <PossibleGroup items={pack.possible} />
          <div className={styles.heroActions}>
            <Button
              variant="secondary"
              onClick={onOpen}
              disabled={!canAfford || isOpening}
              loading={isOpening}
              className={cn(styles.packBtn, styles.packBtnGold)}
            >
              {!canAfford ? (
                <>
                  Need +<VoltIcon size={12} style={{ color: 'currentColor' }} />
                  {pointsShort.toLocaleString()}
                </>
              ) : (
                <>
                  Open Pack · <VoltIcon size={12} style={{ color: 'currentColor' }} />
                  {pack.price.toLocaleString()}
                </>
              )}
            </Button>
            <span className={styles.heroHint}>Earn volts by racing</span>
          </div>
        </div>
        <div className={styles.heroCardWrap} aria-hidden="true">
          <LegendaryParticles />
          <div className={styles.bigLegendaryCard}>
            <span className={styles.bigCardL}>L</span>
            <span className={styles.bigCardLabel}>Legendary</span>
          </div>
        </div>
      </div>
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
  return (
    <article className={cn(styles.packCard, styles[`pack_${pack.variant}`])}>
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
        /* Invisible spacer keeps Starter's header row aligned with
           Premium's (which has the Most Popular / Save pills above). */
        <div className={styles.pillRowSpacer} aria-hidden="true" />
      )}
      <div className={styles.packHead}>
        <h3 className={styles.packName}>{pack.name}</h3>
        <span className={styles.packPrice}>
          <VoltIcon size={14} />
          {pack.price.toLocaleString()}
        </span>
      </div>
      <OddsText packId={pack.id} />
      <PossibleGroup items={pack.possible} />
      <div className={styles.packCtaRow}>
        <Button
          variant={pack.buttonVariant === 'gold' ? 'secondary' : pack.buttonVariant}
          onClick={onOpen}
          disabled={!canAfford || isOpening}
          loading={isOpening}
          className={cn(
            styles.packBtn,
            pack.buttonVariant === 'gold' && styles.packBtnGold,
          )}
        >
          {!canAfford ? (
            <>
              Need +<VoltIcon size={12} style={{ color: 'currentColor' }} />
              {pointsShort.toLocaleString()}
            </>
          ) : (
            <>
              Open Pack · <VoltIcon size={12} style={{ color: 'currentColor' }} />
              {pack.price.toLocaleString()}
            </>
          )}
        </Button>
      </div>
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

/* Tier image used as the drone-outline silhouette inside each possible card.
   Rarity maps to tier so the silhouette roughly matches the drone-class the
   skin would apply to (common→tier 1, legendary→tier 4). */
const POSSIBLE_TIER_IMG = {
  common: '/drones/tier-1.webp',
  rare: '/drones/tier-2.webp',
  epic: '/drones/tier-3.webp',
  legendary: '/drones/tier-4.webp',
};

function PossibleCard({ item }) {
  return (
    <div className={cn(styles.possibleCard, styles[`possibleCard_${item.rarity}`])}>
      <div className={styles.possibleInner}>
        <div
          className={cn(styles.possibleDrone, styles[`possibleDrone_${item.rarity}`])}
          style={{ '--drone-img': `url(${POSSIBLE_TIER_IMG[item.rarity]})` }}
          aria-hidden="true"
        />
        {item.mystery && <span className={styles.possibleMystery}>?</span>}
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


/* Odds as colored text, one entry per rarity present in the pack. */
function OddsText({ packId }) {
  const odds = PACK_ODDS[packId];
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

  // Skin rarity treatment layers on top of the level tint. Common
  // skins get no treatment (spec: stays default).
  const skinRarity = drone?.appliedSkin?.rarity;
  const skinRarityClass =
    isDrone && skinRarity && skinRarity !== 'common'
      ? styles[`skinRarity_${skinRarity}`]
      : '';

  return (
    <Card
      className={cn(
        styles.listingCard,
        rarityClass,
        levelClass,
        skinRarityClass,
        isOwner && styles.cardMine,
        !isDrone && rarity === 'legendary' && styles.cardLegendaryShimmer,
      )}
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
          <ModPlaceholder rarity={rarity} size={92} />
        ) : (
          <SkinMini rarity={rarity} />
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

        <div className={styles.priceRow}>
          <VoltIcon size={13} />
          <span className={styles.price}>
            {listing.price.toLocaleString()}
          </span>
        </div>

        <div className={styles.seller}>
          by{' '}
          {listing.seller?.username ? (
            <span
              className={styles.sellerLink}
              role="link"
              tabIndex={0}
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

        {/* Wrapper swallows the click so the surrounding Link (drone cards)
            doesn't also fire navigation when Buy/Cancel is pressed. */}
        <div
          className={styles.cardBtnWrap}
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
              Cancel Listing
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
                  Need +<VoltIcon size={11} style={{ color: 'currentColor' }} />
                  {pointsShort.toLocaleString()}
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </Card>
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
/* Skin preview placeholder                                                   */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/* Purchase confirmation modal body. Branches on listing.itemType to render   */
/* an item-specific hero + meta block; shared bottom (price, balance, CTA).   */
/* Kept as a sibling fn within this file to keep the marketplace             */
/* purchase flow co-located with its modal state.                            */
/* -------------------------------------------------------------------------- */

function PurchaseModalBody({
  listing,
  userPoints,
  pending,
  success,
  error,
  onConfirm,
}) {
  if (success) {
    return (
      <div className={styles.purchaseSuccess}>
        <span className={styles.purchaseSuccessIcon} aria-hidden="true">
          <Check size={36} />
        </span>
        <div className={styles.purchaseSuccessText}>Purchased</div>
        <div className={styles.purchaseSuccessName}>{success.name}</div>
      </div>
    );
  }

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

  return (
    <div className={styles.purchaseBody}>
      <div className={styles.purchaseHero}>
        {isDrone && drone && (
          <DroneImage
            drone={drone}
            alt={drone.name}
            className={styles.purchaseDroneImg}
          />
        )}
        {isMod && mod && (
          <ModPlaceholder rarity={mod.rarity} size={120} />
        )}
        {isSkin && skin && (
          <div className={styles.purchaseSkinBox}>
            <SkinMini rarity={skin.rarity} />
          </div>
        )}
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
        {isMod && mod?.rarity && (
          <span
            className={cn(styles.rarityTag, styles[`rarity_${mod.rarity}`])}
          >
            {RARITY_LABELS[mod.rarity]}
          </span>
        )}
        {isSkin && skin?.rarity && (
          <span
            className={cn(styles.rarityTag, styles[`rarity_${skin.rarity}`])}
          >
            {RARITY_LABELS[skin.rarity]}
          </span>
        )}
      </div>

      {isDrone && drone && (
        <div className={styles.purchaseMeta}>
          <div className={styles.purchaseStatBars}>
            <PurchaseStatBar label="SPD" value={drone.speed ?? 0} />
            <PurchaseStatBar label="TRN" value={drone.turning ?? 0} />
            <PurchaseStatBar label="ACC" value={drone.acceleration ?? 0} />
            <PurchaseStatBar label="DUR" value={drone.durability ?? 0} />
          </div>
          <div className={styles.purchaseKpiRow}>
            <span className={styles.purchaseKpi}>
              <span className={styles.purchaseKpiLabel}>ELO</span>
              <span className={styles.purchaseKpiValue}>
                {drone.eloRating ?? 0}
              </span>
            </span>
            <span className={styles.purchaseKpi}>
              <span className={styles.purchaseKpiLabel}>W/L</span>
              <span className={styles.purchaseKpiValue}>
                {drone.wins ?? 0} / {drone.losses ?? 0}
              </span>
            </span>
          </div>
          {drone.appliedSkin?.name && (
            <div className={styles.purchaseExtra}>
              Skin equipped: {drone.appliedSkin.name}
            </div>
          )}
        </div>
      )}

      {isMod && mod && (
        <div className={styles.purchaseMeta}>
          {(mod.specialAbility || mod.description) && (
            <p className={styles.purchaseDesc}>
              {mod.specialAbility ?? mod.description}
            </p>
          )}
          <div className={styles.purchaseCompat}>Compatible with any drone</div>
        </div>
      )}

      {isSkin && skin && (
        <div className={styles.purchaseMeta}>
          {skin.description && (
            <p className={styles.purchaseDesc}>{skin.description}</p>
          )}
          <div className={styles.purchaseCompat}>Compatible with any drone</div>
        </div>
      )}

      {sellerName && (
        <div className={styles.purchaseSeller}>Seller: {sellerName}</div>
      )}

      <hr className={styles.purchaseDivider} aria-hidden="true" />

      <div className={styles.purchasePriceRow}>
        <VoltIcon size={20} />
        <span className={styles.purchasePrice}>
          {listing.price.toLocaleString()}
        </span>
      </div>
      <div className={styles.purchaseBalance}>
        Your balance: <VoltIcon size={11} />
        {userPoints.toLocaleString()}
      </div>

      <button
        type="button"
        className={cn(
          styles.purchaseCta,
          !canAfford && styles.purchaseCtaShort,
        )}
        onClick={onConfirm}
        disabled={!canAfford || pending}
      >
        {pending ? (
          <span className={styles.purchaseProcessing}>Processing...</span>
        ) : !canAfford ? (
          <>
            Need +
            <VoltIcon size={13} style={{ color: 'currentColor' }} />
            {shortBy.toLocaleString()}
          </>
        ) : (
          'Confirm Purchase'
        )}
      </button>

      {error && <div className={styles.purchaseError}>{error}</div>}

      <p className={styles.purchaseFee}>5% marketplace fee included</p>
    </div>
  );
}

function PurchaseStatBar({ label, value }) {
  const pct = Math.min(100, Math.max(0, value || 0));
  return (
    <div className={styles.purchaseStatRow}>
      <span className={styles.purchaseStatLabel}>{label}</span>
      <div className={styles.purchaseStatTrack}>
        <div
          className={styles.purchaseStatFill}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={styles.purchaseStatValue}>{value}</span>
    </div>
  );
}

function SkinMini({ rarity = 'common' }) {
  const colors = {
    common: '#9E9E9E',
    rare: '#4A9EFF',
    epic: '#BB86FC',
    legendary: '#FFD700',
  };
  const color = colors[rarity] ?? colors.common;
  return (
    <svg viewBox="0 0 160 100" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id={`skin-${rarity}`} x1="0" x2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.18" />
          <stop offset="1" stopColor={color} stopOpacity="0.6" />
        </linearGradient>
      </defs>
      <polygon
        points="20,70 55,25 105,25 140,70 120,80 40,80"
        fill={`url(#skin-${rarity})`}
        stroke={color}
        strokeWidth="1.5"
      />
      <line
        x1="55"
        y1="25"
        x2="40"
        y2="80"
        stroke={color}
        strokeWidth="1"
        opacity="0.5"
      />
      <line
        x1="105"
        y1="25"
        x2="120"
        y2="80"
        stroke={color}
        strokeWidth="1"
        opacity="0.5"
      />
    </svg>
  );
}
