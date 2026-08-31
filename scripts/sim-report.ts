/**
 * Print a human-readable report of the deterministic 30-day review simulation.
 *
 *   npx tsx scripts/sim-report.ts [seed] [days]
 *
 * Defaults: seed 0xc0ffee (same as the simulation test), 30 days.
 * This only reads the simulation harness in test/simulate.ts — no DB, no network.
 */

import process from 'node:process';

import { directionForLanguage } from '../src/i18n/direction.js';
import { DAY_MS } from '../src/scheduler/types.js';
import { runSimulation, SIM_PASSAGES, SIM_T0 } from '../test/simulate.js';

const seed = process.argv[2] ? Number(process.argv[2]) : 0xc0ffee;
const days = process.argv[3] ? Number(process.argv[3]) : 30;

if (!Number.isFinite(seed) || !Number.isInteger(days) || days <= 0) {
  console.error('usage: tsx scripts/sim-report.ts [seed:int] [days:int>0]');
  process.exit(1);
}

const { history, finalCards, reviewCount } = runSimulation(seed, days);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const profileOf = new Map(SIM_PASSAGES.map((p) => [p.id, p.profile]));
const langOf = new Map(SIM_PASSAGES.map((p) => [p.id, p.language]));

console.log(
  `\nseed 0x${seed.toString(16)} · ${days} days · anchor ${iso(SIM_T0)} · ${reviewCount} reviews\n`,
);

// ── final state per passage ────────────────────────────────────────────────
const rows = Object.entries(finalCards).map(([id, card]) => ({
  passage: id,
  lang: langOf.get(id) ?? '',
  dir: directionForLanguage(langOf.get(id) ?? ''),
  profile: profileOf.get(id) ?? '',
  state: card.state,
  reps: card.reps,
  lapses: card.lapses,
  ease: card.easeFactor.toFixed(2),
  'interval(d)': Math.round(card.intervalDays),
  due: iso(card.dueAt),
  leech: card.lapses >= 3 && card.easeFactor <= 1.3 ? 'YES' : '',
}));
console.table(rows);

// ── reviews per day ───────────────────────────────────────────────────────
const perDay: Record<string, number> = {};
for (let d = 0; d < days; d++) perDay[`day ${String(d).padStart(2, '0')} (${iso(SIM_T0 + d * DAY_MS)})`] = 0;
for (const step of history) {
  perDay[`day ${String(step.day).padStart(2, '0')} (${iso(SIM_T0 + step.day * DAY_MS)})`]++;
}
console.log('\nreviews per day (0 = nothing due):');
for (const [label, n] of Object.entries(perDay)) {
  console.log(`  ${label}  ${'#'.repeat(n)}${n === 0 ? '·' : ''} ${n}`);
}

// ── rating mix ────────────────────────────────────────────────────────────
const mix: Record<string, number> = { again: 0, hard: 0, good: 0, easy: 0 };
for (const step of history) mix[step.rating]++;
console.log('\nrating mix:');
for (const [rating, n] of Object.entries(mix)) {
  console.log(`  ${rating.padEnd(5)} ${n}  (${((n / reviewCount) * 100).toFixed(1)}%)`);
}
console.log();
