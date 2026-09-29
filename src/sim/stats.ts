// Player stats = base values (content/economy.json) + every owned upgrade level's
// effects, applied level by level like UpgradeProcessor.gain_upgrade.
import { content, type Effect } from '../data/content';
import type { Profile } from './profile';

export type Stats = Record<string, number>;
export type Feature = 'milestones' | 'cryptomine' | 'lab';

export function applyEffect(stats: Stats, e: Effect): void {
  const cur = stats[e.stat] ?? 0;
  const val = typeof e.perLevel === 'boolean' ? (e.perLevel ? 1 : 0) : e.perLevel;
  if (e.op === 'add') stats[e.stat] = cur + val;
  else if (e.op === 'mul') stats[e.stat] = cur * val;
  else stats[e.stat] = val;
}

export function computeStats(levels: Record<string, number>): Stats {
  const stats: Stats = {};
  for (const [k, v] of Object.entries(content.economy.stats)) stats[k] = typeof v === 'boolean' ? (v ? 1 : 0) : v;
  for (const n of content.upgrades.nodes) {
    const lvl = levels[n.id] ?? 0;
    for (let i = 0; i < lvl; i++) for (const e of n.effects) applyEffect(stats, e);
  }
  return stats;
}

export function features(levels: Record<string, number>): Set<Feature> {
  const f = new Set<Feature>();
  for (const n of content.upgrades.nodes) if (n.unlocksFeature && (levels[n.id] ?? 0) > 0) f.add(n.unlocksFeature);
  return f;
}

/** Stats.get_max_health(): upgrades plus the permanent parasite bonus. */
export function maxHealth(stats: Stats, p: Profile): number {
  return stats.max_health + p.bonus_max_health;
}

/** Reticle side in px: player_size * (1 + player_size_mod). */
export function reticleSize(stats: Stats): number {
  return stats.player_size * (1 + stats.player_size_mod);
}

/** XPBar.xp_until_level_up for a level. */
export function xpToNext(level: number): number {
  const x = content.economy.xp;
  if (level < x.table.length) return x.table[level];
  return x.after.base + x.after.perLevel * (level - x.after.fromLevel);
}
