// Timing and mechanics of a session, checked against research/gameplay.md
// (derived line by line from the original's GDScript).
import { describe, expect, it } from 'vitest';
import { STEP } from '../../src/core/loop';
import { content } from '../../src/data/content';
import { Battle, type Enemy } from '../../src/sim/battle';
import { newProfile, type Profile } from '../../src/sim/profile';
import { computeStats, type Stats } from '../../src/sim/stats';

function setup(opts: { levels?: Record<string, number>; stats?: Partial<Stats>; prestige?: number; maxPrestige?: number; seed?: number; cursor?: { x: number; y: number }; profile?: Partial<Profile> } = {}) {
  const profile = { ...newProfile(), ...opts.profile };
  profile.upgrades = opts.levels ?? {};
  profile.curr_prestige = opts.prestige ?? 0;
  profile.max_prestige = opts.maxPrestige ?? profile.curr_prestige;
  const stats = { ...computeStats(profile.upgrades), ...opts.stats } as Stats;
  const b = new Battle({ profile, stats, seed: opts.seed ?? 1, cursor: opts.cursor ?? { x: 240, y: 135 } });
  // spawn_rate 0 means an empty field (the spawner would still start with 2 queued enemies).
  if (stats.spawn_rate === 0) b.spawnAcc = 0;
  return { b, profile, stats };
}

/** One frame: accumulating 1/60 s steps in floating point can land a frame late, as in Godot. */
const FRAME = 1 / 60 + 1e-9;
const near = (t: number, want: number) => expect(Math.abs(t - want)).toBeLessThanOrEqual(FRAME);

/** Run until `until` returns true or `seconds` pass; returns the time. */
function runUntil(b: Battle, until: (b: Battle) => boolean, seconds: number, mouse = { x: 240, y: 135 }): number {
  for (let i = 0; i < seconds * 60; i++) {
    b.step(STEP, mouse);
    if (until(b)) return (i + 1) * STEP;
  }
  return Infinity;
}

function put(b: Battle, kind: string, x: number, y: number, currency: 'bits' | 'nodes' | 'processors' = 'bits'): Enemy {
  const e = b.spawnEnemy(currency, kind);
  e.x = x;
  e.y = y;
  e.speed = 0;
  e.rotateSpeed = 0;
  e.rotation = 0;
  return e;
}

const quiet = { spawn_rate: 0 };

describe('timings (fresh save, prestige 0)', () => {
  it('first attack pulse happens at 2.0 s', () => {
    const { b } = setup({ stats: quiet });
    const t = runUntil(b, (x) => x.events.some((e) => e.type === 'attack'), 5);
    near(t, 2.0);
  });

  it('a 3 HP square under the reticle dies on the third pulse, at 6.0 s', () => {
    const { b } = setup({ stats: quiet });
    const sq = put(b, 'Square', 240, 135);
    expect(sq.maxHp).toBe(3);
    const t = runUntil(b, () => sq.dead, 10);
    near(t, 6.0);
  });

  it('health drains 0.2/s and runs out at 50 s', () => {
    const { b } = setup({ stats: quiet, prestige: 0, maxPrestige: 1 });
    expect(b.progressVisible).toBe(false);
    runUntil(b, () => false, 10);
    expect(b.hp).toBeCloseTo(8, 6);
    const t = runUntil(b, (x) => x.status !== null, 60);
    expect(10 + t).toBeGreaterThan(49.95);
    expect(10 + t).toBeLessThan(50.05);
    expect(b.status).toBe(0);
  });

  it('the boss appears when the 45 s progress bar fills', () => {
    const { b } = setup({ stats: quiet, cursor: { x: 0, y: 0 } });
    const t = runUntil(b, (x) => x.bossSpawned, 60, { x: 0, y: 0 });
    expect(t).toBeCloseTo(45, 1);
    const boss = b.enemies.find((e) => e.boss)!;
    expect(boss.maxHp).toBe(120);
    expect(boss.damage).toBe(5);
    expect(boss.speed).toBe(15);
  });

  it('no boss or progress bar when replaying a lower prestige', () => {
    const { b } = setup({ stats: quiet, prestige: 2, maxPrestige: 5 });
    runUntil(b, () => false, 50);
    expect(b.enemies.some((e) => e.boss)).toBe(false);
  });

  it('spawns 2 enemies on the first frame, then one every 1/0.33 s', () => {
    const { b } = setup({ cursor: { x: 0, y: 0 } });
    b.step(STEP, { x: 0, y: 0 });
    expect(b.enemies).toHaveLength(2);
    const t = runUntil(b, (x) => x.enemies.length === 3, 10, { x: 0, y: 0 });
    // acc starts at 2 + 0.33/60 after frame 1; the third spawn needs acc to reach 1 again.
    expect(t + STEP).toBeCloseTo(1 / 0.33, 1);
  });

  it('enemy damage grows linearly: 0.4 + 0.015 t at prestige 0', () => {
    const { b } = setup({ stats: quiet });
    runUntil(b, () => false, 20);
    const e = put(b, 'Square', 10, 10);
    expect(e.damage).toBeCloseTo(0.4 + 0.015 * 20, 6);
    expect(e.maxHp).toBeCloseTo(3 + 0.15 * 20, 6);
  });

  it('an enemy hit by the reticle hits back for damage minus armor', () => {
    const { b } = setup({ stats: { ...quiet, armor: 0.2 } });
    put(b, 'Square', 240, 135);
    runUntil(b, (x) => x.events.some((e) => e.type === 'attack'), 5);
    // 10 - 2 s of drain (0.4, plus at most one frame) - (0.4 - 0.2) from the hit
    expect(b.hp).toBeLessThanOrEqual(10 - 0.4 - 0.2 + 1e-9);
    expect(b.hp).toBeGreaterThanOrEqual(10 - 0.4 - 0.2 - 0.2 / 60 - 1e-9);
  });

  it('two attack speed nodes give 0.7 attacks/s', () => {
    const { b } = setup({ stats: quiet, levels: { AttackSpeed1: 1, AttackSpeed2: 1 } });
    const times: number[] = [];
    for (let i = 0; i < 5 * 60; i++) {
      b.step(STEP, { x: 240, y: 135 });
      if (b.events.some((e) => e.type === 'attack')) times.push((i + 1) * STEP);
    }
    expect(times[0]).toBeCloseTo(1 / 0.7, 1);
    expect(times[1] - times[0]).toBeCloseTo(1 / 0.7, 1);
  });
});

describe('drops, xp and rewards', () => {
  it('a red kill at prestige 1 drops 1 + 1 Bits (prestige bit boost)', () => {
    const { b, profile } = setup({ stats: quiet, prestige: 1, maxPrestige: 1 });
    const e = put(b, 'Square', 240, 135);
    e.hp = e.maxHp = 1;
    runUntil(b, () => e.dead, 5);
    expect(b.drops).toHaveLength(2);
    runUntil(b, () => b.drops.length === 0, 3);
    expect(profile.bits).toBe(2);
    expect(profile.total_bits).toBe(2);
    expect(profile.nums.reds_killed).toBe(1);
  });

  it('drops never expire', () => {
    const { b } = setup({ stats: quiet, prestige: 0, maxPrestige: 3 });
    const e = put(b, 'Square', 100, 100);
    b.takeDamage(e, 100);
    b.step(STEP, { x: 400, y: 250 });
    expect(b.drops).toHaveLength(1);
    runUntil(b, () => false, 30, { x: 400, y: 250 });
    expect(b.drops).toHaveLength(1);
  });

  it('bit_value 1.4 (prestige 7) gives 1 or 2 Bits per drop, 1.4 on average', () => {
    const { b, profile } = setup({ stats: { ...quiet, autocollect_chance: 1 }, prestige: 7, maxPrestige: 7 });
    for (let i = 0; i < 500; i++) {
      const e = put(b, 'Square', 10, 10);
      b.takeDamage(e, 1e12);
      b.step(STEP, { x: 400, y: 250 });
    }
    // Each kill at P7 drops 1 + 18 bit boost = 19 drops, each worth 1 or 2.
    expect(profile.bits / (500 * 19)).toBeCloseTo(1.4, 1);
  });

  it('excess XP past one level is lost (the bar clamps)', () => {
    const { b, profile } = setup({ stats: quiet, prestige: 12, maxPrestige: 12 });
    const e = put(b, 'Square', 10, 10);
    b.takeDamage(e, 1e12); // 27 XP at P12; level 0 needs 50
    expect(profile.level).toBe(0);
    expect(b.xp).toBe(27);
    const e2 = put(b, 'BigSquare', 10, 10); // 27 * 4 = 108 XP
    b.takeDamage(e2, 1e12);
    expect(profile.level).toBe(1);
    expect(profile.sp).toBe(1);
    expect(b.xp).toBe(0);
    expect(b.xpMax).toBe(300);
  });

  it('killing the boss at max prestige gives a Core and unlocks the next prestige', () => {
    const { b, profile } = setup({ stats: quiet });
    const boss = b.spawnBoss();
    b.takeDamage(boss, 1e9);
    expect(b.status).toBe(1);
    expect(profile.cores).toBe(1);
    expect(profile.max_prestige).toBe(1);
    expect(profile.curr_prestige).toBe(1);
    expect(b.collected.get('cores')).toBe(1);
  });

  it('prestige 25 resets nothing: the boss gives another Core, prestige stays 25', () => {
    const { b, profile } = setup({ stats: quiet, prestige: 25, maxPrestige: 25, profile: { cores: 25 } });
    const boss = b.spawnBoss();
    expect(boss.rainbow).toBe(true);
    b.takeDamage(boss, 1e12);
    expect(profile.cores).toBe(26);
    expect([profile.curr_prestige, profile.max_prestige]).toEqual([25, 25]);
  });

  it('terminating keeps what was already collected', () => {
    const { b, profile } = setup({ stats: { ...quiet, autocollect_chance: 1 } });
    const e = put(b, 'Square', 10, 10);
    b.takeDamage(e, 100);
    b.step(STEP);
    b.terminate();
    expect(b.status).toBe(2);
    expect(profile.bits).toBe(1);
  });
});

describe('combat rules ported from the original', () => {
  it('the boss damage bonus leaks to enemies hit after the boss in the same pulse', () => {
    const { b } = setup({ stats: { ...quiet, boss_damage_mod: 1 } });
    const boss = b.spawnBoss();
    boss.x = 240;
    boss.y = 135;
    boss.speed = 0;
    boss.rotateSpeed = 0;
    boss.rotation = 0;
    const sq = put(b, 'Square', 240, 135);
    sq.hp = sq.maxHp = 100;
    runUntil(b, (x) => x.events.some((e) => e.type === 'attack'), 5);
    expect(boss.maxHp - boss.hp).toBe(2); // 1 * (1 + 1)
    expect(sq.maxHp - sq.hp).toBe(2); // leaked bonus
  });

  it('pulse bolts fire evenly spaced, the first straight up', () => {
    const { b } = setup({ stats: quiet, levels: { PulseBolts: 1 } });
    runUntil(b, (x) => x.bolts.length > 0, 5);
    expect(b.bolts.map((x) => x.angle)).toEqual([-90, 30, 150]);
  });

  it('undamaged and execute bonuses follow take_damage', () => {
    const { b } = setup({ stats: { ...quiet, undamaged_mod: 0.25, execute_mod: 1 } });
    const e = put(b, 'Square', 10, 10);
    e.hp = e.maxHp = 100;
    b.takeDamage(e, 10); // undamaged: 12.5
    expect(e.hp).toBeCloseTo(87.5, 9);
    e.hp = 50;
    b.takeDamage(e, 10); // at 50%: execute doubles
    expect(e.hp).toBeCloseTo(30, 9);
  });

  it('an exploder corpse is hit by its own blast (still in queries until the frame ends)', () => {
    const { b } = setup({ stats: { ...quiet, health_on_hit: 1 } });
    b.hp = 5;
    const ex = put(b, 'Exploder', 100, 100);
    b.takeDamage(ex, 100);
    // The blast hits the dead exploder once: +1 HP from health_on_hit.
    expect(b.hp).toBe(6);
  });

  it('pentagons split into six small pentagons of the same colour', () => {
    const { b } = setup({ stats: quiet, prestige: 5, maxPrestige: 5 });
    const p = put(b, 'Pentagon', 200, 100, 'nodes');
    b.takeDamage(p, 1e9);
    b.step(STEP, { x: 0, y: 0 });
    const kids = b.enemies.filter((e) => e.kind === 'PentagonSmall');
    expect(kids).toHaveLength(6);
    expect(kids.every((k) => k.currency === 'nodes' && Math.hypot(k.x - 200, k.y - 100) <= 41)).toBe(true);
  });

  it('is deterministic for a given seed', () => {
    const run = () => {
      const { b, profile } = setup({ seed: 1234, levels: { Damage1: 5, SpawnRate1: 5, PulseBolts: 1, MovingPulser1: 1 } });
      for (let i = 0; i < 60 * 40; i++) b.step(STEP, { x: 240 + 100 * Math.sin(i / 50), y: 135 + 60 * Math.cos(i / 70) });
      return JSON.stringify([profile.bits, profile.nums, b.hp, b.enemies.map((e) => [e.x, e.y, e.hp])]);
    };
    expect(run()).toBe(run());
  });
});

describe('content hookups', () => {
  it('uses the prestige table for enemies', () => {
    const { b } = setup({ stats: quiet, prestige: 9, maxPrestige: 9 });
    const s = put(b, 'Spiky', 10, 10);
    expect(s.maxHp).toBe(60000 * 2);
    expect(s.damage).toBe(5300 * 3);
    expect(content.prestige.levels[9].spawnWeights.Spiky).toBe(0.02);
  });
});
