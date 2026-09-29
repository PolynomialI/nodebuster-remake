// Meta systems: Crypto Mine (CryptoMine.gd), Milestones (MilestoneStore.gd,
// UpgradeProcessor.gain/check_milestone) and the Lab (LabPage.gd).
import { content } from '../data/content';
import { gain, has, lose, setCurrency, type Profile } from './profile';

// ---- Crypto Mine -----------------------------------------------------------------

export function mineSpeed(p: Profile): number {
  const s = content.cryptomine.bitsPerSecByLevel;
  return s[Math.min(p.crypto_mine.mine_level, s.length - 1)];
}

export const mineMaxed = (p: Profile): boolean => p.crypto_mine.mine_level >= content.cryptomine.maxLevel;

/** CryptoMine.process: runs every frame while the game is open, in every scene. */
export function processMine(p: Profile, dt: number): void {
  const bits = Math.min(mineSpeed(p) * dt, p.crypto_mine.curr_bits);
  if (bits <= 0) return;
  p.crypto_mine.curr_bits -= bits;
  setCurrency(p, 'netcoin', p.netcoin + content.cryptomine.netcoinPerBit * bits);
}

export function deposit(p: Profile, amount: number): boolean {
  if (!has(p, 'bits', amount)) return false;
  lose(p, 'bits', amount);
  p.crypto_mine.curr_bits += amount;
  return true;
}

export function upgradeMine(p: Profile): boolean {
  const c = content.cryptomine.upgradeCost;
  if (mineMaxed(p) || !has(p, c.currency, c.amount)) return false;
  lose(p, c.currency, c.amount);
  p.crypto_mine.mine_level += 1;
  return true;
}

export const mineReturns = (p: Profile): number => p.crypto_mine.curr_bits * content.cryptomine.netcoinPerBit;
export const mineSecondsLeft = (p: Profile): number => p.crypto_mine.curr_bits / mineSpeed(p);

// ---- Milestones -------------------------------------------------------------------

export type MilestoneDef = (typeof content.milestones.milestones)[number];

/** check_milestone: completion fraction (claimable at >= 1). */
export const milestoneProgress = (p: Profile, m: MilestoneDef): number => p.nums[m.counter] / m.count;

export const milestoneClaimable = (p: Profile, m: MilestoneDef): boolean => !p.milestones[m.id] && milestoneProgress(p, m) >= 1;

export function claimMilestone(p: Profile, m: MilestoneDef): boolean {
  if (!milestoneClaimable(p, m)) return false;
  p.milestones[m.id] = true;
  gain(p, m.reward.currency, m.reward.amount);
  return true;
}

// ---- Lab ------------------------------------------------------------------------

/** LabPage._on_deposit_pressed: all Netcoin goes in, progress clamps at the goal (excess is lost). */
export function labDeposit(p: Profile): void {
  const goal = content.lab.goalNetcoin;
  p.lab_research_progress = Math.min(Math.max(p.lab_research_progress + p.netcoin, 0), goal);
  setCurrency(p, 'netcoin', 0);
}

export const labReady = (p: Profile): boolean => p.lab_research_progress >= content.lab.goalNetcoin;
