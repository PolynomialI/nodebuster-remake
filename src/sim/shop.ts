// Skill tree rules: UpgradeProcessor.check_upgrade_unlocked (visibility),
// Upgrade.can_buy / get_cost and UpgradeTree._on_upgrade_clicked (buying).
import { content, costAt, type UpgradeNode } from '../data/content';
import { has, lose, type Profile } from './profile';

export const levelOf = (p: Profile, id: string): number => p.upgrades[id] ?? 0;
export const isMaxed = (p: Profile, n: UpgradeNode): boolean => levelOf(p, n.id) >= n.maxLevel;

/** Upgrade.get_cost(): -1 when maxed. */
export function nextCost(p: Profile, n: UpgradeNode): number {
  const l = levelOf(p, n.id);
  return l >= n.maxLevel ? -1 : costAt(n, l);
}

export function canBuy(p: Profile, n: UpgradeNode): boolean {
  return !isMaxed(p, n) && has(p, n.currency, nextCost(p, n));
}

/** A node is shown (and only then clickable) when its requirement over linked nodes holds. */
export function isUnlocked(p: Profile, n: UpgradeNode): boolean {
  if (n.requires.length === 0) return true;
  const ok = (r: UpgradeNode['requires'][number]) => {
    const other = content.node.get(r.id)!;
    const lvl = levelOf(p, r.id);
    return r.level === 'max' ? lvl >= other.maxLevel : lvl >= r.level;
  };
  return n.requiresMode === 'any' ? n.requires.some(ok) : n.requires.every(ok);
}

/** Buys one level if possible; returns whether it happened. */
export function buy(p: Profile, n: UpgradeNode): boolean {
  if (!canBuy(p, n)) return false;
  lose(p, n.currency, nextCost(p, n));
  p.upgrades[n.id] = levelOf(p, n.id) + 1;
  return true;
}
