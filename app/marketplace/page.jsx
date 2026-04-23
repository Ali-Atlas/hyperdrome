'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Search, Plus, ChevronDown, ChevronRight } from 'lucide-react';
import NavShell from '@/components/ui/NavShell';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import Skeleton from '@/components/ui/Skeleton';
import EmptyState from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/Toast';
import { useSession } from '@/hooks/useSession';
import { cn, getLevelColor } from '@/lib/utils';
import styles from './page.module.css';

const PACK_DEFS = [
  {
    id: 'starter',
    name: 'Starter Pack',
    price: 500,
    variant: 'gray',
    contents: '3 Skins - 2 Common guaranteed, 1 Rare or higher',
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
    price: 2_000,
    variant: 'purple',
    contents: '3 Skins - 1 Rare guaranteed, 1 Epic or higher, 1 any rarity',
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
    price: 10_000,
    variant: 'gold',
    contents: '3 Skins - 1 Epic guaranteed, 1 Legendary, 1 Rare or higher',
    slots: [
      { variant: 'epic' },
      { variant: 'legendary' },
      { variant: 'rare', mystery: true },
    ],
    rates: [
      { label: 'Epic (guaranteed)', rarity: 'epic', chance: '100%' },
      { label: 'Legendary (guaranteed)', rarity: 'legendary', chance: '100%' },
      { label: 'Rare+ (slot 3)', rarity: 'rare', chance: '30% / 50% / 20%' },
    ],
    buttonVariant: 'gold',
  },
];

const RARITY_LIST = ['common', 'rare', 'epic', 'legendary'];
const RARITY_LABELS = {
  common: 'Common',
  rare: 'Rare',
  epic: 'Epic',
  legendary: 'Legendary',
};

export default function MarketplacePage() {
  const { user } = useSession();
  const { showToast } = useToast();

  const [tab, setTab] = useState('drones'); // 'drones' | 'skins' | 'packs'
  const [view, setView] = useState('all'); // 'all' | 'mine'
  const [packOpening, setPackOpening] = useState(null); // pack id currently being opened
  const [packReveal, setPackReveal] = useState(null); // { awarded, packType }
  const [packRevealStep, setPackRevealStep] = useState(0);
  const [listings, setListings] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [txOpen, setTxOpen] = useState(false);
  const [filters, setFilters] = useState({
    minPrice: '',
    maxPrice: '',
    minLevel: '',
    maxLevel: '',
    rarities: [],
    sort: 'newest',
  });
  const [search, setSearch] = useState('');

  // Modals
  const [buyModal, setBuyModal] = useState(null);
  const [listModal, setListModal] = useState(false);
  const [listingType, setListingType] = useState('drone');
  const [listingItemId, setListingItemId] = useState('');
  const [listingPrice, setListingPrice] = useState('');
  const [listingPending, setListingPending] = useState(false);
  const [ownedInactive, setOwnedInactive] = useState([]);
  const [ownedSkins, setOwnedSkins] = useState([]);

  const fetchListings = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        item_type: tab === 'drones' ? 'drone' : 'skin',
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
        item_type: tab === 'drones' ? 'drone' : 'skin',
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
      const [drones, skins] = await Promise.all([
        fetch('/api/drones').then((r) => r.json()).catch(() => null),
        fetch('/api/skins').then((r) => r.json()).catch(() => null),
      ]);
      if (drones?.data) setOwnedInactive(drones.data.filter((d) => !d.active));
      if (skins?.data) setOwnedSkins(skins.data);
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
          l.seller?.username?.toLowerCase().includes(q),
      );
    }

    if (filters.sort === 'priceLow') items.sort((a, b) => a.price - b.price);
    else if (filters.sort === 'priceHigh') items.sort((a, b) => b.price - a.price);

    return items;
  }, [listings, myActiveListings, filters, search, tab, view]);

  const handleBuy = async () => {
    if (!buyModal) return;
    try {
      const res = await fetch(`/api/marketplace/${buyModal.id}/buy`, {
        method: 'POST',
      });
      const body = await res.json();
      if (!res.ok) {
        showToast(body?.error || 'Purchase failed', 'error');
      } else {
        showToast('Purchase complete', 'success');
        setBuyModal(null);
        await fetchListings();
        await fetchTransactions();
        await fetchMine();
      }
    } catch (err) {
      showToast(String(err), 'error');
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
      else payload.skin_id = listingItemId;
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

  const txColumns = useMemo(
    () => [
      {
        key: 'soldAt',
        label: 'Date',
        render: (r) =>
          r.soldAt ? new Date(r.soldAt).toLocaleDateString() : '-',
      },
      {
        key: 'itemName',
        label: 'Item',
        render: (r) =>
          r.drone?.name ??
          r.skin?.name ??
          (r.itemType === 'drone' ? 'Drone' : 'Skin'),
      },
      {
        key: 'itemType',
        label: 'Type',
        shortLabel: 'Type',
        render: (r) => (
          <span className={styles.txType}>{r.itemType}</span>
        ),
      },
      {
        key: 'price',
        label: 'Price',
        align: 'right',
        sortable: true,
        render: (r) => (
          <span className={styles.mono}>
            {Number(r.price).toLocaleString()} pts
          </span>
        ),
      },
    ],
    [],
  );

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
            </div>
            {tab !== 'packs' && (
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
            <span className={styles.balanceValue}>
              {userPoints.toLocaleString()}
            </span>
            <span className={styles.balanceUnit}>pts</span>
          </div>
        </div>

        {/* ---- Sub-toolbar: view toggle + search (hidden on Packs tab) ---- */}
        {tab !== 'packs' && (
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
                Your Listings ({myActiveListings.length})
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
        <div className={cn(styles.body, tab === 'packs' && styles.bodyPacks)}>
          {tab !== 'packs' && (
          <aside className={styles.filters}>
            <div className={styles.filtersInner}>
              <h2 className={styles.filtersHeading}>Filters</h2>

              <div className={styles.filterBody}>
                <div className={styles.filterGroup}>
                  <label className={styles.filterLabel}>Price (pts)</label>
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

                {tab === 'skins' && (
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
                      sort: 'newest',
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
            {tab === 'packs' ? (
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
            ) : tab !== 'packs' && filteredListings.length === 0 ? (
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
              <div className={styles.grid}>
                {filteredListings.map((listing) => {
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
              </div>
            )}
          </div>
        </div>

        {/* ---- Transaction history (collapsed by default, DataTable inside).
            Hidden on Packs tab - doesn't apply there. ---- */}
        {tab !== 'packs' && (
        <Card className={styles.historyCard}>
          <button
            type="button"
            className={styles.historyToggle}
            onClick={() => setTxOpen((o) => !o)}
            aria-expanded={txOpen}
          >
            <span>Transaction History</span>
            <ChevronDown
              size={16}
              className={cn(
                styles.historyChevron,
                txOpen && styles.historyChevronOpen,
              )}
              aria-hidden="true"
            />
          </button>
          {txOpen && (
            <div className={styles.historyBody}>
              <DataTable
                sortable
                columns={txColumns}
                data={transactions}
                emptyMessage="No completed sales yet."
              />
            </div>
          )}
        </Card>
        )}
      </div>

      {/* ---- Buy modal ---- */}
      <Modal
        isOpen={!!buyModal}
        onClose={() => setBuyModal(null)}
        title="Confirm Purchase"
        size="sm"
      >
        {buyModal && (
          <div className={styles.modalBody}>
            <div className={styles.modalRow}>
              <span className={styles.modalRowLabel}>Item</span>
              <strong>
                {buyModal.drone?.name ?? buyModal.skin?.name ?? '-'}
              </strong>
            </div>
            <div className={styles.modalRow}>
              <span className={styles.modalRowLabel}>Price</span>
              <strong className={styles.mono}>
                {buyModal.price.toLocaleString()} pts
              </strong>
            </div>
            <div className={styles.modalRow}>
              <span className={styles.modalRowLabel}>Your balance after</span>
              <strong className={styles.mono}>
                {(userPoints - buyModal.price).toLocaleString()} pts
              </strong>
            </div>
            <div className={styles.modalActions}>
              <Button variant="secondary" onClick={() => setBuyModal(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleBuy}
                disabled={userPoints < buyModal.price}
              >
                {userPoints < buyModal.price
                  ? `Need +${(buyModal.price - userPoints).toLocaleString()} pts`
                  : 'Confirm Purchase'}
              </Button>
            </div>
          </div>
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
            </div>
          </div>

          <div className={styles.formRow}>
            <label className={styles.filterLabel}>
              {listingType === 'drone'
                ? 'Choose drone (must be inactive)'
                : 'Choose skin'}
            </label>
            <select
              className={styles.select}
              value={listingItemId}
              onChange={(e) => setListingItemId(e.target.value)}
            >
              <option value="">Select one…</option>
              {(listingType === 'drone' ? ownedInactive : ownedSkins).map(
                (item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                    {listingType === 'drone'
                      ? ` - Lv ${item.level}`
                      : ` - ${item.rarity}`}
                  </option>
                ),
              )}
            </select>
          </div>

          <div className={styles.formRow}>
            <label className={styles.filterLabel}>Price (pts)</label>
            <input
              type="number"
              inputMode="numeric"
              className={styles.rangeInput}
              placeholder="1000"
              value={listingPrice}
              onChange={(e) => setListingPrice(e.target.value)}
            />
            <div className={styles.feeInfo}>
              Platform fee: <strong>5% ({fee} pts)</strong> · You receive:{' '}
              <strong className={styles.mono}>{payout} pts</strong>
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
/* Packs showcase                                                             */
/* -------------------------------------------------------------------------- */

function PacksShowcase({ userPoints, openingId, onOpen }) {
  return (
    <div className={styles.packsShowcase}>
      {PACK_DEFS.map((pack) => {
        const canAfford = userPoints >= pack.price;
        const pointsShort = Math.max(0, pack.price - userPoints);
        const isOpening = openingId === pack.id;
        return (
          <PackCard
            key={pack.id}
            pack={pack}
            canAfford={canAfford}
            pointsShort={pointsShort}
            isOpening={isOpening}
            onOpen={() => onOpen(pack.id)}
          />
        );
      })}
    </div>
  );
}

function PackCard({ pack, canAfford, pointsShort, isOpening, onOpen }) {
  const [detailsOpen, setDetailsOpen] = useState(false);

  return (
    <div className={cn(styles.packCard, styles[`pack_${pack.variant}`])}>
      <div className={styles.packSilhouettes}>
        {pack.slots.map((slot, i) => (
          <Silhouette key={i} variant={slot.variant} mystery={slot.mystery} />
        ))}
      </div>

      <div className={styles.packContent}>
        <div className={styles.packName}>{pack.name}</div>
        <div className={styles.packContents}>{pack.contents}</div>

        <button
          type="button"
          className={styles.packDetailsToggle}
          onClick={() => setDetailsOpen((v) => !v)}
          aria-expanded={detailsOpen}
        >
          {detailsOpen ? (
            <ChevronDown size={12} aria-hidden="true" />
          ) : (
            <ChevronRight size={12} aria-hidden="true" />
          )}
          What&apos;s inside
        </button>

        {detailsOpen && (
          <ul className={styles.packRates}>
            {pack.rates.map((rate, i) => (
              <li key={i}>
                <span
                  className={cn(styles.packRateLabel, styles[`rarity_${rate.rarity}`])}
                >
                  {rate.label}
                </span>
                <span className={styles.packRateChance}>{rate.chance}</span>
              </li>
            ))}
          </ul>
        )}

        <div className={styles.packBuyRow}>
          <Button
            variant={
              pack.buttonVariant === 'gold' ? 'secondary' : pack.buttonVariant
            }
            onClick={onOpen}
            disabled={!canAfford || isOpening}
            loading={isOpening}
            className={cn(
              styles.packBtn,
              pack.buttonVariant === 'gold' && styles.packBtnGold,
            )}
          >
            {!canAfford
              ? `Need +${pointsShort.toLocaleString()} pts`
              : `Open Pack - ${pack.price.toLocaleString()} pts`}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Silhouette({ variant, mystery }) {
  return (
    <div className={cn(styles.silhouette, styles[`sil_${variant}`])}>
      {mystery && <span className={styles.silMystery}>?</span>}
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
  const drone = listing.drone;
  const skin = listing.skin;
  const rarity = skin?.rarity;

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

  return (
    <Card
      className={cn(
        styles.listingCard,
        rarityClass,
        isOwner && styles.cardMine,
        !isDrone && rarity === 'legendary' && styles.cardLegendaryShimmer,
      )}
    >
      {isOwner && <span className={styles.ownerChip}>YOUR LISTING</span>}

      <div className={styles.listingImage}>
        {isDrone ? (
          <img
            src={drone?.imageUrl || '/drones/default.png'}
            alt={drone?.name ?? 'Drone'}
            className={styles.droneImg}
          />
        ) : (
          <SkinMini rarity={rarity} />
        )}
      </div>

      <div className={styles.listingBody}>
        <div className={styles.listingTitleRow}>
          <span className={styles.listingName}>
            {isDrone ? drone?.name : skin?.name ?? 'Unknown'}
          </span>
          {isDrone && drone?.level != null && (
            <span
              className={styles.listingLevel}
              style={{ color: getLevelColor(drone.level) }}
            >
              Lv {drone.level}
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

        {!isDrone && (
          <div className={styles.compat}>
            Compatible with any drone
          </div>
        )}

        <div className={styles.priceRow}>
          <span className={styles.price}>
            {listing.price.toLocaleString()}
          </span>
          <span className={styles.priceUnit}>pts</span>
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
              {canAfford
                ? 'Buy Now'
                : `Need +${pointsShort.toLocaleString()} pts`}
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

function SkinMini({ rarity = 'common' }) {
  const colors = {
    common: '#9E9E9E',
    rare: '#03DAC6',
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
