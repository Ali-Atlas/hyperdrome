'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ExternalLink, Link2, RefreshCw, Unlink, Wallet } from 'lucide-react';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import EmptyState from '@/components/ui/EmptyState';
import NavShell from '@/components/ui/NavShell';
import Skeleton from '@/components/ui/Skeleton';
import VoltIcon from '@/components/ui/VoltIcon';
import { useToast } from '@/components/ui/Toast';
import { useChainAction } from '@/hooks/useChainAction';
import { actionError } from '@/lib/client/chain-action';
import {
  signLinkChallenge,
  unlinkFromWallet,
  withdrawFromWallet,
} from '@/lib/client/wallet-connector';
import { post, postLink, syncAssets, walletMessage } from '@/lib/client/wallet-requests';
import { cn } from '@/lib/utils';
import AssetLists from './AssetLists';
import styles from './page.module.css';

/**
 * @typedef {object} WalletDrone
 * @property {string} token
 * @property {string} name
 * @property {number} level
 * @property {boolean} racing
 * @property {boolean} listed
 * @property {string[]} boundSkins
 * @property {string[]} boundMods
 * @typedef {object} WalletItem
 * @property {string} token
 * @property {string} name
 * @property {string} rarity
 * @property {'skin'|'mod'} kind
 * @property {boolean} listed
 * @typedef {object} WalletState
 * @property {string} account
 * @property {string | null} wallet
 * @property {string | null} walletExplorerUrl
 * @property {string} gameId
 * @property {number} volts
 * @property {number | null} maxTokens
 * @property {WalletDrone[]} drones
 * @property {WalletItem[]} items
 */

/**
 * The player's wallet page: link a wallet, then withdraw drones, unbound items and Volts to it,
 * through the app or signed by the wallet itself.
 */
export default function WalletView() {
  const { showToast } = useToast();
  const sendAction = useChainAction();
  const [state, setState] = useState(/** @type {WalletState | null} */ (null));
  const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
  const [selected, setSelected] = useState(/** @type {Set<string>} */ (new Set()));
  const [volts, setVolts] = useState('');
  const [busy, setBusy] = useState(/** @type {string | null} */ (null));

  const refresh = useCallback(async () => {
    const res = await fetch('/api/wallet');
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      setState(body);
      setLoadError(null);
    } else {
      setLoadError(body.error ?? 'Could not load your wallet page.');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/wallet')
      .then((res) => res.json().then((body) => ({ res, body })))
      .then(({ res, body }) => {
        if (cancelled) return;
        if (res.ok) setState(body);
        else setLoadError(body.error ?? 'Could not load your wallet page.');
      })
      .catch(() => {
        if (!cancelled) setLoadError('Could not load your wallet page.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** @param {string} token */
  const toggle = (token) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(token)) next.delete(token);
      else next.add(token);
      return next;
    });

  const voltsAmount = Number(volts) || 0;
  const voltsValid = Number.isInteger(voltsAmount) && voltsAmount >= 0;
  const tokens = useMemo(() => [...selected], [selected]);
  /** Tokens the call would move: drones count their bound items (SPEC.md 4.4). */
  const movedCount = useMemo(() => {
    if (!state) return 0;
    const drones = new Map(state.drones.map((d) => [d.token, d]));
    return tokens.reduce((sum, t) => {
      const d = drones.get(t);
      return sum + 1 + (d ? d.boundSkins.length + d.boundMods.length : 0);
    }, 0);
  }, [state, tokens]);
  const overLimit = Boolean(state?.maxTokens) && movedCount > Number(state?.maxTokens);
  const canWithdraw = (tokens.length > 0 || voltsAmount > 0) && voltsValid && !overLimit;

  const clearSelection = () => {
    setSelected(new Set());
    setVolts('');
  };

  async function connectAndLink() {
    setBusy('link');
    try {
      const challenge = await post('/api/wallet/challenge', {});
      if (!challenge.ok) throw new Error(challenge.body.error ?? 'Could not start the link.');
      const { nonce } = challenge.body;
      const signed = await signLinkChallenge({
        nonce,
        message: challenge.body.message,
        recipient: challenge.body.recipient,
      });
      const linked = await postLink({ ...signed, nonce });
      if (!linked.ok) throw new Error(linked.body.error ?? 'The wallet could not be linked.');
      showToast('Wallet linked', 'success');
      await refresh();
    } catch (err) {
      showToast(walletMessage(err, 'The wallet could not be linked.'), 'error');
    } finally {
      setBusy(null);
    }
  }

  async function withdrawThroughApp() {
    setBusy('app');
    try {
      const result = await sendAction('/api/wallet/withdraw', { tokens, volts: voltsAmount });
      if (!result.ok) {
        showToast(actionError(result, 'The withdrawal failed.'), 'error');
        return;
      }
      showToast('Withdrawn to your wallet', 'success');
      clearSelection();
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  /**
   * Run a wallet-signed call, then re-read the player's assets from chain.
   * @param {string} kind the busy flag
   * @param {() => Promise<unknown>} send
   * @param {string} done the success toast
   * @param {string} fallback the failure toast
   */
  async function fromWallet(kind, send, done, fallback) {
    setBusy(kind);
    try {
      await send();
      const synced = await syncAssets();
      if (synced.ok) showToast(done, 'success');
      else showToast(`${done}. Select Sync to refresh this page.`, 'info');
      clearSelection();
      await refresh();
    } catch (err) {
      showToast(walletMessage(err, fallback), 'error');
    } finally {
      setBusy(null);
    }
  }

  async function sync() {
    setBusy('sync');
    try {
      const synced = await syncAssets();
      if (!synced.ok) throw new Error(synced.error ?? 'Sync failed.');
      showToast('Assets re-read from the chain', 'success');
      await refresh();
    } catch (err) {
      showToast(walletMessage(err, 'Sync failed.'), 'error');
    } finally {
      setBusy(null);
    }
  }

  if (loadError) {
    return (
      <NavShell>
        <EmptyState title="Wallet unavailable" description={loadError} icon={Wallet} />
      </NavShell>
    );
  }

  if (!state) {
    return (
      <NavShell>
        <div className={styles.page}>
          <Skeleton variant="card" height={140} />
          <Skeleton variant="card" height={240} />
        </div>
      </NavShell>
    );
  }

  const { wallet, walletExplorerUrl, account, gameId, drones, items } = state;

  return (
    <NavShell>
      <div className={styles.page}>
        <header className={styles.header}>
          <h1 className={styles.title}>Your Wallet</h1>
          <p className={styles.subtitle}>
            Link a NEAR testnet wallet you control. Once linked, only that wallet can change the
            link, and withdrawals go only to it.
          </p>
        </header>

        <Card className={styles.linkCard}>
          <div className={styles.linkRow}>
            <div>
              <div className={styles.label}>Linked wallet</div>
              {wallet ? (
                <a
                  href={walletExplorerUrl ?? undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.walletLink}
                >
                  {wallet}
                  <ExternalLink size={14} aria-hidden="true" />
                </a>
              ) : (
                <p className={styles.muted}>No wallet linked yet.</p>
              )}
              <div className={styles.account}>Racing account: {account}</div>
            </div>
            <div className={styles.linkActions}>
              {wallet ? (
                <Button
                  variant="secondary"
                  size="sm"
                  loading={busy === 'unlink'}
                  disabled={busy !== null}
                  onClick={() =>
                    fromWallet(
                      'unlink',
                      () => unlinkFromWallet({ gameId, wallet, player: account }),
                      'Wallet unlinked',
                      'The unlink failed.'
                    )
                  }
                >
                  <Unlink size={14} aria-hidden="true" /> Unlink
                </Button>
              ) : (
                <Button loading={busy === 'link'} disabled={busy !== null} onClick={connectAndLink}>
                  <Link2 size={14} aria-hidden="true" /> Connect a wallet
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                loading={busy === 'sync'}
                disabled={busy !== null}
                onClick={sync}
              >
                <RefreshCw size={14} aria-hidden="true" /> Sync
              </Button>
            </div>
          </div>
        </Card>

        {drones.length === 0 && items.length === 0 ? (
          <EmptyState
            title="Nothing to withdraw"
            description="Your drones, unbound skins and mods appear here. Use Sync after sending items back from your wallet."
            icon={Wallet}
          />
        ) : (
          <AssetLists
            drones={drones}
            items={items}
            selected={selected}
            linked={Boolean(wallet)}
            onToggle={toggle}
          />
        )}

        <Card className={styles.withdrawCard}>
          <div className={styles.voltsRow}>
            <label htmlFor="wallet-volts" className={styles.label}>
              Volts to withdraw
            </label>
            <div className={styles.voltsInput}>
              <VoltIcon size={16} />
              <input
                id="wallet-volts"
                type="number"
                min="0"
                step="1"
                inputMode="numeric"
                className={styles.number}
                value={volts}
                disabled={!wallet}
                onChange={(e) => setVolts(e.target.value)}
                aria-describedby="wallet-volts-hint"
              />
            </div>
            <span id="wallet-volts-hint" className={styles.muted}>
              You hold {state.volts.toLocaleString()} Volts.
              {voltsValid ? '' : ' Enter a whole number.'}
            </span>
          </div>

          {state.maxTokens !== null && (
            <p className={cn(styles.muted, overLimit && styles.error)}>
              {movedCount} of {state.maxTokens} tokens selected, bound items included.
            </p>
          )}

          <div className={styles.actions}>
            <Button
              disabled={!wallet || !canWithdraw || busy !== null}
              loading={busy === 'app'}
              onClick={withdrawThroughApp}
            >
              Withdraw through the app
            </Button>
            <Button
              variant="secondary"
              disabled={!wallet || !canWithdraw || busy !== null}
              loading={busy === 'wallet'}
              onClick={() => {
                if (!wallet) return;
                fromWallet(
                  'wallet',
                  () =>
                    withdrawFromWallet({
                      gameId,
                      wallet,
                      player: account,
                      tokens,
                      volts: voltsAmount,
                      movedTokens: movedCount,
                    }),
                  'Withdrawn to your wallet',
                  'The withdrawal failed.'
                );
              }}
            >
              Withdraw from your wallet
            </Button>
          </div>
          <p className={styles.muted}>
            Through the app costs you nothing. From your wallet needs no server: your wallet signs
            and pays the gas.
          </p>
        </Card>
      </div>
    </NavShell>
  );
}
