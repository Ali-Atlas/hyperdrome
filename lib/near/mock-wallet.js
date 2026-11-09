/**
 * Wallet links and `withdraw` on the mock chain (SPEC.md 4.4), with the contract's panic strings.
 */

/** @typedef {import('./events.js').NearEvent} NearEvent */

/**
 * @param {{ drones: Map<string, any>, items: Map<string, any>, balances: Map<string, number>, walletLinks: Map<string, string>, event: (name: string, data: unknown, standard?: string) => NearEvent, panic: (panic: string, method: string) => never }} chain
 * @returns {Record<string, (args: any) => { result?: unknown, events?: NearEvent[] }>}
 */
export function walletMethods({ drones, items, balances, walletLinks, event, panic }) {
  return {
    link_wallet: ({ player, wallet }) => {
      if (walletLinks.has(player)) panic('linked', 'link_wallet');
      walletLinks.set(player, wallet);
      return { events: [event('wallet_linked', { player, wallet })] };
    },

    unlink_wallet: ({ player }) => {
      const wallet = walletLinks.get(player) ?? panic('not linked', 'unlink_wallet');
      walletLinks.delete(player);
      return { events: [event('wallet_unlinked', { player, wallet })] };
    },

    withdraw: ({ player, tokens, volts }) => {
      const wallet = walletLinks.get(player) ?? panic('not linked', 'withdraw');
      const amount = Number(volts);
      if (tokens.length === 0 && amount === 0) panic('nothing to withdraw', 'withdraw');
      if ((balances.get(player) ?? 0) < amount) panic('insufficient volts', 'withdraw');
      /** @type {NearEvent[]} */
      const events = [];
      for (const token of tokens) {
        const d = drones.get(token);
        const item = items.get(token);
        if (!d && !item) panic('not found', 'withdraw');
        if ((d?.owner ?? item?.owner) !== player) panic('not owner', 'withdraw');
        if (item?.bound_to) panic('bound item', 'withdraw');
        if (d && d.hot.in_batch !== null) panic('locked', 'withdraw');
        const moved = d ? [token, ...d.cold.bound_skins, ...d.cold.bound_mods] : [token];
        for (const t of moved) {
          const owned = drones.get(t) ?? items.get(t);
          if (owned) owned.owner = wallet;
        }
        events.push(
          event(
            'nft_transfer',
            [{ old_owner_id: player, new_owner_id: wallet, token_ids: moved }],
            'nep171'
          )
        );
      }
      if (amount > 0) {
        balances.set(player, (balances.get(player) ?? 0) - amount);
        balances.set(wallet, (balances.get(wallet) ?? 0) + amount);
        events.push(
          event(
            'ft_transfer',
            [{ old_owner_id: player, new_owner_id: wallet, amount: String(amount) }],
            'nep141'
          )
        );
      }
      events.push(event('withdrawn', { player, wallet, tokens, volts: String(volts) }));
      return { events };
    },
  };
}
