# Hyperdrome On-Chain Roadmap

Hyperdrome is a competitive drone racing strategy game integrating with MegaETH. The architecture follows a hybrid model: game simulation runs server-side for performance, while economic outcomes settle on-chain for transparency and real asset ownership. MegaETH's 10ms block times enable near-instant settlement, making the on-chain game loop feel real-time.

## Current Architecture

- Next.js 16, JavaScript, Neon Postgres, DrizzleORM, Vercel Pro
- Automated 1v1 races every 3 minutes via ELO matchmaking
- 9-stat drone progression system, mod and skin equipment, player marketplace, pack economy

## Phase 1: NFT Foundation (COMPLETE)

- HyperdromeDrone ERC-721 contract deployed on MegaETH testnet v2 (chain ID 6343)
- Wallet connect via RainbowKit + wagmi v2
- Server-side drone minting (game server mints to player's linked wallet)
- ERC-721 metadata endpoint serving dynamic drone stats, level, tier, ELO
- Wallet linking to user accounts with auto-bind on connect

## Phase 2: On-Chain Marketplace

- HyperdromeMarketplace.sol: list, buy, cancel drone NFTs
- 10% platform rake enforced in contract (90% to seller, 10% to treasury)
- All marketplace transactions settle on MegaETH
- Frontend routes buy and sell through smart contract calls via the connected wallet

## Phase 3: VOLT Token + On-Chain Economy

- VOLT ERC-20 token contract on MegaETH
- Race rewards distributed in VOLT on-chain
- Pack purchases and stat upgrades burn VOLT
- NPC vendor transactions in VOLT
- Creates a real token economy backed by gameplay activity

## Phase 4: On-Chain Race Settlement

- RaceSettlement.sol: the core on-chain game loop
- Server simulates races and submits a batch `settleEpoch(epochNumber, results[])` every 3 minutes
- Contract updates ELO ratings on-chain, distributes VOLT rewards, and records race outcomes
- One batch transaction per epoch containing all race results
- Events emitted for each settled race, enabling real-time frontends
- Estimated gas cost: minimal gas per epoch on MegaETH's L2 pricing
- This generates sustained, recurring transaction volume on MegaETH: every 3 minutes, permanently

## Phase 5: Real-Time Push Layer

- Replace polling with push events (Pusher free tier or SSE)
- Three core events: `epoch:settling`, `epoch:settled`, `epoch:next`
- Existing `useSyncExternalStore` modules swap poll internals for push listeners
- Players see race results appear instantly as the chain confirms settlement

## Phase 6: Skin/Mod NFT Layer

- Skin ERC-721 and Mod ERC-721 contracts
- Pack opening mints NFTs directly from contracts
- Bind-to-drone logic on-chain (skin or mod bound to a specific drone NFT)
- Completes the full asset layer: every in-game item is an on-chain asset

## Phase 7: Decentralized Verification

- On-chain matchmaking (contract pairs drones by ELO)
- Race log hashes committed on-chain for tamper-proof result verification
- Static asset images (skins, tier art) stored on IPFS or Arweave for permanence
- Full trustless game loop: matchmaking, settlement, and verification all verifiable on-chain

## Why MegaETH

- 10ms block times make on-chain race settlement feel instant
- L2-tier gas costs make batch settlement every 3 minutes economically viable
- Real-time event streaming enables live game state updates from chain
- MegaETH's thesis is that real-time blockchain enables consumer apps that weren't possible before. Hyperdrome proves that thesis with a game loop that settles on-chain 480 times per day.

## Transaction Volume Projection

- Race settlement: 1 batch tx every 3 minutes = 480 tx/day
- Marketplace trades: variable, scales with player count
- Pack opens: variable
- Drone mints: variable
- Stat upgrades (if on-chain): scales with active players
- At moderate scale (500 active drones): thousands of on-chain interactions per day from natural gameplay alone
