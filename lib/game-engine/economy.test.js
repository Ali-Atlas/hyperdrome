import { randomUUID } from 'node:crypto';
import {
  calculateStatUpgradeCost,
  calculateTotalUpgradeCost,
  calculateTSB,
  calculatePerStatCap,
  calculateXPToNextLevel,
  calculateRacePoints,
  calculateNewElo,
  validateStatAllocation,
  analyzeDronePerformance,
} from './economy.js';
import {
  allocateStatsSchema,
  toggleDroneSchema,
  createListingSchema,
  paginationSchema,
} from '../validators/index.js';

let passed = 0;
let failed = 0;

function eq(name, expected, actual) {
  const match = JSON.stringify(expected) === JSON.stringify(actual);
  if (match) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${name}`);
    console.log(`      expected: ${JSON.stringify(expected)}`);
    console.log(`      actual:   ${JSON.stringify(actual)}`);
  }
}

/* -------------------------------------------------------------------------- */
console.log('\ncalculateStatUpgradeCost');
eq('cost at 1',  1,  calculateStatUpgradeCost(1));
eq('cost at 9',  1,  calculateStatUpgradeCost(9));
eq('cost at 10', 2,  calculateStatUpgradeCost(10));
eq('cost at 50', 6,  calculateStatUpgradeCost(50));
eq('cost at 99', 10, calculateStatUpgradeCost(99));

/* -------------------------------------------------------------------------- */
console.log('\ncalculateTotalUpgradeCost');
eq('total 1->100',            549, calculateTotalUpgradeCost(1, 100));
eq('total 1->10',              9,  calculateTotalUpgradeCost(1, 10));
eq('total 10->20',             20, calculateTotalUpgradeCost(10, 20));
eq('total 5->5 (no change)',   0,  calculateTotalUpgradeCost(5, 5));
eq('total 10->5 (decrease)',   0,  calculateTotalUpgradeCost(10, 5));

/* -------------------------------------------------------------------------- */
console.log('\ncalculateTSB');
eq('TSB lv1',  29,  calculateTSB(1));
eq('TSB lv5',  109, calculateTSB(5));
eq('TSB lv10', 209, calculateTSB(10));
eq('TSB lv20', 409, calculateTSB(20));

/* -------------------------------------------------------------------------- */
console.log('\ncalculatePerStatCap');
eq('cap lv1',  14,  calculatePerStatCap(1));
eq('cap lv5',  32,  calculatePerStatCap(5));
eq('cap lv10', 55,  calculatePerStatCap(10));
eq('cap lv15', 77,  calculatePerStatCap(15));
eq('cap lv20', 100, calculatePerStatCap(20));

/* -------------------------------------------------------------------------- */
console.log('\ncalculateXPToNextLevel');
eq('xp to lv2',  300,   calculateXPToNextLevel(1));
eq('xp to lv6',  7500,  calculateXPToNextLevel(5));
eq('xp to lv11', 30000, calculateXPToNextLevel(10));

/* -------------------------------------------------------------------------- */
console.log('\ncalculateRacePoints');
eq('points even elo',         4, calculateRacePoints(1, 1000, 1000));
eq('points upset win (+2)',   6, calculateRacePoints(1, 900, 1100));
eq('points favourite win',    6, calculateRacePoints(3, 1200, 1100));

/* -------------------------------------------------------------------------- */
console.log('\ncalculateNewElo');
const evenMatch = calculateNewElo(1000, 1000);
eq('even match winner gains 16', 1016, evenMatch.newWinnerElo);
eq('even match loser loses 16',  984,  evenMatch.newLoserElo);

const upset = calculateNewElo(900, 1100); // lower-rated wins
eq('upset: winner gained > 16',      true, upset.newWinnerElo > 916);
eq('upset: loser lost > 16',         true, upset.newLoserElo < 1084);

/* -------------------------------------------------------------------------- */
console.log('\nvalidateStatAllocation');

const baseDrone = {
  level: 1,
  unspentPoints: 20,
  speed: 1, turning: 1, acceleration: 1, durability: 1,
  nightVision: 1, batteryCapacity: 1, rainHandling: 1,
  windResistance: 1, consistency: 1,
};

const ok = validateStatAllocation(baseDrone, { speed: 5 });
eq('valid: speed 1->5',           true, ok.valid);
eq('valid: cost is 4',            4,    ok.totalCost);

const overCap = validateStatAllocation(baseDrone, { speed: 20 });
eq('invalid: over level cap',     false, overCap.valid);

const overBudget = validateStatAllocation(
  { ...baseDrone, unspentPoints: 2 },
  { speed: 5 },
);
eq('invalid: insufficient points', false, overBudget.valid);

const decrease = validateStatAllocation(
  { ...baseDrone, speed: 5 },
  { speed: 3 },
);
eq('invalid: stat decrease',       false, decrease.valid);

const snakeCase = validateStatAllocation(baseDrone, {
  night_vision: 3,
  rain_handling: 2,
});
eq('valid: snake_case input',      true, snakeCase.valid);

/* -------------------------------------------------------------------------- */
console.log('\nanalyzeDronePerformance');

const speedster = {
  speed: 80, turning: 10, acceleration: 70, durability: 10,
  nightVision: 5, batteryCapacity: 10, rainHandling: 5,
  windResistance: 60, consistency: 20,
};
const speedsterAnalysis = analyzeDronePerformance(speedster);
eq(
  'speedster optimal includes Straight Lines',
  true,
  speedsterAnalysis.optimal.includes('Straight Lines'),
);
eq(
  'speedster poor includes Rain',
  true,
  speedsterAnalysis.poor.includes('Rain'),
);

/* -------------------------------------------------------------------------- */
console.log('\nZod validators');

const okAllocate = allocateStatsSchema.safeParse({
  drone_id: randomUUID(),
  stat_changes: { speed: 5, turning: 3, night_vision: 2 },
});
eq('allocateStats valid shape', true, okAllocate.success);

const badUuid = allocateStatsSchema.safeParse({
  drone_id: 'not-a-uuid',
  stat_changes: { speed: 5 },
});
eq('allocateStats rejects bad uuid', false, badUuid.success);

const okToggle = toggleDroneSchema.safeParse({
  drone_id: randomUUID(),
  active: true,
});
eq('toggleDrone valid shape', true, okToggle.success);

const missingField = createListingSchema.safeParse({
  item_type: 'drone',
  price: 500,
});
eq('createListing rejects missing drone_id', false, missingField.success);

const okPagination = paginationSchema.safeParse({ page: '2', limit: '50' });
eq('pagination coerces strings',   true, okPagination.success);
eq('pagination page=2',            2,    okPagination.data?.page);
eq('pagination limit=50',          50,   okPagination.data?.limit);
eq('pagination defaults sort_order', 'desc', okPagination.data?.sort_order);

const badPagination = paginationSchema.safeParse({ page: '-1' });
eq('pagination rejects negative page', false, badPagination.success);

/* -------------------------------------------------------------------------- */
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
