import StatBar from '@/components/ui/StatBar';
import { calculateXPToNextLevel } from '@/lib/game-engine/economy.js';
import { GAME_CONTRACT } from '@/lib/near/public-rpc.js';
import { PUBLIC_EXPLORER_URL, explorerAccountUrl, explorerNftUrl } from '@/lib/near/explorer.js';
import styles from './OnChainPanel.module.css';

/** The highest level (SPEC.md 2.1): the XP bar reads full from here. */
const MAX_LEVEL = 20;

/**
 * A drone's on-chain identity and its XP toward the next level (SPEC.md 11).
 * @param {{ drone: any }} props
 */
export default function OnChainPanel({ drone }) {
  const owner = drone.owner?.nearAccountId ?? (drone.isBot ? GAME_CONTRACT : null);
  const maxed = drone.level >= MAX_LEVEL;
  const needed = calculateXPToNextLevel(drone.level);
  const xp = maxed ? needed : Math.min(drone.xp ?? 0, needed);
  return (
    <div className={styles.panel}>
      <dl className={styles.rows}>
        <div className={styles.row}>
          <dt className={styles.term}>Token</dt>
          <dd className={styles.value}>
            {drone.tokenId ? (
              <a
                className={styles.link}
                href={explorerNftUrl(PUBLIC_EXPLORER_URL, GAME_CONTRACT, drone.tokenId)}
                target="_blank"
                rel="noopener noreferrer"
              >
                {drone.tokenId}
              </a>
            ) : (
              '-'
            )}
          </dd>
        </div>
        <div className={styles.row}>
          <dt className={styles.term}>Owner</dt>
          <dd className={styles.value}>
            {owner ? (
              <a
                className={styles.link}
                href={explorerAccountUrl(PUBLIC_EXPLORER_URL, owner)}
                target="_blank"
                rel="noopener noreferrer"
              >
                {owner}
              </a>
            ) : (
              '-'
            )}
          </dd>
        </div>
      </dl>
      <div>
        <StatBar label="XP" value={xp} maxValue={needed} size="sm" />
        <p className={styles.hint}>
          {maxed ? 'Max level' : `${xp} of ${needed} XP to LV ${drone.level + 1}`}
        </p>
      </div>
    </div>
  );
}
