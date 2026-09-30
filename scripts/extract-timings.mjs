// Reduces the harness's per-frame timing recordings of the original
// (reference/timings/*.json, from tests/visual/timings.json) to the events that
// tests/unit/timing.test.ts checks frame by frame: tests/fixtures/timings.json.
//
//   node scripts/make-harness.mjs --list tests/visual/timings.json --out reference/timings
//   node scripts/extract-timings.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const load = (n) => JSON.parse(readFileSync(`reference/timings/${n}.json`, 'utf8')).frames;
// Row i holds the state after step i + 1: [hp, pulse, elapsed, progress, boss, enemyHp, dead].
const step = (i) => i + 1;
const pulses = (d) => d.flatMap((r, i) => (i > 0 && r[1] < d[i - 1][1] ? [step(i)] : []));
const round = (v) => Math.round(v * 1e6) / 1e6;

const drain = load('timing_drain');
const kill = load('timing_kill');
const boss = load('timing_boss');

const specs = JSON.parse(readFileSync('tests/visual/timings.json', 'utf8'));
/** A placed square fought under the reticle: its health and the player's after every change. */
const fight = (name) => {
  const d = load(name);
  const spec = specs.find((s) => s.name === name);
  return {
    profile: spec.profile ?? {},
    cursor: spec.timing.cursor,
    pulseSteps: pulses(d).slice(0, 6),
    enemyHpSteps: d.flatMap((r, i) => (i > 0 && r[5] !== d[i - 1][5] ? [{ step: step(i), enemyHp: round(r[5]), playerHp: round(r[0]) }] : [])),
    hpAtStep: Object.fromEntries([1, 60, 450, 900].filter((s) => s <= d.length).map((s) => [s, round(d[s - 1][0])])),
  };
};

const out = {
  source: 'Measured in the original (Godot harness, --fixed-fps 60, tests/visual/timings.json). Fresh save at prestige 0 unless a profile is given. Steps are 1-based 60 Hz frames.',
  drain: {
    cursor: [20, 20],
    pulseSteps: pulses(drain).slice(0, 10),
    hpAtStep: Object.fromEntries([60, 600, 1800, 2940, 3000].map((s) => [s, round(drain[s - 1][0])])),
    deadStep: step(drain.findIndex((r) => r[6])),
  },
  kill: {
    cursor: [240, 135],
    enemyHpSteps: kill.flatMap((r, i) => (i > 0 && r[5] !== kill[i - 1][5] ? [{ step: step(i), enemyHp: round(r[5]), playerHp: round(r[0]) }] : [])),
  },
  builds: [fight('timing_p1_build'), fight('timing_p3_build')],
  boss: {
    cursor: [2, 2],
    bossStep: step(boss.findIndex((r) => r[4])),
    progressAtStep: Object.fromEntries([60, 1350, 2699].map((s) => [s, round(boss[s - 1][3])])),
  },
};
mkdirSync('tests/fixtures', { recursive: true });
writeFileSync('tests/fixtures/timings.json', JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out, null, 1));
