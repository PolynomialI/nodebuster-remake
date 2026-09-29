import { describe, expect, it } from 'vitest';
import { content } from '../../src/data/content';
import { newProfile } from '../../src/sim/profile';
import { claimMilestone, deposit, labDeposit, labReady, milestoneClaimable, mineSecondsLeft, processMine, upgradeMine } from '../../src/sim/meta';
import { numStr } from '../../src/ui/format';

const ms = (id: string) => content.milestones.milestones.find((m) => m.id === id)!;

describe('Crypto Mine', () => {
  it('converts deposited Bits at 5/s into Netcoin at 0.00001 each', () => {
    const p = newProfile();
    p.bits = 1000;
    expect(deposit(p, 1000)).toBe(true);
    expect(p.bits).toBe(0);
    for (let i = 0; i < 60 * 10; i++) processMine(p, 1 / 60);
    expect(p.crypto_mine.curr_bits).toBeCloseTo(950, 6);
    expect(p.netcoin).toBeCloseTo(0.0005, 10);
    expect(p.netcoin_unlocked).toBe(true);
    expect(mineSecondsLeft(p)).toBeCloseTo(190, 6);
  });

  it('upgrades cost one Processor and follow the speed table up to level 36', () => {
    const p = newProfile();
    p.processors = 40;
    let n = 0;
    while (upgradeMine(p)) n++;
    expect(n).toBe(36);
    expect(p.processors).toBe(4);
    p.crypto_mine.curr_bits = 1_280_000;
    processMine(p, 1);
    expect(p.crypto_mine.curr_bits).toBe(0);
  });

  it('refuses deposits you cannot afford', () => {
    const p = newProfile();
    p.bits = 999;
    expect(deposit(p, 1000)).toBe(false);
    expect(p.bits).toBe(999);
  });
});

describe('Milestones', () => {
  it('claims once when the lifetime counter reaches the goal', () => {
    const p = newProfile();
    p.nums.reds_killed = 499;
    expect(milestoneClaimable(p, ms('Reds500'))).toBe(false);
    p.nums.reds_killed = 500;
    expect(claimMilestone(p, ms('Reds500'))).toBe(true);
    expect(p.bits).toBe(500);
    expect(p.total_bits).toBe(500);
    expect(claimMilestone(p, ms('Reds500'))).toBe(false);
  });

  it('BLUE RIVAL needs 1,600 although its text says 1,500 (as in the original)', () => {
    const p = newProfile();
    p.nums.blues_killed = 1500;
    expect(milestoneClaimable(p, ms('Blues1.6k'))).toBe(false);
    p.nums.blues_killed = 1600;
    expect(milestoneClaimable(p, ms('Blues1.6k'))).toBe(true);
  });
});

describe('Lab', () => {
  it('takes all Netcoin and discards anything over 1000', () => {
    const p = newProfile();
    p.netcoin = 700;
    labDeposit(p);
    expect([p.lab_research_progress, p.netcoin]).toEqual([700, 0]);
    p.netcoin = 450;
    labDeposit(p);
    expect([p.lab_research_progress, p.netcoin]).toEqual([1000, 0]);
    expect(labReady(p)).toBe(true);
  });
});

describe('number formatting (Utils.num_str)', () => {
  it('matches the original, including its floating-point quirk at 1000', () => {
    expect(numStr(5234)).toBe('5,234');
    expect(numStr(1234567)).toBe('1,234,567');
    expect(numStr(3.52817, true)).toBe('3.52817');
    expect(numStr(1000, true)).toBe('1000.000');
    expect(numStr(420.5, true)).toBe('420.500');
    expect(numStr(0.23422, true)).toBe('0.23422');
    expect(numStr(12.3, true)).toBe('12.3000');
  });
});
