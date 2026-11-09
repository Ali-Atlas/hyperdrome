'use client';

import Badge from '@/components/ui/Badge';
import styles from './page.module.css';

/**
 * @typedef {import('./WalletView').WalletDrone} WalletDrone
 * @typedef {import('./WalletView').WalletItem} WalletItem
 */

/** @param {{ racing?: boolean, listed: boolean }} asset */
const statusOf = (asset) => (asset.listed ? 'Listed' : asset.racing ? 'In a race' : null);

/**
 * The selectable drones and unbound items. A listed token or a drone in a race cannot be selected
 * (the contract refuses them).
 * @param {object} props
 * @param {WalletDrone[]} props.drones
 * @param {WalletItem[]} props.items
 * @param {Set<string>} props.selected
 * @param {boolean} props.linked
 * @param {(token: string) => void} props.onToggle
 */
export default function AssetLists({ drones, items, selected, linked, onToggle }) {
  /** @param {string} token @param {{ racing?: boolean, listed: boolean }} asset */
  const checkbox = (token, asset) => (
    <input
      id={`select-${token}`}
      type="checkbox"
      className={styles.check}
      disabled={!linked || Boolean(statusOf(asset))}
      checked={selected.has(token)}
      onChange={() => onToggle(token)}
    />
  );

  return (
    <div className={styles.assets}>
      <section aria-labelledby="wallet-drones">
        <h2 id="wallet-drones" className={styles.sectionTitle}>
          Drones ({drones.length})
        </h2>
        {drones.length === 0 && <p className={styles.muted}>No drones on this account.</p>}
        <ul className={styles.list}>
          {drones.map((d) => {
            const bound = [...d.boundSkins, ...d.boundMods];
            return (
              <li key={d.token} className={styles.row}>
                {checkbox(d.token, d)}
                <label htmlFor={`select-${d.token}`} className={styles.rowLabel}>
                  <span className={styles.rowName}>
                    {d.name} <Badge variant="level" value={d.level} />
                  </span>
                  <span className={styles.rowDetail}>
                    {d.token}
                    {bound.length > 0 ? ` with ${bound.join(', ')}` : ''}
                  </span>
                </label>
                {statusOf(d) && <span className={styles.status}>{statusOf(d)}</span>}
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="wallet-items">
        <h2 id="wallet-items" className={styles.sectionTitle}>
          Unbound skins and mods ({items.length})
        </h2>
        {items.length === 0 && <p className={styles.muted}>No unbound items.</p>}
        <ul className={styles.list}>
          {items.map((i) => (
            <li key={i.token} className={styles.row}>
              {checkbox(i.token, i)}
              <label htmlFor={`select-${i.token}`} className={styles.rowLabel}>
                <span className={styles.rowName}>
                  {i.name} <Badge variant="rarity" value={i.rarity} />
                </span>
                <span className={styles.rowDetail}>
                  {i.token} ({i.kind})
                </span>
              </label>
              {statusOf(i) && <span className={styles.status}>{statusOf(i)}</span>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
