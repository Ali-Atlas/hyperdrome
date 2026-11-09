/**
 * Browser verification of a settled race (SPEC.md 11): the race's commit and settle transactions
 * are read from a public RPC, then each claim is recomputed here. Only the snapshots and the log
 * come from our server, and both are checked against the chain's hashes and a local replay.
 */
import { TIME_OF_DAY, WEATHER } from '@/lib/game-engine/race-simulator.js';
import { sha256 } from '@/lib/game-engine/sha256.js';
import { TRACKS } from '@/lib/game-engine/tracks.js';
import { GAME_CONTRACT, fetchPublicTx } from '@/lib/near/public-rpc.js';
import { replayRace, snapshotHash } from '@/services/race-replay.js';

/**
 * @typedef {{ a: string, b: string, track: number, weather: number, tod: number }} Matchup
 * @typedef {{ a: string, b: string, winner: string, time_a_ms: number, time_b_ms: number, stats_hash_a: number[], stats_hash_b: number[] }} SettledResult
 * @typedef {{ batchId: number, seedHash: number[], seed: number[], matchup: Matchup, result: SettledResult }} RaceEntry
 * @typedef {{ key: string, label: string, pass: boolean, detail: string, txHash: string }} CheckLine
 */

/** @param {ArrayLike<number>} bytes */
const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/**
 * The JSON arguments of a finished call to the game contract. Throws unless the transaction
 * succeeded, was signed by and sent to the contract, and called `method`.
 * @param {any} tx the RPC's `tx` result
 * @param {string} method
 * @returns {any}
 */
export function decodeCallArgs(tx, method) {
  const { transaction, status } = tx;
  if (transaction.signer_id !== GAME_CONTRACT || transaction.receiver_id !== GAME_CONTRACT) {
    throw new Error(`Transaction is not from the game contract`);
  }
  if (status?.SuccessValue === undefined) throw new Error(`The ${method} transaction failed`);
  const call = transaction.actions[0]?.FunctionCall;
  if (call?.method_name !== method) throw new Error(`Transaction is not a ${method} call`);
  const bytes = Uint8Array.from(atob(call.args), (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

/**
 * This race's matchup and result from the two calls' arguments. A settle call covers the chunk
 * starting at `from`, so the result sits at the race index minus `from`.
 * @param {any} commitArgs
 * @param {any} settleArgs
 * @param {number} raceIndex
 * @returns {RaceEntry}
 */
export function pickRaceEntry(commitArgs, settleArgs, raceIndex) {
  if (commitArgs.batch_id !== settleArgs.batch_id) {
    throw new Error('The transactions belong to different batches');
  }
  const matchup = commitArgs.matchups[raceIndex];
  const result = settleArgs.results[raceIndex - settleArgs.from];
  if (!matchup || !result) throw new Error(`Race ${raceIndex} is not in these transactions`);
  return {
    batchId: commitArgs.batch_id,
    seedHash: commitArgs.seed_hash,
    seed: settleArgs.seed,
    matchup,
    result,
  };
}

/** @param {number} ms */
const seconds = (ms) => `${(ms / 1000).toFixed(3)} s`;

/**
 * The replay of this race from the settled seed, the snapshots and the committed conditions, or
 * null when the committed track or conditions are outside the tables.
 * @param {any} race the `GET /api/races/[id]` body
 * @param {RaceEntry} entry
 */
function replay(race, { batchId, seed, matchup }) {
  const track = TRACKS[matchup.track];
  const weather = WEATHER[matchup.weather];
  const timeOfDay = TIME_OF_DAY[matchup.tod];
  if (!track || !weather || !timeOfDay) return null;
  return replayRace({
    seed: toHex(seed),
    slot: batchId,
    index: Number(race.raceIndex),
    snapshotA: race.snapshotA,
    snapshotB: race.snapshotB,
    track,
    weather,
    timeOfDay,
  });
}

/**
 * Each check as its own line.
 * @param {any} race the `GET /api/races/[id]` body
 * @param {RaceEntry} entry
 * @param {{ commitTx: string, settleTx: string }} txs
 * @returns {CheckLine[]}
 */
export function raceCheckLines(race, entry, { commitTx, settleTx }) {
  const { matchup, result, seed, seedHash } = entry;
  const ran = replay(race, entry);
  const winner = ran ? (ran.winner === 'a' ? result.a : result.b) : null;
  const seedDigest = toHex(sha256(Uint8Array.from(seed)));
  const hashLine = (
    /** @type {string} */ key,
    /** @type {string} */ name,
    /** @type {any} */ snapshot,
    /** @type {number[]} */ settled
  ) => ({
    key,
    label: `${name} raced with the stats the contract checked`,
    pass: snapshotHash(snapshot) === toHex(settled),
    detail: `stats hash ${toHex(settled).slice(0, 12)}...`,
    txHash: settleTx,
  });
  return [
    {
      key: 'matchup',
      label: 'The settled drones are the committed matchup',
      pass: result.a === matchup.a && result.b === matchup.b,
      detail: `${matchup.a} against ${matchup.b}`,
      txHash: commitTx,
    },
    {
      key: 'seed',
      label: 'The revealed seed hashes to the committed seed hash',
      pass: seedDigest === toHex(seedHash),
      detail: `sha256 ${seedDigest.slice(0, 12)}...`,
      txHash: commitTx,
    },
    hashLine('statsA', race.drone1?.name ?? 'Drone 1', race.snapshotA, result.stats_hash_a),
    hashLine('statsB', race.drone2?.name ?? 'Drone 2', race.snapshotB, result.stats_hash_b),
    {
      key: 'winner',
      label: 'The replay gives the settled winner',
      pass: winner === result.winner,
      detail: `winner ${result.winner}`,
      txHash: settleTx,
    },
    {
      key: 'times',
      label: 'The replay gives both settled times',
      pass: ran?.timeAms === result.time_a_ms && ran?.timeBms === result.time_b_ms,
      detail: `${seconds(result.time_a_ms)} and ${seconds(result.time_b_ms)}`,
      txHash: settleTx,
    },
    {
      key: 'log',
      label: 'The replay gives the stored race log',
      pass: Boolean(ran) && JSON.stringify(ran?.log) === JSON.stringify(race.log),
      detail: `${race.log?.length ?? 0} segments`,
      txHash: settleTx,
    },
  ];
}

/**
 * Read both transactions from a public RPC and run every check.
 * @param {any} race the `GET /api/races/[id]` body
 * @param {typeof fetchPublicTx} [fetchTx]
 * @returns {Promise<CheckLine[]>}
 */
export async function verifyRaceOnChain(race, fetchTx = fetchPublicTx) {
  const [commit, settle] = await Promise.all([
    fetchTx(race.commitTx, GAME_CONTRACT),
    fetchTx(race.settleTx, GAME_CONTRACT),
  ]);
  const entry = pickRaceEntry(
    decodeCallArgs(commit, 'commit_batch'),
    decodeCallArgs(settle, 'settle_batch'),
    Number(race.raceIndex)
  );
  return raceCheckLines(race, entry, { commitTx: race.commitTx, settleTx: race.settleTx });
}
