// Persistent player state (the original's State.gd + UpgradeStore/MilestoneStore
// levels), with the same setter rules: gains add to lifetime totals, values never
// go below zero, and a currency panel unlocks the first time it is above zero.
import { content, type Currency } from '../data/content';

export interface Profile {
  version: 1;
  bits: number;
  nodes: number;
  cores: number;
  sp: number;
  netcoin: number;
  processors: number;
  nodes_unlocked: boolean;
  cores_unlocked: boolean;
  sp_unlocked: boolean;
  netcoin_unlocked: boolean;
  processors_unlocked: boolean;
  level: number;
  curr_xp: number;
  bonus_max_health: number;
  nums: { enemies_killed: number; reds_killed: number; blues_killed: number; yellows_killed: number };
  crypto_mine: { mine_level: number; curr_bits: number };
  lab_research_progress: number;
  virus_deployed: boolean;
  curr_prestige: number;
  max_prestige: number;
  sessions: number;
  total_bits: number;
  total_nodes: number;
  upgrades: Record<string, number>;
  milestones: Record<string, boolean>;
  /** Not in the original's save (Steam kept these). */
  achievements: Record<string, boolean>;
}

export function newProfile(): Profile {
  return {
    version: 1,
    bits: 0,
    nodes: 0,
    cores: 0,
    sp: 0,
    netcoin: 0,
    processors: 0,
    nodes_unlocked: false,
    cores_unlocked: false,
    sp_unlocked: false,
    netcoin_unlocked: false,
    processors_unlocked: false,
    level: 0,
    curr_xp: 0,
    bonus_max_health: 0,
    nums: { enemies_killed: 0, reds_killed: 0, blues_killed: 0, yellows_killed: 0 },
    crypto_mine: { mine_level: 0, curr_bits: 0 },
    lab_research_progress: 0,
    virus_deployed: false,
    curr_prestige: 0,
    max_prestige: 0,
    sessions: 0,
    total_bits: 0,
    total_nodes: 0,
    upgrades: {},
    milestones: {},
    achievements: {},
  };
}

/** Assign a currency the way State.gd's setters do. */
export function setCurrency(p: Profile, c: Currency, value: number): void {
  switch (c) {
    case 'bits':
      if (value > p.bits) p.total_bits += value - p.bits;
      p.bits = Math.max(Math.trunc(value), 0);
      break;
    case 'nodes':
      if (value > p.nodes) p.total_nodes += value - p.nodes;
      p.nodes = Math.max(Math.trunc(value), 0);
      if (p.nodes > 0) p.nodes_unlocked = true;
      break;
    case 'cores':
      p.cores = Math.max(Math.trunc(value), 0);
      if (p.cores > 0) p.cores_unlocked = true;
      break;
    case 'sp':
      p.sp = Math.max(Math.trunc(value), 0);
      if (p.sp > 0) p.sp_unlocked = true;
      break;
    case 'netcoin':
      p.netcoin = Math.max(value, 0);
      if (p.netcoin > 0) p.netcoin_unlocked = true;
      break;
    case 'processors':
      p.processors = Math.max(Math.trunc(value), 0);
      if (p.processors > 0) p.processors_unlocked = true;
      break;
  }
}

export const getCurrency = (p: Profile, c: Currency): number => p[c];
export const gain = (p: Profile, c: Currency, amount: number): void => setCurrency(p, c, p[c] + amount);
export const lose = (p: Profile, c: Currency, amount: number): void => setCurrency(p, c, p[c] - amount);
export const has = (p: Profile, c: Currency, amount: number): boolean => p[c] >= amount;

// ---- save / load ----------------------------------------------------------------

export function profileToJson(p: Profile): string {
  return JSON.stringify(p);
}

/** Parse a saved profile, filling anything missing with defaults and dropping unknown upgrades. */
export function profileFromJson(json: string): Profile {
  const raw = JSON.parse(json) as Partial<Profile>;
  if (typeof raw !== 'object' || raw === null || raw.version !== 1) throw new Error('This save is from an unknown version of the game.');
  const p = newProfile();
  for (const k of Object.keys(p) as (keyof Profile)[]) {
    const v = raw[k];
    if (v === undefined) continue;
    if (typeof p[k] === 'object') Object.assign(p[k] as object, v);
    else (p as unknown as Record<string, unknown>)[k] = v;
  }
  // Levels are clamped to the node's max, like UpgradeStore.load_save.
  const levels: Record<string, number> = {};
  for (const [id, lvl] of Object.entries(p.upgrades)) {
    const n = content.node.get(id);
    if (n) levels[id] = Math.max(0, Math.min(Math.trunc(lvl), n.maxLevel));
  }
  p.upgrades = levels;
  return p;
}
