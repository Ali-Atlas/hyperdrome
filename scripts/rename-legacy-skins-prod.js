#!/usr/bin/env node
/**
 * Rename "Legacy <Rarity> <NNN>" placeholder skins (and any generic mod
 * rows) in the PRODUCTION database to themed names sourced from the dev
 * seed catalog (lib/db/seed.js), with curated overflow names for rarities
 * where placeholder count exceeds the dev pool.
 *
 * Connects to PROD_DATABASE_URL. Defaults to --dry-run; pass --commit to
 * actually write. Idempotent: rows whose name is already non-Legacy /
 * non-generic are skipped.
 *
 * Per-rarity assignment is deterministic. Legacy rows are sorted by id
 * (uuid lex order); position N gets pool[N % pool.length]. Re-running
 * after a commit finds zero matching rows so nothing happens.
 *
 * Run from the repo root:
 *   node scripts/rename-legacy-skins-prod.js              # dry-run
 *   node scripts/rename-legacy-skins-prod.js --commit     # apply
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { neon } from '@neondatabase/serverless';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
  }
}

const PROD_URL = process.env.PROD_DATABASE_URL;
if (!PROD_URL) {
  console.error('PROD_DATABASE_URL not set in .env.local or environment');
  process.exit(1);
}

const COMMIT = process.argv.includes('--commit');
const sql = neon(PROD_URL);

/* -------------------------------------------------------------------------- */
/* Name pools per rarity                                                       */
/*                                                                             */
/* Dev seed sources (lib/db/seed.js SKIN_NAMES):                               */
/*   common: 30, rare: 15, epic: 8, legendary: 3                               */
/* Production placeholder split (scripts/seed-production.js):                  */
/*   common: 28, rare: 24, epic: 14, legendary: 4                              */
/*                                                                             */
/* Common is covered by the dev pool. Rare/epic/legendary need overflow.       */
/* Overflow names match the dev seed tone (techy, sci-fi, aggressive) and      */
/* are checked against IMAGE_BACKED_SKINS in seed-production.js so no name     */
/* collides with an existing real catalog row.                                 */
/* -------------------------------------------------------------------------- */

const SKIN_NAME_POOLS = {
  common: [
    'Carbon Fiber', 'Gunmetal', 'Stealth Gray', 'Arctic White', 'Obsidian',
    'Matte Black', 'Brushed Steel', 'Copper Plate', 'Navy Blue', 'Forest Green',
    'Desert Tan', 'Slate Gray', 'Rust Patina', 'Industrial Iron', 'Concrete',
    'Military Olive', 'Plasma Gray', 'Alloy Silver', 'Chrome Plate', 'Warning Yellow',
    'Flare Orange', 'Ember Red', 'Cool Blue', 'Stormcloud', 'Midnight Black',
    'Ash Gray', 'Riveted Steel', 'Bronze Plating', 'Aluminum Finish', 'Coal Matte',
  ],
  rare: [
    // Dev seed (15)
    'Neon Pulse', 'Cyber Stripe', 'Electric Blue', 'Hologram', 'Signal Red',
    'Grid Runner', 'Data Stream', 'Binary Wave', 'Tron Line', 'Synthwave',
    'Laser Mesh', 'Circuit Board', 'Prism', 'Quantum Weave', 'Plasma Core',
    // Curated overflow (9)
    'Phantom Edge', 'Iron Veil', 'Cobalt Strike', 'Static Drift', 'Mirror Coil',
    'Spectral Mesh', 'Voltage Husk', 'Ion Lattice', 'Nova Burst',
  ],
  epic: [
    // Dev seed (8)
    'Inferno Phoenix', 'Tidal Surge', 'Thunder Strike', 'Void Walker',
    'Blizzard Hunter', 'Volcanic Drift', 'Celestial Guard', 'Zephyr Dancer',
    // Curated overflow (6)
    'Eclipse Prowler', 'Ember Coil', 'Glacial Tempest', 'Stormcaller',
    'Riftwalker', 'Aurora Reaver',
  ],
  legendary: [
    // Dev seed (3)
    'Chimera', 'Phoenix Reborn', 'Dragonlord',
    // Curated overflow (1)
    'Onyx Sovereign',
  ],
};

/* -------------------------------------------------------------------------- */
/* Mod placeholder pools                                                       */
/*                                                                             */
/* Production seed (scripts/seed-production.js#MOD_TEMPLATES) already uses     */
/* themed mod names (Streamline Plate, Phantom Drive, etc.) so this pool is    */
/* a fallback in case the prod DB has been hand-seeded with a placeholder      */
/* row pattern. Leave empty if no candidates are found.                        */
/* -------------------------------------------------------------------------- */

const MOD_NAME_POOLS = {
  common: [
    'Lattice Plate', 'Tilt Vane', 'Pulse Coil', 'Drift Spool', 'Carbon Brace',
    'Grit Liner', 'Beam Lens', 'Gust Comb', 'Spark Capacitor', 'Frame Wedge',
  ],
  rare: [
    'Vortex Cowl', 'Riptide Plating', 'Ember Manifold', 'Talon Servo',
    'Halo Optics', 'Surge Capacitor', 'Scythe Aileron', 'Anchor Brace',
  ],
  epic: [
    'Wraith Drive', 'Cinder Hull', 'Maelstrom Module', 'Hawkeye Lens',
    'Bulwark Plating',
  ],
  legendary: [
    'Aegis Override', 'Apex Sync', 'Cataclysm Drive',
  ],
};

/* Patterns we treat as "needs renaming". Skin: 'Legacy Common 001', etc.
 * Mod: same patterns plus any obvious placeholder convention. */
const SKIN_PLACEHOLDER_RE = /^Legacy (Common|Rare|Epic|Legendary) \d+/;
const MOD_PLACEHOLDER_RE = /^(Legacy|Generic|Placeholder) (Common|Rare|Epic|Legendary)? ?\d+/;

/* -------------------------------------------------------------------------- */

async function loadExistingNames(table) {
  // Neon's tagged-template `sql` doesn't allow string interpolation for
  // identifiers, so use sql.query() with the table name validated against
  // an allowlist below.
  const allowed = new Set(['skins', 'mods']);
  if (!allowed.has(table)) throw new Error(`unsafe table name: ${table}`);
  const rows = await sql.query(`SELECT name FROM ${table}`);
  return new Set(rows.map((r) => r.name));
}

async function planSkinRenames() {
  const rows = await sql`
    SELECT id, name, rarity
    FROM skins
    WHERE name LIKE 'Legacy %'
    ORDER BY id
  `;

  const existingNames = await loadExistingNames('skins');
  // Don't reuse a name that already exists outside our placeholder pool;
  // schema allows duplicate names but we should keep the rename clean.
  // The pools themselves may also collide if the same name slot is hit
  // on multiple placeholder rows; that's fine and matches how vault
  // copies share names today.

  const byRarity = {};
  for (const row of rows) {
    if (!SKIN_PLACEHOLDER_RE.test(row.name)) continue;
    if (!byRarity[row.rarity]) byRarity[row.rarity] = [];
    byRarity[row.rarity].push(row);
  }

  const plan = [];
  for (const [rarity, list] of Object.entries(byRarity)) {
    const pool = SKIN_NAME_POOLS[rarity];
    if (!pool || pool.length === 0) {
      console.warn(`  no pool for rarity '${rarity}', skipping ${list.length} rows`);
      continue;
    }
    list.forEach((row, i) => {
      const newName = pool[i % pool.length];
      plan.push({
        id: row.id,
        rarity,
        oldName: row.name,
        newName,
        existedAlready: existingNames.has(newName),
      });
    });
  }
  return plan;
}

async function planModRenames() {
  const rows = await sql`
    SELECT id, name, rarity
    FROM mods
    WHERE name LIKE 'Legacy %' OR name LIKE 'Generic %' OR name LIKE 'Placeholder %'
    ORDER BY id
  `;

  const byRarity = {};
  for (const row of rows) {
    if (!MOD_PLACEHOLDER_RE.test(row.name)) continue;
    if (!byRarity[row.rarity]) byRarity[row.rarity] = [];
    byRarity[row.rarity].push(row);
  }

  const plan = [];
  for (const [rarity, list] of Object.entries(byRarity)) {
    const pool = MOD_NAME_POOLS[rarity];
    if (!pool || pool.length === 0) {
      console.warn(`  no mod pool for rarity '${rarity}', skipping ${list.length} rows`);
      continue;
    }
    list.forEach((row, i) => {
      plan.push({
        id: row.id,
        rarity,
        oldName: row.name,
        newName: pool[i % pool.length],
      });
    });
  }
  return plan;
}

function summarise(label, plan) {
  const counts = {};
  for (const p of plan) {
    counts[p.rarity] = (counts[p.rarity] ?? 0) + 1;
  }
  console.log(`\n${label}: ${plan.length} rows total`);
  for (const [rarity, n] of Object.entries(counts)) {
    console.log(`  ${rarity.padEnd(10)} ${n}`);
  }
}

function preview(plan, limitPerRarity = 5) {
  const seen = {};
  for (const p of plan) {
    seen[p.rarity] = (seen[p.rarity] ?? 0) + 1;
    if (seen[p.rarity] <= limitPerRarity) {
      console.log(
        `  ${p.rarity.padEnd(10)} ${p.oldName.padEnd(30)} -> ${p.newName}`,
      );
    } else if (seen[p.rarity] === limitPerRarity + 1) {
      console.log(`  ${p.rarity.padEnd(10)} ... (more)`);
    }
  }
}

async function applyRenames(table, plan) {
  const allowed = new Set(['skins', 'mods']);
  if (!allowed.has(table)) throw new Error(`unsafe table name: ${table}`);
  let written = 0;
  for (const p of plan) {
    await sql.query(
      `UPDATE ${table} SET name = $1 WHERE id = $2 AND name = $3`,
      [p.newName, p.id, p.oldName],
    );
    written += 1;
  }
  return written;
}

async function main() {
  console.log(
    `\nproduction skin/mod placeholder rename  (mode: ${COMMIT ? 'COMMIT' : 'DRY-RUN'})\n`,
  );

  const skinPlan = await planSkinRenames();
  summarise('skins to rename', skinPlan);
  if (skinPlan.length > 0) {
    console.log('\nsample skin renames:');
    preview(skinPlan);
  }

  const modPlan = await planModRenames();
  summarise('mods to rename', modPlan);
  if (modPlan.length > 0) {
    console.log('\nsample mod renames:');
    preview(modPlan);
  }

  if (!COMMIT) {
    console.log('\n(dry-run, no rows written. re-run with --commit to apply.)\n');
    return;
  }

  console.log('\napplying...');
  const skinsWritten = await applyRenames('skins', skinPlan);
  const modsWritten = await applyRenames('mods', modPlan);
  console.log(`\nskins renamed: ${skinsWritten}`);
  console.log(`mods  renamed: ${modsWritten}`);
  console.log('done.\n');
}

main().catch((err) => {
  console.error('rename script failed:', err);
  process.exit(1);
});
