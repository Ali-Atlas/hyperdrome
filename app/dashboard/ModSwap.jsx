'use client';

import { useMemo, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import ModPlaceholder from '@/components/ui/ModPlaceholder';
import { useToast } from '@/components/ui/Toast';
import { useChainAction } from '@/hooks/useChainAction';
import { actionError } from '@/lib/client/chain-action';
import { lockInstantMs } from '@/lib/client/server-clock';
import { modFit } from '@/lib/game-engine/mod-fit';
import { modTemplate } from '@/lib/game-engine/templates';
import { bestBoundMod } from '@/lib/teams/policy';
import styles from './page.module.css';

/**
 * @typedef {{ id: string, tokenId: string, name: string, rarity: string, template: number }} BoundMod
 */

/**
 * The player's equipped mod and, until the lock, the control that swaps it. Each mod shows its
 * fit for this race (`modFit`, the AI teams' scorer) and the best one is marked.
 * @param {object} props
 * @param {any} props.race
 * @param {any} props.drone
 * @param {BoundMod | null} props.equipped
 * @param {import('@/lib/game-engine/mod-fit').FitRace | null} props.fitRace
 * @param {boolean} props.locked
 * @param {(mod: BoundMod | null) => void} props.onSwapped
 */
export default function ModSwap({ race, drone, equipped, fitRace, locked, onSwapped }) {
  const { showToast } = useToast();
  const sendAction = useChainAction();
  const [busy, setBusy] = useState(false);
  /** @type {BoundMod[]} */
  const mods = useMemo(() => drone?.boundMods ?? [], [drone]);

  const options = useMemo(() => {
    if (!fitRace) return mods.map((mod) => ({ mod, fit: null }));
    return mods.map((mod) => {
      const template = modTemplate(mod.template);
      return { mod, fit: template ? modFit(template, fitRace) : 0 };
    });
  }, [mods, fitRace]);

  const bestToken = useMemo(() => {
    if (!fitRace || mods.length === 0) return null;
    const best = bestBoundMod(
      {
        token: drone.tokenId,
        equippedMod: equipped?.tokenId ?? null,
        mods: mods.map((m) => ({ token: m.tokenId, template: m.template })),
      },
      fitRace
    );
    return best?.mod.token ?? null;
  }, [drone, mods, equipped, fitRace]);

  if (locked) {
    return (
      <div className={styles.matchupModLine}>
        {equipped ? (
          <>
            <ModPlaceholder rarity={equipped.rarity} size={14} />
            <span className={styles.matchupModLineName}>{equipped.name}</span>
          </>
        ) : (
          <span className={styles.matchupModLineName}>No mod</span>
        )}
        <span className={styles.matchupLocked}>Locked</span>
        {race.commitExplorerUrl && (
          <a
            href={race.commitExplorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.matchupCommitLink}
            aria-label="View the commit transaction on the explorer"
          >
            <ExternalLink size={10} aria-hidden="true" />
          </a>
        )}
      </div>
    );
  }

  if (mods.length === 0) {
    return <div className={styles.matchupModLineEmpty}>No mod</div>;
  }

  /** @param {string} token the chosen mod's token, or '' for none */
  async function choose(token) {
    if (Date.now() >= lockInstantMs(race.lockAt)) return;
    setBusy(true);
    try {
      const result = await sendAction(`/api/drones/${drone.id}/equip`, {
        kind: 'mod',
        item: token || null,
      });
      if (!result.ok) {
        showToast(actionError(result, 'The mod could not be swapped.'), 'error');
        return;
      }
      onSwapped(mods.find((m) => m.tokenId === token) ?? null);
      showToast(token ? 'Mod equipped' : 'Mod unequipped', 'success');
    } finally {
      setBusy(false);
    }
  }

  return (
    <select
      className={styles.matchupModSelect}
      aria-label={`Mod for ${drone.name} in this race`}
      value={equipped?.tokenId ?? ''}
      disabled={busy}
      onChange={(e) => choose(e.target.value)}
    >
      <option value="">No mod</option>
      {options.map(({ mod, fit }) => (
        <option key={mod.tokenId} value={mod.tokenId}>
          {mod.name}
          {fit === null ? '' : ` ${fit >= 0 ? '+' : ''}${fit.toFixed(2)}`}
          {mod.tokenId === bestToken ? ' · best fit' : ''}
        </option>
      ))}
    </select>
  );
}
