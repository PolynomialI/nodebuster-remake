// Loads and validates content/*.json. All game values and text come from here,
// so new nodes, enemies and bosses need data changes only. Validation runs at
// startup and in the unit tests; a bad file fails with the path of the value.
import achievementsJson from '../../content/achievements.json';
import attacksJson from '../../content/attacks.json';
import audioJson from '../../content/audio.json';
import bossesJson from '../../content/bosses.json';
import cryptomineJson from '../../content/cryptomine.json';
import economyJson from '../../content/economy.json';
import effectsJson from '../../content/effects.json';
import enemiesJson from '../../content/enemies.json';
import labJson from '../../content/lab.json';
import milestonesJson from '../../content/milestones.json';
import paletteJson from '../../content/palette.json';
import postJson from '../../content/post.json';
import prestigeJson from '../../content/prestige.json';
import settingsJson from '../../content/settings.json';
import spawnJson from '../../content/spawn.json';
import stringsJson from '../../content/strings.en.json';
import upgradesJson from '../../content/upgrades.json';
import { any, arr, bool, int, nullable, num, obj, oneOf, optional, record, SchemaError, str, vec2, type Check } from './schema';

export const CURRENCIES = ['bits', 'nodes', 'cores', 'sp', 'netcoin', 'processors'] as const;
export type Currency = (typeof CURRENCIES)[number];
const currency = oneOf<Currency>(...CURRENCIES);
const range = vec2;

// ---- upgrades ------------------------------------------------------------------
const costCheck = (v: unknown, p: string) => {
  const t = obj({ type: oneOf('table', 'exponential') })(v, p);
  return t.type === 'table'
    ? obj({ type: oneOf('table'), table: arr(num, { min: 1 }) })(v, p)
    : obj({ type: oneOf('exponential'), base: num, growth: num, levels: int, round: optional(bool) })(v, p);
};
const effect = obj({ stat: str, op: oneOf('add', 'set', 'mul'), perLevel: (v, p) => (typeof v === 'boolean' ? v : num(v, p)) });
const requirement = obj({ id: str, level: (v, p) => (v === 'max' ? ('max' as const) : int(v, p)) });
const upgradeNode = obj({
  id: str,
  name: str,
  description: str,
  icon: str,
  currency,
  cost: costCheck,
  maxLevel: int,
  effects: arr(effect),
  unlocksFeature: nullable(oneOf('milestones', 'cryptomine', 'lab')),
  requiresMode: oneOf('all', 'any'),
  requires: arr(requirement),
  pos: vec2,
  size: vec2,
  links: arr(str),
  codeNote: optional(str),
});
export type UpgradeNode = ReturnType<typeof upgradeNode>;
export type Effect = ReturnType<typeof effect>;

// ---- enemies / bosses / spawn ---------------------------------------------------
const hitbox = obj({ shape: oneOf('rect', 'circle'), size: optional(vec2), radius: optional(num), offset: vec2 });
const fillMode = oneOf('left_to_right', 'bottom_to_top', 'clockwise_and_counter_clockwise');
const onDeath = obj({
  split: optional(obj({ type: str, count: int, radius: num })),
  explode: optional(obj({ size: num, sizeStat: str })),
});
const enemyType = obj({
  id: str,
  sprite: str,
  mask: str,
  maskOffset: vec2,
  fillMode,
  hitbox,
  scale: range,
  speed: range,
  spin: range,
  randomSpinDirection: bool,
  healthMult: num,
  dropMult: num,
  xpMult: num,
  damageMult: num,
  wavy: nullable(obj({ amplitude: num, period: num })),
  faceVelocity: bool,
  onDeath: arr(onDeath),
  firstPrestige: optional(int),
});
export type EnemyType = ReturnType<typeof enemyType>;
const boss = obj({
  id: str,
  sprite: str,
  mask: str,
  maskOffset: vec2,
  fillMode,
  hitbox,
  scale: num,
  speed: num,
  speedIgnoresPrestige: bool,
  spinTurnsPerSec: num,
  randomSpinDirection: bool,
  currency,
  spawnAfterSec: num,
  onlyAtMaxPrestige: bool,
  onOutOfBounds: oneOf('reenter', 'despawn'),
  rainbowFromPrestige: int,
  rainbowHueTurnsPerSec: num,
  reward: obj({ currency, amount: int, unlockNextPrestige: bool }),
});
export type BossDef = ReturnType<typeof boss>;
const prestigeLevel = obj({
  prestige: int,
  enemyBaseHealth: num,
  enemyHealthGrowthPerSec: num,
  enemyBaseDamage: num,
  enemyDamageGrowthPerSec: num,
  bossHealth: num,
  bossDamage: num,
  enemyXp: num,
  bitBoost: int,
  nodeBoost: int,
  bitValue: num,
  healthLossPerSec: num,
  enemySpeedMod: num,
  spawnWeights: record(num),
});
export type PrestigeLevel = ReturnType<typeof prestigeLevel>;

// ---- whole files -----------------------------------------------------------------
const files = {
  upgrades: obj({ nodes: arr(upgradeNode, { min: 1 }) }),
  economy: obj({
    stats: record((v, p) => (typeof v === 'boolean' ? v : num(v, p))),
    health: obj({ barBaseWidth: num, barMaxWidth: num, barBaseHealth: num, barHealthPerWidth: num }),
    xp: obj({ table: arr(num, { min: 1 }), after: obj({ fromLevel: int, base: num, perLevel: num }), spPerLevel: int }),
    drops: obj({ scatterFactor: num, dropRadius: num, moveAwayDistance: num, moveAwaySec: num, flyRate: num, flyEase: num }),
    reticle: obj({ color: str, dotScale: num, maxTargets: int, focusArmorMaxTargets: int }),
  }),
  enemies: obj({ despawn: obj({ minAgeSec: num, marginFactor: num }), hitFlashSec: num, types: arr(enemyType, { min: 1 }) }),
  bosses: obj({ bosses: arr(boss, { min: 1 }) }),
  prestige: obj({ max: int, levels: arr(prestigeLevel, { min: 1 }) }),
  spawn: obj({
    initialAccumulator: num,
    currencyRules: arr(obj({ currency, chanceStat: str, excludeTypes: arr(str) })),
    defaultCurrency: currency,
    exploder: obj({ type: str, chanceStat: str, takeWeightFrom: str }),
    placement: obj({ offsetFactor: num, aimRadius: num }),
  }),
  attacks: obj({
    explosion: obj({ flickerDelaySec: num, flickerStepSec: num, flickerSteps: int }),
    pulseBolt: obj({ firstAngleDeg: num, speed: num, lifetime: range, radius: num, spriteSize: vec2, explodeSize: num, impactSize: num }),
    drone: obj({ speed: num, turnRadPerSec: num, intervalSec: num, size: num, angleDeg: num, spawnMargin: num, flashSec: num }),
    lightning: obj({ range: num, hopSec: num, width: num, fadeSec: num, jitter: num, segment: num, impactSize: num }),
  }),
  effects: obj({
    cornerBoxPulse: obj({ flashSec: num, springScalePx: num, springStiffness: num, rotateDeg: num }),
    squareImpact: obj({ startScale: num, shrinkSec: num, flashSec: num, holdSec: num, grow: num }),
    enemyHitSpring: obj({ forcePx: num, min: num, max: num }),
    screenShake: obj({ magnitude: num, durationSec: num, frequency: num }),
    floatingText: obj({ rise: num, riseSec: num, revealSec: num, durationSec: num, blinkDecrement: num }),
    particles: record(any),
    springs: obj({ scale: obj({ stiffness: num, damping: num }), rotate: obj({ stiffness: num, damping: num }), property: obj({ stiffness: num, damping: num }), maxDt: num }),
    transition: obj({ frames: int, fps: num, frameSize: vec2, textDelaySec: num, textRevealSec: num, textBlinkSec: num, textBlinks: int, holdSec: num, darkColor: str }),
    levelUpText: str,
  }),
  milestones: obj({
    milestones: arr(obj({ id: str, name: str, text: str, rewardText: str, icon: str, counter: oneOf('reds_killed', 'blues_killed', 'yellows_killed', 'enemies_killed'), count: num, reward: obj({ currency, amount: num }) })),
  }),
  cryptomine: obj({
    netcoinPerBit: num,
    deposits: arr(obj({ amount: int, label: str }), { min: 1 }),
    upgradeCost: obj({ currency, amount: int }),
    bitsPerSecByLevel: arr(num, { min: 1 }),
    maxLevel: int,
    runsInEveryScene: bool,
  }),
  lab: obj({ goalNetcoin: num, depositTweenSec: num, godvirus: obj({ sprite: str, frames: int, frameSize: vec2, fps: num }), ending: record(any) }),
  achievements: obj({
    achievements: arr(
      obj({
        id: str,
        name: str,
        description: str,
        when: obj({ event: oneOf('sessionStart', 'sessionEnd', 'feature', 'levelUp', 'godvirus'), stat: optional(str), atLeast: optional(num), feature: optional(str) }),
      }),
    ),
  }),
  settings: obj({
    options: arr(obj({ id: str, label: str, kind: oneOf('choice', 'slider'), choices: optional(any), range: optional(vec2), default: int })),
    spacerAfter: str,
  }),
  post: obj({ crt: record(any), glitch: record(num), glow: obj({ intensity: num, intensityCrtOff: num, strength: num, hdrThreshold: num, hdrLuminanceCap: num, levels: arr(num), normalized: bool }) }),
  palette: obj({ colors: record(str), currency: record(str), outline: record(record(str)), ui: record(str) }),
  audio: obj({
    buses: obj({ sfxDb: num, bgmDb: num, bgmLowpassHz: num }),
    bgmProfiles: record(any),
    sfx: obj({ voices: int, defaultPitchRange: num, cooldownSteps: int }),
    loops: arr(str),
  }),
  strings: record(str),
};

type Files = { [K in keyof typeof files]: ReturnType<(typeof files)[K]> };
export type Content = Files & {
  node: Map<string, UpgradeNode>;
  enemyType: Map<string, EnemyType>;
};

const RAW = {
  upgrades: upgradesJson,
  economy: economyJson,
  enemies: enemiesJson,
  bosses: bossesJson,
  prestige: prestigeJson,
  spawn: spawnJson,
  attacks: attacksJson,
  effects: effectsJson,
  milestones: milestonesJson,
  cryptomine: cryptomineJson,
  lab: labJson,
  achievements: achievementsJson,
  settings: settingsJson,
  post: postJson,
  palette: paletteJson,
  audio: audioJson,
  strings: stringsJson,
};

/** Validate raw JSON objects (by file name) and cross-check references between files. */
export function buildContent(raw: Record<keyof typeof files, unknown>): Content {
  const out = {} as Files;
  for (const key of Object.keys(files) as (keyof typeof files)[]) {
    (out as Record<string, unknown>)[key] = (files[key] as Check<unknown>)(raw[key], `content/${key === 'strings' ? 'strings.en' : key}.json`);
  }
  const bad = (msg: string): never => {
    throw new SchemaError(msg);
  };

  // Upgrades: unique ids, symmetric links (the original adds the reverse link at runtime),
  // prerequisites must be neighbours, effects must name known stats.
  const node = new Map<string, UpgradeNode>();
  for (const n of out.upgrades.nodes) {
    if (node.has(n.id)) bad(`content/upgrades.json: duplicate node id ${n.id}`);
    node.set(n.id, n);
    if (n.cost.type === 'table' && n.cost.table.length !== n.maxLevel) bad(`content/upgrades.json: ${n.id} has ${n.cost.table.length} costs but maxLevel ${n.maxLevel}`);
  }
  for (const n of out.upgrades.nodes) {
    for (const l of n.links) {
      const other = node.get(l) ?? bad(`content/upgrades.json: ${n.id} links to unknown node ${l}`);
      if (!other.links.includes(n.id)) other.links.push(n.id);
    }
  }
  for (const n of out.upgrades.nodes) {
    for (const r of n.requires) {
      if (!node.has(r.id)) bad(`content/upgrades.json: ${n.id} requires unknown node ${r.id}`);
      if (!n.links.includes(r.id)) bad(`content/upgrades.json: ${n.id} requires ${r.id}, which is not linked to it`);
    }
    for (const e of n.effects) if (!(e.stat in out.economy.stats)) bad(`content/upgrades.json: ${n.id} changes unknown stat ${e.stat}`);
  }

  // Enemies, spawn weights and prestige table.
  const enemyType = new Map(out.enemies.types.map((t) => [t.id, t]));
  for (const t of out.enemies.types) {
    for (const d of t.onDeath) if (d.split && !enemyType.has(d.split.type)) bad(`content/enemies.json: ${t.id} splits into unknown type ${d.split.type}`);
    if ((t.hitbox.shape === 'rect') !== Boolean(t.hitbox.size)) bad(`content/enemies.json: ${t.id} hitbox needs size (rect) or radius (circle)`);
  }
  out.prestige.levels.forEach((l, i) => {
    if (l.prestige !== i) bad(`content/prestige.json: levels[${i}] has prestige ${l.prestige}`);
    for (const k of Object.keys(l.spawnWeights)) if (!enemyType.has(k)) bad(`content/prestige.json: prestige ${i} weights unknown type ${k}`);
  });
  if (out.prestige.levels.length !== out.prestige.max + 1) bad(`content/prestige.json: max is ${out.prestige.max} but there are ${out.prestige.levels.length} levels`);
  for (const r of out.spawn.currencyRules) if (!(r.chanceStat in out.economy.stats)) bad(`content/spawn.json: unknown stat ${r.chanceStat}`);
  if (!enemyType.has(out.spawn.exploder.type)) bad(`content/spawn.json: unknown exploder type`);
  if (out.cryptomine.bitsPerSecByLevel.length !== out.cryptomine.maxLevel + 1) bad('content/cryptomine.json: bitsPerSecByLevel must have maxLevel + 1 entries');

  return { ...out, node, enemyType };
}

export const content: Content = buildContent(RAW);

/** Text by key, with {0}, {1}… filled in. */
export function t(key: string, ...args: (string | number)[]): string {
  const s = content.strings[key];
  if (s === undefined) throw new Error(`Missing string ${key}`);
  return s.replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)] ?? ''));
}

/** Palette colour by name (e.g. "RED") or hex, as a 0xRRGGBB number. */
export function color(nameOrHex: string): number {
  const hex = nameOrHex.startsWith('#') ? nameOrHex : content.palette.colors[nameOrHex] ?? content.palette.ui[nameOrHex];
  if (!hex) throw new Error(`Unknown colour ${nameOrHex}`);
  return parseInt(hex.slice(1), 16);
}

/** Cost of the next level of a node (level = current level). */
export function costAt(n: UpgradeNode, level: number): number {
  if (n.cost.type === 'table') return n.cost.table[level];
  const c = n.cost.base * Math.pow(n.cost.growth, level);
  return n.cost.round === false ? c : Math.round(c);
}
