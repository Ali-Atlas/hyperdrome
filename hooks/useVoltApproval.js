'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  useAccount,
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi';
import { parseUnits } from 'viem';

/**
 * VOLT ERC-20 approval hook for user-signed flows.
 *
 * The user-signed marketplace buy needs the user's wallet to first
 * approve the marketplace contract for `amount` VOLT, then call
 * `buyItem(listingId)` (which internally does
 * `voltToken.transferFrom(msg.sender, ...)`). This hook handles the
 * approval half:
 *
 *   1. Reads the current allowance via VOLT.allowance(owner, spender)
 *      with wagmi's useReadContract (cached + auto-revalidates).
 *   2. Compares against the requested amount and exposes `needsApproval`.
 *   3. Provides an `approve()` callback that triggers the MetaMask
 *      popup via wagmi's useWriteContract.
 *   4. Tracks the approve tx through useWaitForTransactionReceipt and
 *      flips `isApproved` true once it confirms (and re-reads allowance
 *      so a follow-up render sees the on-chain truth, not just the
 *      derived flag).
 *
 * UI states the consumer can render off this:
 *   - `isApproving`: MetaMask popup open OR approve tx pending in mempool
 *   - `needsApproval`: current allowance < amount (and we're not mid-flight)
 *   - `isApproved`: allowance >= amount (post-confirmation or already true)
 *   - `error`: any rejection / RPC failure (string)
 *
 * @param {object} args
 * @param {`0x${string}`|null|undefined} args.spender - the contract that
 *   needs to spend the user's VOLT (e.g. marketplace address).
 * @param {number|null|undefined} args.amount - the VOLT amount in
 *   integer "volts" (the same unit prices use elsewhere in the app).
 *   Internally converted to 18-decimal wei. null/undefined disables the
 *   hook (returns sensible defaults so consumers don't have to gate the
 *   render).
 */
const VOLT_ABI = [
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'value', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
];

const VOLT_ADDRESS = process.env.NEXT_PUBLIC_VOLT_CONTRACT_ADDRESS;

export function useVoltApproval({ spender, amount }) {
  const { address: owner } = useAccount();
  const [error, setError] = useState(null);

  const amountWei = useMemo(() => {
    if (amount == null || !Number.isFinite(amount) || amount <= 0) return null;
    return parseUnits(String(amount), 18);
  }, [amount]);

  const enabled = Boolean(VOLT_ADDRESS && owner && spender && amountWei != null);

  // Current allowance. wagmi auto-fetches on mount + on input changes; we
  // also call `refetch()` after the approve tx confirms so the hook
  // reflects the new on-chain value rather than relying on the
  // optimistic `isApproved` flag alone.
  const {
    data: currentAllowance,
    refetch: refetchAllowance,
    isLoading: isAllowanceLoading,
  } = useReadContract({
    abi: VOLT_ABI,
    address: VOLT_ADDRESS,
    functionName: 'allowance',
    args: enabled ? [owner, spender] : undefined,
    query: { enabled },
  });

  const {
    writeContractAsync,
    data: approveHash,
    isPending: isWritePending,
    reset: resetWrite,
  } = useWriteContract();

  const {
    isLoading: isMining,
    isSuccess: isMined,
    error: receiptError,
  } = useWaitForTransactionReceipt({
    hash: approveHash,
    query: { enabled: !!approveHash },
  });

  // After the approve tx mines, re-read allowance so callers see the
  // authoritative new value on the next render. Without this the hook
  // would rely on the derived `isMined` flag to decide "approved",
  // which is fine in the success path but drifts on a chain reorg or a
  // race with another tab approving the same pair.
  useEffect(() => {
    if (isMined) {
      refetchAllowance();
    }
  }, [isMined, refetchAllowance]);

  // Surface receipt errors (e.g. tx reverted) the same way as user
  // rejections from approve(). Cleared on the next approve() call.
  useEffect(() => {
    if (receiptError) {
      setError(
        receiptError?.shortMessage ?? receiptError?.message ?? 'Approval failed',
      );
    }
  }, [receiptError]);

  const approve = useCallback(async () => {
    if (!enabled || amountWei == null) return null;
    setError(null);
    resetWrite();
    try {
      const hash = await writeContractAsync({
        abi: VOLT_ABI,
        address: VOLT_ADDRESS,
        functionName: 'approve',
        args: [spender, amountWei],
      });
      return hash;
    } catch (err) {
      // User rejected in MetaMask, RPC failure, etc. Surface a short,
      // human-readable message; consumers render it next to the action
      // button. wagmi exceptions carry `shortMessage` for this purpose.
      const msg =
        err?.shortMessage ??
        err?.message ??
        'Approval was rejected or failed';
      setError(msg);
      return null;
    }
  }, [enabled, amountWei, resetWrite, writeContractAsync, spender]);

  // `isApproved` short-circuits to true once the on-chain allowance
  // covers the requested amount. While the tx is mining the previous
  // allowance still reads stale, so we OR with `isMined` to flip true
  // immediately on confirmation; once `refetchAllowance` lands the
  // first branch takes over.
  const allowanceCoversAmount =
    typeof currentAllowance === 'bigint' &&
    amountWei != null &&
    currentAllowance >= amountWei;

  const isApproving = isWritePending || isMining;
  const isApproved = allowanceCoversAmount || isMined;
  const needsApproval = enabled && !isApproved && !isApproving;

  return {
    needsApproval,
    approve,
    isApproving,
    isApproved,
    isAllowanceLoading,
    error,
    allowance: currentAllowance ?? null,
  };
}
