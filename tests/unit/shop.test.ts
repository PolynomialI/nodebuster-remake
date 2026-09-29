import { describe, expect, it } from 'vitest';
import { content } from '../../src/data/content';
import { newProfile } from '../../src/sim/profile';
import { buy, canBuy, isUnlocked, nextCost } from '../../src/sim/shop';
import { computeStats, features } from '../../src/sim/stats';

const node = (id: string) => content.node.get(id)!;

describe('skill tree rules', () => {
  it('a fresh save shows only the root node', () => {
    const p = newProfile();
    const shown = content.upgrades.nodes.filter((n) => isUnlocked(p, n)).map((n) => n.id);
    expect(shown).toEqual(['Damage1']);
  });

  it('one level of power reveals its three neighbours', () => {
    const p = newProfile();
    p.bits = 1;
    expect(buy(p, node('Damage1'))).toBe(true);
    expect(p.bits).toBe(0);
    const shown = content.upgrades.nodes.filter((n) => isUnlocked(p, n)).map((n) => n.id).sort();
    expect(shown).toEqual(['Damage1', 'DamagePerEnemy1', 'Health1', 'SpawnRate1']);
  });

  it('costs follow the table level by level and stop at max', () => {
    const p = newProfile();
    p.bits = 10_000;
    const n = node('Damage1');
    const paid: number[] = [];
    while (canBuy(p, n)) {
      paid.push(nextCost(p, n));
      buy(p, n);
    }
    expect(paid).toEqual([1, 2, 3, 3, 4, 5, 7, 9, 11, 13, 15, 20, 25, 30, 35]);
    expect(nextCost(p, n)).toBe(-1);
    expect(p.upgrades.Damage1).toBe(15);
    expect(computeStats(p.upgrades).damage).toBe(16);
  });

  it('"max" requirements need the neighbour maxed (antivirus needs firewall 10/10)', () => {
    const p = newProfile();
    p.upgrades = { Damage1: 1, Health1: 1, Armor1: 9 };
    expect(isUnlocked(p, node('Armor2'))).toBe(false);
    p.upgrades.Armor1 = 10;
    expect(isUnlocked(p, node('Armor2'))).toBe(true);
  });

  it('"any" requirements: better endurance opens from boss guard or salvaging', () => {
    const p = newProfile();
    p.upgrades = { BossArmor1: 1 };
    expect(isUnlocked(p, node('Health2'))).toBe(true);
    p.upgrades = { Salvaging1: 1 };
    expect(isUnlocked(p, node('Health2'))).toBe(true);
    p.upgrades = {};
    expect(isUnlocked(p, node('Health2'))).toBe(false);
  });

  it('netcoin costs compare as floats and totals do not count spending', () => {
    const p = newProfile();
    p.netcoin = 0.03;
    const drainer = node('Lifesteal2');
    expect(canBuy(p, drainer)).toBe(true);
    buy(p, drainer);
    buy(p, drainer);
    expect(p.netcoin).toBeCloseTo(0.01, 12);
    p.bits = 100;
    p.total_bits = 100;
    buy(p, node('Damage1'));
    expect(p.total_bits).toBe(100);
  });

  it('feature nodes unlock their tabs', () => {
    expect([...features({ Milestones: 1, CryptoMine: 1 })].sort()).toEqual(['cryptomine', 'milestones']);
  });
});
