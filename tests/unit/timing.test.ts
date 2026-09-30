// Frame-exact timing against the original: the same sessions were run in the
// original through the Godot harness (tests/visual/timings.json) and reduced to
// events by scripts/extract-timings.mjs (tests/fixtures/timings.json).
import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/timings.json';
import { STEP } from '../../src/core/loop';
import { Battle, type Enemy } from '../../src/sim/battle';
import { newProfile } from '../../src/sim/profile';
import { computeStats } from '../../src/sim/stats';

function session(cursor: number[], spawning: boolean, p: { upgrades?: Record<string, number>; curr_prestige?: number; max_prestige?: number } = {}) {
  const profile = { ...newProfile(), ...p };
  profile.upgrades = { ...(p.upgrades ?? {}) };
  const stats = computeStats(profile.upgrades);
  const at = { x: cursor[0], y: cursor[1] };
  if (!spawning) stats.spawn_rate = 0;
  const b = new Battle({ profile, stats, seed: 7, cursor: at });
  // EnemySpawner.set_process(false) in the harness: nothing spawns, not even the first two.
  if (!spawning) b.spawnAcc = 0;
  return { b, at };
}

describe('timings measured in the original (fresh save, prestige 0)', () => {
  it('health drain, attack pulses and death land on the same frames', () => {
    const f = fixture.drain;
    const { b, at } = session(f.cursor, false);
    const pulses: number[] = [];
    let dead = -1;
    const hp: Record<string, number> = {};
    for (let s = 1; s <= 3060 && dead < 0; s++) {
      const before = b.pulseTime;
      b.step(STEP, at);
      if (b.pulseTime < before) pulses.push(s);
      if (String(s) in f.hpAtStep) hp[s] = Math.round(b.hp * 1e6) / 1e6;
      if (b.status !== null) dead = s;
    }
    expect(pulses.slice(0, f.pulseSteps.length)).toEqual(f.pulseSteps);
    expect(hp).toEqual(f.hpAtStep);
    expect(dead).toBe(f.deadStep);
  });

  it('a 3 HP square under the reticle loses 1 HP per pulse and hits back for 0.4', () => {
    const f = fixture.kill;
    const { b, at } = session(f.cursor, false);
    const e: Enemy = b.spawnEnemy('bits', 'Square');
    e.x = at.x;
    e.y = at.y;
    e.speed = 0;
    e.rotateSpeed = 0;
    const changes: { step: number; enemyHp: number; playerHp: number }[] = [];
    let last = e.hp;
    for (let s = 1; s <= 420; s++) {
      b.step(STEP, at);
      const now = e.dead ? -1 : e.hp;
      if (now !== last) changes.push({ step: s, enemyHp: now, playerHp: Math.round(b.hp * 1e6) / 1e6 });
      last = now;
    }
    expect(changes).toEqual(f.enemyHpSteps);
  });

  it.each(fixture.builds.map((b, i) => [i, b] as const))('build %i: prestige enemy stats, damage, armor, lifesteal and regen match frame by frame', (_i, f) => {
    const { b, at } = session(f.cursor, false, f.profile as unknown as Parameters<typeof session>[2]);
    const e: Enemy = b.spawnEnemy('bits', 'Square');
    e.x = at.x;
    e.y = at.y;
    e.speed = 0;
    e.rotateSpeed = 0;
    const changes: { step: number; enemyHp: number; playerHp: number }[] = [];
    const pulses: number[] = [];
    const hp: Record<string, number> = {};
    let last = e.hp;
    for (let s = 1; s <= 900; s++) {
      const before = b.pulseTime;
      b.step(STEP, at);
      if (b.pulseTime < before) pulses.push(s);
      const now = e.dead ? -1 : e.hp;
      if (now !== last) changes.push({ step: s, enemyHp: now, playerHp: Math.round(b.hp * 1e6) / 1e6 });
      last = now;
      if (String(s) in f.hpAtStep) hp[s] = Math.round(b.hp * 1e6) / 1e6;
    }
    expect(pulses.slice(0, f.pulseSteps.length)).toEqual(f.pulseSteps);
    expect(changes).toEqual(f.enemyHpSteps);
    expect(hp).toEqual(f.hpAtStep);
  });

  it('the boss arrives on the same frame', () => {
    const f = fixture.boss;
    const { b, at } = session(f.cursor, true);
    let bossStep = -1;
    const progress: Record<string, number> = {};
    for (let s = 1; s <= 2760 && bossStep < 0; s++) {
      b.step(STEP, at);
      if (String(s) in f.progressAtStep) progress[s] = Math.round(b.progress * 1e6) / 1e6;
      if (b.enemies.some((x) => x.boss && !x.removed)) bossStep = s;
    }
    expect(bossStep).toBe(f.bossStep);
    expect(progress).toEqual(f.progressAtStep);
  });
});
