'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, Plus, ChevronDown } from 'lucide-react';
import NavShell from '@/components/ui/NavShell';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import Skeleton from '@/components/ui/Skeleton';
import EmptyState from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/Toast';
import { useSession } from '@/hooks/useSession';
import styles from './page.module.css';

const RARITY_LIST = ['common', 'rare', 'epic', 'legendary'];

export default function MarketplacePage() {
  const { user } = useSession();
  const { showToast } = useToast();
  const [tab, setTab] = useState('drones');
  const [listings, setListings] = useState([]);
  const [myListings, setMyListings] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
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
  const [buyModal, setBuyModal] = useState(null); // listing object
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

  const fetchMine = useCallback(async () => {
    if (!user?.id) return;
    try {
      const [drones, skins] = await Promise.all([
        fetch('/api/drones').then((r) => r.json()).catch(() => null),
        fetch('/api/skins').then((r) => r.json()).catch(() => null),
      ]);
      if (drones?.data) {
        setOwnedInactive(drones.data.filter((d) => !d.active));
      }
      if (skins?.data) {
        setOwnedSkins(skins.data);
      }
    } catch (err) {
      console.error(err);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchListings();
  }, [fetchListings]);

  useEffect(() => {
    fetchMine();
  }, [fetchMine]);

  const filteredListings = useMemo(() => {
    let items = [...listings];

    if (filters.rarities.length > 0 && tab === 'skins') {
      items = items.filter((l) => filters.rarities.includes(l.skin?.rarity));
    }

    if (tab === 'drones') {
      const min = filters.minLevel ? Number(filters.minLevel) : null;
      const max = filters.maxLevel ? Number(filters.maxLevel) : null;
      if (min != null) {
        items = items.filter((l) => (l.drone?.level ?? 0) >= min);
      }
      if (max != null) {
        items = items.filter((l) => (l.drone?.level ?? 0) <= max);
      }
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

    if (filters.sort === 'priceLow') {
      items.sort((a, b) => a.price - b.price);
    } else if (filters.sort === 'priceHigh') {
      items.sort((a, b) => b.price - a.price);
    }

    return items;
  }, [listings, filters, search, tab]);

  const myActiveListings = useMemo(
    () =>
      listings.filter(
        (l) => l.sellerId === user?.id && l.status === 'active',
      ),
    [listings, user?.id],
  );

  const handleBuy = async () => {
    if (!buyModal) return;
    try {
      const res = await fetch(
        `/api/marketplace/${buyModal.id}/buy`,
        { method: 'POST' },
      );
      const body = await res.json();
      if (!res.ok) {
        showToast(body?.error || 'Purchase failed', 'error');
      } else {
        showToast('Purchase complete', 'success');
        setBuyModal(null);
        await fetchListings();
        await fetchMine();
      }
    } catch (err) {
      showToast(String(err), 'error');
    }
  };

  const handleCancel = async (id) => {
    try {
      const res = await fetch(`/api/marketplace/${id}/cancel`, {
        method: 'POST',
      });
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

  return (
    <NavShell>
      <div className={styles.page}>
        <div className={styles.toolbarRow}>
          <div className={styles.tabs} role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'drones'}
            className={`${styles.tab} ${tab === 'drones' ? styles.tabActive : ''}`}
            onClick={() => setTab('drones')}
          >
            Drones
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'skins'}
            className={`${styles.tab} ${tab === 'skins' ? styles.tabActive : ''}`}
            onClick={() => setTab('skins')}
          >
            Skins
          </button>
          </div>
          <Button
            variant="primary"
            size="sm"
            onClick={() => setListModal(true)}
          >
            <Plus size={14} /> List Item
          </Button>
        </div>

        <div className={styles.body}>
          {/* ---- Filter sidebar ---- */}
          <aside className={styles.filters}>
            <h2 className={styles.filterHeading}>Filters</h2>

            <div className={styles.filterGroup}>
              <label className={styles.filterLabel}>Price</label>
              <div className={styles.rangeRow}>
                <input
                  type="number"
                  className={styles.rangeInput}
                  placeholder="Min"
                  value={filters.minPrice}
                  onChange={(e) =>
                    setFilters((f) => ({ ...f, minPrice: e.target.value }))
                  }
                />
                <input
                  type="number"
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
                    className={styles.rangeInput}
                    placeholder="Min"
                    value={filters.minLevel}
                    onChange={(e) =>
                      setFilters((f) => ({ ...f, minLevel: e.target.value }))
                    }
                  />
                  <input
                    type="number"
                    className={styles.rangeInput}
                    placeholder="Max"
                    value={filters.maxLevel}
                    onChange={(e) =>
                      setFilters((f) => ({ ...f, maxLevel: e.target.value }))
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
                      <span>{r}</span>
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
                <option value="priceLow">Price Low → High</option>
                <option value="priceHigh">Price High → Low</option>
              </select>
            </div>
          </aside>

          {/* ---- Main grid ---- */}
          <div className={styles.content}>
            <div className={styles.toolbar}>
              <div className={styles.searchWrap}>
                <Search size={14} className={styles.searchIcon} />
                <input
                  type="search"
                  className={styles.searchInput}
                  placeholder="Search listings..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              {myActiveListings.length > 0 && (
                <div className={styles.yourListingsStrip}>
                  Your Listings ({myActiveListings.length})
                </div>
              )}
            </div>

            {loading ? (
              <div className={styles.grid}>
                <Skeleton variant="card" height={260} />
                <Skeleton variant="card" height={260} />
                <Skeleton variant="card" height={260} />
              </div>
            ) : filteredListings.length === 0 ? (
              <EmptyState
                title="No listings yet"
                description="Be the first to list a drone or skin for sale."
              />
            ) : (
              <div className={styles.grid}>
                {filteredListings.map((listing) => (
                  <ListingCard
                    key={listing.id}
                    listing={listing}
                    isOwner={listing.sellerId === user?.id}
                    onBuy={() => setBuyModal(listing)}
                    onCancel={() => handleCancel(listing.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ---- Transaction history ---- */}
        <Card className={styles.historyCard}>
          <h2 className={styles.historyHeading}>Transaction History</h2>
          {transactions.length === 0 ? (
            <p className={styles.empty}>No completed transactions yet.</p>
          ) : (
            <div className={styles.historyList}>
              {transactions.map((tx) => (
                <div key={tx.id} className={styles.historyRow}>
                  <span>{new Date(tx.soldAt).toLocaleDateString()}</span>
                  <span>{tx.itemType}</span>
                  <span className={styles.mono}>{tx.price} pts</span>
                </div>
              ))}
            </div>
          )}
        </Card>
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
              <span>Item</span>
              <strong>
                {buyModal.drone?.name ?? buyModal.skin?.name ?? '—'}
              </strong>
            </div>
            <div className={styles.modalRow}>
              <span>Price</span>
              <strong className={styles.mono}>
                {buyModal.price.toLocaleString()} pts
              </strong>
            </div>
            <div className={styles.modalRow}>
              <span>Your balance after</span>
              <strong className={styles.mono}>
                {((user?.points ?? 0) - buyModal.price).toLocaleString()} pts
              </strong>
            </div>
            <div className={styles.modalActions}>
              <Button variant="secondary" onClick={() => setBuyModal(null)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={handleBuy}>
                Confirm Purchase
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
                className={`${styles.typeBtn} ${listingType === 'drone' ? styles.typeBtnActive : ''}`}
                onClick={() => {
                  setListingType('drone');
                  setListingItemId('');
                }}
              >
                Drone
              </button>
              <button
                type="button"
                className={`${styles.typeBtn} ${listingType === 'skin' ? styles.typeBtnActive : ''}`}
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
                      ? ` — Lvl ${item.level}`
                      : ` — ${item.rarity}`}
                  </option>
                ),
              )}
            </select>
          </div>

          <div className={styles.formRow}>
            <label className={styles.filterLabel}>Price (points)</label>
            <input
              type="number"
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
    </NavShell>
  );
}

function ListingCard({ listing, isOwner, onBuy, onCancel }) {
  const isDrone = listing.itemType === 'drone';
  const drone = listing.drone;
  const skin = listing.skin;
  const rarity = skin?.rarity;

  const rarityClass = !isDrone && rarity
    ? rarity === 'legendary'
      ? styles.rarityLegendary
      : rarity === 'epic'
        ? styles.rarityEpic
        : rarity === 'rare'
          ? styles.rarityRare
          : ''
    : '';

  return (
    <Card className={styles.listingCard}>
      <div className={`${styles.listingImage} ${rarityClass}`}>
        {isDrone ? <DroneMini /> : <SkinMini rarity={rarity} />}
      </div>
      <div className={styles.listingHeader}>
        <span className={styles.listingName}>
          {isDrone ? drone?.name : skin?.name ?? 'Unknown'}
        </span>
        {isDrone && drone && <Badge variant="level" value={drone.level} />}
        {!isDrone && rarity && <Badge variant="rarity" value={rarity} />}
      </div>
      {isDrone && drone && (
        <div className={styles.listingMeta}>
          ELO {drone.eloRating} · W {drone.wins} / L {drone.losses}
        </div>
      )}
      {!isDrone && skin?.description && (
        <div className={styles.listingMeta}>{skin.description}</div>
      )}
      <div className={styles.listingFooter}>
        <div className={styles.price}>{listing.price.toLocaleString()} pts</div>
        <div className={styles.seller}>
          by {listing.seller?.username ?? 'unknown'}
        </div>
      </div>
      {isOwner ? (
        <Button variant="secondary" size="sm" onClick={onCancel}>
          Cancel Listing
        </Button>
      ) : (
        <Button variant="primary" size="sm" onClick={onBuy}>
          Buy Now
        </Button>
      )}
    </Card>
  );
}

function DroneMini() {
  return (
    <svg viewBox="0 0 160 100" xmlns="http://www.w3.org/2000/svg">
      <g stroke="#03DAC6" strokeWidth="1.2" fill="none">
        <line x1="25" y1="25" x2="70" y2="50" />
        <line x1="25" y1="75" x2="70" y2="50" />
        <line x1="135" y1="25" x2="90" y2="50" />
        <line x1="135" y1="75" x2="90" y2="50" />
        <polygon points="70,50 80,35 90,50 80,65" fill="rgba(3,218,198,0.3)" />
        <circle cx="25" cy="25" r="10" opacity="0.6" />
        <circle cx="25" cy="75" r="10" opacity="0.6" />
        <circle cx="135" cy="25" r="10" opacity="0.6" />
        <circle cx="135" cy="75" r="10" opacity="0.6" />
      </g>
    </svg>
  );
}

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
          <stop offset="0" stopColor={color} stopOpacity="0.15" />
          <stop offset="1" stopColor={color} stopOpacity="0.6" />
        </linearGradient>
      </defs>
      <polygon
        points="20,70 55,25 105,25 140,70 120,80 40,80"
        fill={`url(#skin-${rarity})`}
        stroke={color}
        strokeWidth="1.5"
      />
      <line x1="55" y1="25" x2="40" y2="80" stroke={color} strokeWidth="1" opacity="0.5" />
      <line x1="105" y1="25" x2="120" y2="80" stroke={color} strokeWidth="1" opacity="0.5" />
    </svg>
  );
}
