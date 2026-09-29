// Every value in content/ must match what research/ extracted from the original game.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildContent, content, costAt } from '../../src/data/content';

const research = (f: string) => JSON.parse(readFileSync(`research/data/${f}`, 'utf8'));
const R = {
  upgrades: research('upgrades.json'),
  prestige: research('prestige.json'),
  enemies: research('enemies.json'),
  xp: research('xp.json'),
  milestones: research('milestones.json'),
  mine: research('cryptomine.json'),
  stats: research('player-stats.json'),
};
const val = (x: { value: unknown } | unknown) => (x && typeof x === 'object' && 'value' in x ? (x as { value: unknown }).value : x);

describe('skill tree', () => {
  it('has all 97 nodes and 98 connections of the original', () => {
    expect(content.upgrades.nodes).toHaveLength(97);
    const edges = new Set<string>();
    for (const n of content.upgrades.nodes) for (const l of n.links) edges.add([n.id, l].sort().join('|'));
    expect(edges.size).toBe(98);
    expect([...edges].sort()).toEqual(R.upgrades.edges.map((e: string[]) => [...e].sort().join('|')).sort());
  });

  for (const r of R.upgrades.nodes) {
    it(`${r.id} (${r.name}) matches the original`, () => {
      const n = content.node.get(r.id)!;
      expect(n).toBeDefined();
      expect(n.name).toBe(r.name);
      expect(n.description).toBe(r.description);
      expect(n.currency).toBe(r.currency);
      expect(n.maxLevel).toBe(r.maxLevel);
      expect(Array.from({ length: n.maxLevel }, (_, i) => costAt(n, i))).toEqual(r.costs);
      const feature = { milestones_unlocked: 'milestones', crypto_mine_unlocked: 'cryptomine', lab_unlocked: 'lab' } as Record<string, string>;
      const realEffects = r.effects.filter((e: { stat: string }) => !feature[e.stat]).map((e: { stat: string; op: string; perLevel: unknown }) => ({ stat: e.stat, op: e.op, perLevel: e.perLevel }));
      expect(n.effects).toEqual(realEffects);
      expect(n.unlocksFeature).toBe(r.effects.map((e: { stat: string }) => feature[e.stat]).find(Boolean) ?? null);
      expect(n.requiresMode).toBe(r.requires?.mode ?? 'all');
      expect(n.requires).toEqual(r.requires?.nodes ?? []);
      expect(n.pos).toEqual(r.position.rect.slice(0, 2));
      expect(n.size).toEqual(r.position.rect.slice(2, 4));
      expect([...n.links].sort()).toEqual([...r.neighbors].sort());
    });
  }

  it('keeps the displayed text even where the code differs', () => {
    const swarming = content.node.get('SpawnRate2')!;
    expect(swarming.description).toBe('+200% spawn rate');
    expect(swarming.effects).toEqual([{ stat: 'spawn_rate_mod', op: 'add', perLevel: 2.5 }]);
    const big = content.node.get('Size3')!;
    expect(big.description).toBe('+100% attack size');
    expect(big.effects).toEqual([{ stat: 'player_size', op: 'add', perLevel: 1 }]);
    expect(content.node.get('PulseBolts')!.effects).toEqual([{ stat: 'pulse_bolt_count', op: 'add', perLevel: 3 }]);
    expect(content.node.get('Infinity5')!.effects).toEqual([]);
    expect(content.node.get('Health4')!.cost).toEqual({ type: 'table', table: [0.01, 0.01, 0.01, 0.01, 0.01, 0.012, 0.01, 0.01, 0.01, 0.01] });
  });

  it('costs the same in total as the original (per currency)', () => {
    const total: Record<string, number> = {};
    for (const n of content.upgrades.nodes) for (let i = 0; i < n.maxLevel; i++) total[n.currency] = (total[n.currency] ?? 0) + costAt(n, i);
    expect(total.bits).toBe(2_308_576);
    expect(total.sp).toBe(26);
    expect(total.cores).toBe(19);
    expect(total.nodes).toBe(47_459);
    expect(total.netcoin).toBeCloseTo(27.022, 9);
  });

  it('unlocks the Milestones, Crypto Mine and Lab tabs from the right nodes', () => {
    expect(content.node.get('Milestones')!.unlocksFeature).toBe('milestones');
    expect(content.node.get('CryptoMine')!.unlocksFeature).toBe('cryptomine');
    expect(content.node.get('Laboratory')!.unlocksFeature).toBe('lab');
    expect(content.node.get('Laboratory')!.requires).toEqual([{ id: 'Infinity9', level: 1 }]);
  });
});

describe('player base stats', () => {
  it('match Stats.gd', () => {
    for (const [k, s] of Object.entries(R.stats.stats as Record<string, { value: unknown }>)) {
      if (k.endsWith('_unlocked')) continue;
      expect(content.economy.stats[k], k).toBe(s.value);
    }
    expect(content.economy.stats.attacks_per_sec).toBe(0.5);
    expect(content.economy.stats.player_size).toBe(34);
    expect(content.economy.stats.spawn_rate).toBe(0.33);
    expect(content.economy.stats.spawn_rate_mod).toBe(1);
    expect(content.economy.stats.max_health).toBe(10);
  });
});

describe('prestige', () => {
  it('has levels 0-25', () => {
    expect(content.prestige.max).toBe(25);
    expect(content.prestige.levels.map((l) => l.prestige)).toEqual(Array.from({ length: 26 }, (_, i) => i));
  });
  const map: Record<string, string> = {
    enemyBaseHealth: 'enemy_base_health',
    enemyHealthGrowthPerSec: 'enemy_health_growth_per_sec',
    enemyBaseDamage: 'enemy_base_damage',
    enemyDamageGrowthPerSec: 'enemy_damage_growth_per_sec',
    bossHealth: 'boss_health',
    bossDamage: 'boss_damage',
    enemyXp: 'enemy_xp',
    bitBoost: 'bit_boost',
    nodeBoost: 'node_boost',
    bitValue: 'bit_value',
    healthLossPerSec: 'health_loss_per_sec',
    enemySpeedMod: 'enemy_speed_mod',
  };
  for (const r of R.prestige.levels) {
    it(`prestige ${r.prestige} matches BattleScene.setup_prestige`, () => {
      const l = content.prestige.levels[r.prestige];
      for (const [ours, theirs] of Object.entries(map)) expect((l as Record<string, unknown>)[ours], ours).toBe(val(r[theirs]));
      expect(l.spawnWeights).toEqual(r.spawn_weights);
    });
  }
  it('uses the first "== 19" branch only (the second is dead code)', () => {
    expect(content.prestige.levels[19].enemyXp).toBe(54);
    expect(content.prestige.levels[19].bitValue).toBe(40);
    expect(content.prestige.levels[20].enemyXp).toBe(62);
  });
  it('drains a fixed amount per second per prestige', () => {
    expect(content.prestige.levels.map((l) => l.healthLossPerSec)).toEqual([0.2, 0.6, 1.2, 3.6, 10, 30, 90, 270, 810, 2400, 7200, 21600, ...Array(14).fill(60000)]);
  });
});

describe('enemies and bosses', () => {
  for (const r of R.enemies.types) {
    it(`${r.id} matches EnemySpawner.spawn_enemy`, () => {
      const e = content.enemyType.get(r.id)!;
      expect(e.scale).toEqual(r.scale);
      expect(e.speed).toEqual(r.move_speed_px_per_sec);
      expect(e.spin).toEqual(Array.isArray(r.rotate_speed_turns_per_sec) ? r.rotate_speed_turns_per_sec : [0, 0]);
      expect([e.healthMult, e.dropMult, e.xpMult, e.damageMult]).toEqual([r.health_mult, r.drop_mult, r.xp_mult, r.damage_mult]);
      expect(e.faceVelocity).toBe(r.rotate_to_velocity);
      expect(Boolean(e.wavy)).toBe(r.wavy);
      const h = r.hitbox_unscaled;
      if (h.shape === 'rect') expect(e.hitbox.size).toEqual(h.size);
      else expect(e.hitbox.radius).toBe(h.radius);
    });
  }
  it('boss spawns after 45 s at max prestige only and gives one Core', () => {
    const b = content.bosses.bosses[0];
    expect(b.spawnAfterSec).toBe(45);
    expect(b.onlyAtMaxPrestige).toBe(true);
    expect(b.reward).toEqual({ currency: 'cores', amount: 1, unlockNextPrestige: true });
    expect([b.speed, b.spinTurnsPerSec, b.scale, b.rainbowFromPrestige]).toEqual([15, 0.1, 1, 18]);
  });
  it('spawner starts with 2 queued enemies and yellow skips big squares and pentagons', () => {
    expect(content.spawn.initialAccumulator).toBe(2);
    expect(content.spawn.currencyRules[0]).toEqual({ currency: 'processors', chanceStat: 'yellow_enemy_chance', excludeTypes: ['BigSquare', 'Pentagon'] });
  });
});

describe('xp, milestones, crypto mine, lab', () => {
  it('xp table matches XPBar.gd', () => {
    expect(content.economy.xp.table).toEqual(R.xp.table.map((r: { xp_to_next: number }) => r.xp_to_next));
    expect(content.economy.xp.after).toEqual({ fromLevel: 24, base: 83000, perLevel: 5000 });
  });
  it('milestones match MilestoneStore.gd and UpgradeProcessor.gd', () => {
    expect(content.milestones.milestones).toHaveLength(25);
    content.milestones.milestones.forEach((m, i) => {
      const r = R.milestones.milestones[i];
      expect([m.id, m.name, m.text, m.counter, m.count]).toEqual([r.id, r.name, r.unlock_text, r.requirement.counter, r.requirement.count]);
      expect(m.reward).toEqual({ currency: r.reward.currency, amount: r.reward.amount });
      expect(`${m.rewardText} `).toBe(r.reward_text.replace(/\w+$/, ''));
    });
    const rival = content.milestones.milestones.find((m) => m.id === 'Blues1.6k')!;
    expect(rival.text).toBe('destroy 1,500 blue enemies');
    expect(rival.count).toBe(1600);
  });
  it('crypto mine matches CryptoMine.gd', () => {
    expect(content.cryptomine.netcoinPerBit).toBe(0.00001);
    expect(content.cryptomine.bitsPerSecByLevel).toEqual(R.mine.speed_by_level.map((s: { bits_per_sec: number }) => s.bits_per_sec));
    expect(content.cryptomine.maxLevel).toBe(36);
    expect(content.cryptomine.deposits.map((d) => d.amount)).toEqual([1000, 5000, 10000, 50000, 100000, 1000000]);
  });
  it('lab needs 1000 Netcoin', () => {
    expect(content.lab.goalNetcoin).toBe(1000);
  });
  it('lists the 13 achievements with their Steam names', () => {
    expect(content.achievements.achievements.map((a) => a.name)).toEqual([
      'Awakened', 'Routine', 'Milestones', 'Crypto Mine', 'The Lab', 'Bit Guy', 'Bit Getter', 'Bit Collector', 'Bit Lord', 'Node Hunter', 'Node Buster', 'SP Seeker', 'Genesis',
    ]);
  });
});

describe('strings and settings', () => {
  it('keeps the original texts', () => {
    expect(content.strings['end.status401']).toBe('status code 401: health reached zero');
    expect(content.strings['end.status500']).toBe('status code 500: terminated by user');
    expect(content.strings['transition.session']).toBe('INITIALIZING SESSION...');
    expect(content.strings['tooltip.netcoin']).toBe('{0} is a resource obtained by converting \t\t\t\t\tBits in the Crypto Mine.');
  });
  it('has the original options with their defaults', () => {
    expect(content.settings.options.map((o) => [o.id, o.default])).toEqual([
      ['window_size', 0], ['vsync', 0], ['screenshake', 90], ['crt_effect', 0], ['transition_color', 0], ['flashing_fx', 0], ['color_palette', 0], ['master_volume', 50], ['bgm_volume', 60], ['sfx_volume', 100],
    ]);
  });
});

describe('numbers', () => {
  it('stay far below 2^53, so plain JS numbers are exact enough', () => {
    const values: number[] = [];
    const walk = (x: unknown) => {
      if (typeof x === 'number') values.push(x);
      else if (x && typeof x === 'object') Object.values(x).forEach(walk);
    };
    walk({ ...content, node: null, enemyType: null });
    expect(Math.max(...values)).toBeLessThan(2 ** 40);
    expect(Math.max(...values)).toBe(145_000_000);
  });
});

describe('validation', () => {
  const raw = () => JSON.parse(JSON.stringify({ ...content, node: undefined, enemyType: undefined }));
  it('rejects an effect on an unknown stat', () => {
    const r = raw();
    r.upgrades.nodes[0].effects.push({ stat: 'dmage', op: 'add', perLevel: 1 });
    expect(() => buildContent(r)).toThrow(/unknown stat dmage/);
  });
  it('rejects a prerequisite that is not a neighbour', () => {
    const r = raw();
    r.upgrades.nodes.find((n: { id: string }) => n.id === 'Health1').requires = [{ id: 'Laboratory', level: 1 }];
    expect(() => buildContent(r)).toThrow(/not linked/);
  });
  it('accepts a new node added by data only', () => {
    const r = raw();
    r.upgrades.nodes.push({
      id: 'Damage6', name: 'test blade', description: '+1000 damage', icon: 'upgrade/Damage5', currency: 'bits',
      cost: { type: 'exponential', base: 10, growth: 1.5, levels: 3 }, maxLevel: 3,
      effects: [{ stat: 'damage', op: 'add', perLevel: 1000 }], unlocksFeature: null,
      requiresMode: 'all', requires: [{ id: 'Damage5', level: 'max' }], pos: [500, 0], size: [16, 16], links: ['Damage5'],
    });
    const c = buildContent(r);
    expect(c.node.get('Damage5')!.links).toContain('Damage6');
    expect([0, 1, 2].map((i) => costAt(c.node.get('Damage6')!, i))).toEqual([10, 15, 23]);
  });
});
