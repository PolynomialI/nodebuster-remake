// One-off generator: research/data/*.json (extracted from the original game) ->
// content/*.json in the PLAN.md §5 schemas. After generation, content/ is the
// editable source of truth; tests/unit/content.test.ts pins it to research/.
// Constants that live in the original's code rather than in research/data are
// written here with a "src" note pointing at the original file and line.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const R = (f) => JSON.parse(readFileSync(join(root, 'research', 'data', f), 'utf8'));
const out = (f, data) => {
  mkdirSync(join(root, 'content'), { recursive: true });
  writeFileSync(join(root, 'content', f), JSON.stringify(data, null, 2) + '\n');
  console.log(`content/${f}`);
};
const v = (x) => (x && typeof x === 'object' && 'value' in x ? x.value : x);

// ---------------------------------------------------------------- upgrades
const up = R('upgrades.json');
const FEATURE = { milestones_unlocked: 'milestones', crypto_mine_unlocked: 'cryptomine', lab_unlocked: 'lab' };
out('upgrades.json', {
  note: 'Skill tree. description is the text the original displays; effects are what its code does (they differ for a few nodes, see codeNote). costs are per level (cost.table[level]). requires is evaluated over links (neighbours); level 1 = at least one level, "max" = maxed.',
  source: 'res://Scripts/Autoloads/Stores/UpgradeStore.gd, res://Scripts/Upgrades/UpgradeProcessor.gd, res://GameScenes/ShopScene.tscn',
  nodes: up.nodes.map((n) => {
    const feature = n.effects.find((e) => FEATURE[e.stat]);
    return {
      id: n.id,
      name: n.name,
      description: n.description,
      icon: `upgrade/${n.id}`,
      currency: n.currency,
      cost: { type: 'table', table: n.costs },
      maxLevel: n.maxLevel,
      effects: n.effects.filter((e) => !FEATURE[e.stat]).map((e) => ({ stat: e.stat, op: e.op, perLevel: e.perLevel })),
      unlocksFeature: feature ? FEATURE[feature.stat] : null,
      requiresMode: n.requires?.mode ?? 'all',
      requires: (n.requires?.nodes ?? []).map((q) => ({ id: q.id, level: q.level })),
      pos: [n.position.rect[0], n.position.rect[1]],
      size: [n.position.rect[2], n.position.rect[3]],
      links: n.neighbors,
      ...(n.notes ? { codeNote: n.notes } : {}),
      src: n.src,
    };
  }),
});

// ---------------------------------------------------------------- economy (player, health, xp, drops)
const ps = R('player-stats.json');
const stats = {};
for (const [k, s] of Object.entries(ps.stats)) if (!(k in FEATURE)) stats[k] = s.value;
const xp = R('xp.json');
out('economy.json', {
  note: 'Base stats (before upgrades) and run rules. Stat names are the original Stats.gd fields; upgrade effects add to these.',
  stats,
  statsSrc: 'res://Scripts/Systems/Stats.gd',
  health: {
    barBaseWidth: 76,
    barMaxWidth: 200,
    barBaseHealth: 10,
    barHealthPerWidth: 8000 / 124,
    src: 'res://Scripts/Battle/BattleScene.gd:35',
  },
  xp: {
    table: xp.table.map((r) => r.xp_to_next),
    after: { fromLevel: 24, base: 83000, perLevel: 5000 },
    spPerLevel: 1,
    src: 'res://Scripts/Battle/XPBar.gd:12-39',
  },
  drops: {
    scatterFactor: 0.5,
    dropRadius: 3,
    moveAwayDistance: 26,
    moveAwaySec: 0.2,
    flyRate: 6,
    flyEase: 1.5,
    src: 'res://Scripts/Battle/EnemyDropsCreator.gd, res://Scripts/Battle/EnemySpawner.gd:256-263',
  },
  reticle: {
    color: 'BLUE',
    dotScale: 0.125,
    maxTargets: 128,
    focusArmorMaxTargets: 8,
    src: 'res://Scripts/Player/PlayerCursor.gd, res://GameScenes/BattleScene.tscn',
  },
  currencies: ['bits', 'nodes', 'cores', 'sp', 'netcoin', 'processors'],
});

// ---------------------------------------------------------------- enemies, bosses, spawning
const en = R('enemies.json');
const VIS = {
  square: { sprite: 'enemy/square', mask: 'enemy/square_mask', maskOffset: [6, 6], fillMode: 'bottom_to_top' },
  circle: { sprite: 'enemy/circle', mask: 'enemy/circle_mask', maskOffset: [6, 6], fillMode: 'bottom_to_top' },
  pentagon: { sprite: 'enemy/pentagon', mask: 'enemy/pentagon_mask', maskOffset: [6, 9], fillMode: 'bottom_to_top' },
  pill: { sprite: 'enemy/pill', mask: 'enemy/pill_mask', maskOffset: [6, 6], fillMode: 'left_to_right' },
  spiky: { sprite: 'enemy/spiky', mask: 'enemy/spiky_mask', maskOffset: [17, 17], fillMode: 'clockwise_and_counter_clockwise' },
};
const shapeOf = (scene) => (scene.includes('Square') ? 'square' : scene.includes('Circle') ? 'circle' : scene.includes('Pentagon') ? 'pentagon' : scene.includes('Pill') ? 'pill' : 'spiky');
const hitbox = (t) => {
  const h = t.hitbox_unscaled;
  const offset = shapeOf(t.scene) === 'pentagon' ? [0, 5] : [0, 0];
  return h.shape === 'rect' ? { shape: 'rect', size: h.size, offset } : { shape: 'circle', radius: h.radius, offset };
};
const ON_DEATH = {
  Pentagon: [{ split: { type: 'PentagonSmall', count: 6, radius: 40 }, src: 'res://Scripts/Battle/EnemySpawner.gd:246-249,265-269' }],
  Exploder: [{ explode: { size: 110, sizeStat: 'exploder_size' }, src: 'res://Scripts/Battle/EnemySpawner.gd:243-245' }],
};
const FIRST_PRESTIGE = { Square: 0, SmallSquare: 1, BigSquare: 1, Pill: 4, Pentagon: 5, Spiky: 9 };
out('enemies.json', {
  note: 'Enemy types. HP = current base HP (prestige, grows with time) * healthMult; damage = current base damage * damageMult. speed is multiplied by the prestige enemySpeedMod. Sprites are 128 px art drawn at "scale".',
  source: 'res://Scripts/Battle/EnemySpawner.gd:73-151, res://Scenes/Enemies/*.tscn, res://Scripts/Enemy/Enemy.gd',
  despawn: { minAgeSec: 5, marginFactor: 0.7, src: 'res://Scripts/Enemy/Enemy.gd:118-123' },
  hitFlashSec: 0.1,
  types: en.types.map((t) => ({
    id: t.id,
    ...VIS[shapeOf(t.scene)],
    hitbox: hitbox(t),
    scale: t.scale,
    speed: t.move_speed_px_per_sec,
    spin: Array.isArray(t.rotate_speed_turns_per_sec) ? t.rotate_speed_turns_per_sec : [0, 0],
    randomSpinDirection: Boolean(t.random_rotation_direction),
    healthMult: t.health_mult,
    dropMult: t.drop_mult,
    xpMult: t.xp_mult,
    damageMult: t.damage_mult,
    wavy: t.wavy ? { amplitude: 34, period: 1 } : null,
    faceVelocity: t.rotate_to_velocity,
    onDeath: ON_DEATH[t.id] ?? [],
    ...(t.id in FIRST_PRESTIGE ? { firstPrestige: FIRST_PRESTIGE[t.id] } : {}),
    src: t.src,
  })),
});

out('bosses.json', {
  note: 'Bosses. HP and damage come from the prestige table (bossHealth, bossDamage).',
  bosses: [
    {
      id: 'Boss',
      ...VIS.square,
      hitbox: { shape: 'rect', size: [128, 128], offset: [0, 0] },
      scale: 1,
      speed: 15,
      speedIgnoresPrestige: true,
      spinTurnsPerSec: 0.1,
      randomSpinDirection: true,
      currency: 'cores',
      spawnAfterSec: 45,
      onlyAtMaxPrestige: true,
      onOutOfBounds: 'reenter',
      rainbowFromPrestige: 18,
      rainbowHueTurnsPerSec: 1,
      reward: { currency: 'cores', amount: 1, unlockNextPrestige: true },
      src: 'res://Scripts/Battle/EnemySpawner.gd:153-162, res://Scripts/Battle/BattleScene.gd:37-39,368-372,407-419, res://GameScenes/BattleScene.tscn:140',
    },
  ],
});

const pr = R('prestige.json');
out('prestige.json', {
  note: 'Per prestige level (0-25). Enemy base HP and damage grow linearly each second of a session. healthLossPerSec is the constant virus drain. bitValue: each Bits drop gives floor(bitValue) plus one more with probability frac(bitValue).',
  source: 'res://Scripts/Battle/BattleScene.gd:55-358',
  max: 25,
  levels: pr.levels.map((l) => ({
    prestige: l.prestige,
    enemyBaseHealth: v(l.enemy_base_health),
    enemyHealthGrowthPerSec: v(l.enemy_health_growth_per_sec),
    enemyBaseDamage: v(l.enemy_base_damage),
    enemyDamageGrowthPerSec: v(l.enemy_damage_growth_per_sec),
    bossHealth: v(l.boss_health),
    bossDamage: v(l.boss_damage),
    enemyXp: v(l.enemy_xp),
    bitBoost: v(l.bit_boost),
    nodeBoost: v(l.node_boost),
    bitValue: v(l.bit_value),
    healthLossPerSec: v(l.health_loss_per_sec),
    enemySpeedMod: v(l.enemy_speed_mod),
    spawnWeights: l.spawn_weights,
  })),
});

out('spawn.json', {
  note: 'Spawner rules. Rate = stats.spawn_rate * stats.spawn_rate_mod enemies/s. Each spawn picks a currency (first rule whose chance fires, else the default), then a type by the prestige weights.',
  initialAccumulator: 2,
  currencyRules: [
    { currency: 'processors', chanceStat: 'yellow_enemy_chance', excludeTypes: ['BigSquare', 'Pentagon'] },
    { currency: 'nodes', chanceStat: 'blue_enemy_chance', excludeTypes: [] },
  ],
  defaultCurrency: 'bits',
  exploder: { type: 'Exploder', chanceStat: 'exploder_spawn_chance', takeWeightFrom: 'Square' },
  placement: { offsetFactor: 0.7, aimRadius: 84 },
  src: 'res://Scripts/Battle/EnemySpawner.gd:44-71,177-205, res://Scripts/Battle/BattleScene.gd:356-358',
});

// ---------------------------------------------------------------- attacks and effects
out('attacks.json', {
  note: 'Secondary attacks and effect sizes (px, seconds).',
  explosion: { flickerDelaySec: 0.15, flickerStepSec: 0.04, flickerSteps: 6, src: 'res://Scripts/Autoloads/Globals.gd:32-56, res://Scripts/Autoloads/Effects.gd:15-22' },
  pulseBolt: {
    firstAngleDeg: -90,
    speed: 300,
    lifetime: [0.4, 0.6],
    radius: 5.09902,
    spriteSize: [14, 6],
    explodeSize: 64,
    impactSize: 16,
    src: 'res://Scripts/Player/PulseBolt.gd, res://Scenes/Player/PulseBolt.tscn, res://Scripts/Autoloads/Globals.gd:59-70',
  },
  drone: {
    speed: 15,
    turnRadPerSec: Math.PI / 2,
    intervalSec: 3,
    size: 76,
    angleDeg: 45,
    spawnMargin: 20,
    flashSec: 0.1,
    src: 'res://Scripts/Battle/MovingPulser.gd, res://Scripts/Battle/BattleScene.gd:48-53',
  },
  lightning: {
    range: 80,
    hopSec: 0.06,
    width: 4,
    fadeSec: 0.25,
    jitter: 6,
    segment: 15,
    impactSize: 16,
    src: 'res://Scripts/Player/Lightning.gd, res://Scripts/Autoloads/Effects.gd:24-29, res://Scripts/Effects/ElectricityEffect.gd',
  },
});

out('effects.json', {
  note: 'Visual effect parameters from the original scenes and scripts.',
  cornerBoxPulse: { flashSec: 0.1, springScalePx: 16, springStiffness: 500, rotateDeg: 8, src: 'res://Scripts/Effects/CornerBox.gd' },
  squareImpact: { startScale: 1.4, shrinkSec: 0.12, flashSec: 0.08, holdSec: 0.05, grow: 6, src: 'res://Scripts/Effects/SquareImpact.gd, res://Scripts/Enemy/Enemy.gd:79-85' },
  enemyHitSpring: { forcePx: 10, min: 0.5, max: 1.5, src: 'res://Scripts/Enemy/Enemy.gd:90-95' },
  screenShake: { magnitude: 3, durationSec: 0.3, frequency: 70, src: 'res://Scripts/MyCamera.gd:8-11' },
  floatingText: { rise: 15, riseSec: 0.3, revealSec: 0.2, durationSec: 0.4, blinkDecrement: 0.8, src: 'res://Scripts/Effects/FloatingText.gd' },
  particles: {
    hit: { texture: 'particle/line', amount: 6, lifetime: 0.4, velocity: [100, 220], velocityCurve: [[0, 1], [0.566667, 0.241758]], scale: [0.1, 0.3], scaleCurve: [[0, 0], [0.173333, 1], [1, 0]], alignToVelocity: true, src: 'res://Scenes/Particles/HitParticles.tscn' },
    levelUp: { texture: 'particle/shard', amount: 12, lifetime: 0.4, velocity: [120, 300], velocityCurve: [[0, 1], [1, 0.230769]], scale: [0.2, 1], scaleCurve: [[0, 0], [0.173333, 1], [1, 0]], alignToVelocity: true, color: 'YELLOW', src: 'res://Scenes/Particles/LevelUpParticles.tscn' },
    background: { texture: 'particle/circle', amount: 96, amountBattle: 128, lifetime: 10, lifetimeRandomness: 0.4, box: [480, 270], scale: [0.1, 0.2], scaleCurve: [[0, 0], [0.52381, 1], [1, 0]], grey: 0.17, parallax: [0.1, 0.2], src: 'res://Scenes/Effects/BgParticles.tscn, res://GameScenes/ShopScene.tscn' },
  },
  springs: { scale: { stiffness: 250, damping: 12 }, rotate: { stiffness: 600, damping: 14 }, property: { stiffness: 150, damping: 10 }, maxDt: 0.05, src: 'res://Scripts/Autoloads/Springer.gd, res://Scripts/Autoloads/Spring.gd' },
  transition: { frames: 16, fps: 28, frameSize: [500, 290], textDelaySec: 0.2, textRevealSec: 0.3, textBlinkSec: 0.04, textBlinks: 14, holdSec: 0.4, darkColor: '#8f8f8f', src: 'res://Scripts/Effects/SceneTransition.gd, res://MainScene.tscn' },
  levelUpText: 'LEVEL UP',
});

// ---------------------------------------------------------------- meta
const ms = R('milestones.json');
out('milestones.json', {
  note: 'Lifetime kill goals. text and rewardText are shown as in the original (BLUE RIVAL says 1,500 but needs 1,600, as in the original).',
  source: 'res://Scripts/Autoloads/Stores/MilestoneStore.gd, res://Scripts/Upgrades/UpgradeProcessor.gd:402-508',
  milestones: ms.milestones.map((m) => ({
    id: m.id,
    name: m.name,
    text: m.unlock_text,
    rewardText: m.reward_text.replace(/ \w+$/, ''),
    icon: `milestone/${m.id}`,
    counter: m.requirement.counter,
    count: m.requirement.count,
    reward: { currency: m.reward.currency, amount: m.reward.amount },
  })),
});

const cm = R('cryptomine.json');
out('cryptomine.json', {
  netcoinPerBit: v(cm.netcoin_per_bit),
  deposits: cm.deposit_buttons.values.map((amount, i) => ({ amount, label: cm.deposit_buttons.labels[i] })),
  upgradeCost: { currency: 'processors', amount: 1 },
  bitsPerSecByLevel: cm.speed_by_level.map((s) => s.bits_per_sec),
  maxLevel: v(cm.max_level),
  runsInEveryScene: true,
  src: 'res://Scripts/Systems/CryptoMine.gd, res://Scripts/Shop/CryptoMinePage.gd',
});

const lab = R('lab.json');
out('lab.json', {
  goalNetcoin: lab.research_goal_netcoin.value,
  depositTweenSec: 0.4,
  godvirus: { sprite: 'ui/godvirus', frames: 5, frameSize: [32, 32], fps: 10 },
  ending: {
    deployingSec: 4,
    deployedSec: 2,
    fadeDelaySec: 2,
    bgmFade: { volume: 0, lowpassHz: 500, sec: 10 },
    staticRampSec: 10,
    glitchShakeTo: 0.8,
    freezeSec: 5,
    blackSec: 2,
    noiseLeadSec: 1,
    credits: [
      { textKey: 'ending.title', from: 0, to: 3.5, pos: [113, 67] },
      { textKey: 'ending.dev', from: 4, to: 7.5, pos: [169, 105] },
      { textKey: 'ending.music', from: 8, to: 11.5, pos: [140, 126] },
      { textKey: 'ending.thanks', from: 13, to: 16.5, pos: [140, 115] },
    ],
    creditsSec: 16.5,
    afterCreditsSec: 5,
    loadingSpinDegPerSec: -180,
    backdropAlpha: 0.419608,
  },
  src: 'res://Scripts/Shop/LabPage.gd, res://Scripts/Ending.gd, res://Scenes/Ending.tscn',
});

out('achievements.json', {
  note: 'Names and descriptions as shown on Steam (not in the game files). Conditions follow where the original unlocks each one.',
  achievements: [
    { id: 'FIRST_SESSION', name: 'Awakened', description: 'Initiate your first session', when: { event: 'sessionStart', stat: 'sessions', atLeast: 1 } },
    { id: 'TOTAL_SESSIONS_50', name: 'Routine', description: 'Initiate 50 sessions', when: { event: 'sessionStart', stat: 'sessions', atLeast: 50 } },
    { id: 'MILESTONES', name: 'Milestones', description: 'Unlock Milestones', when: { event: 'feature', feature: 'milestones' } },
    { id: 'CRYPTO_MINE', name: 'Crypto Mine', description: 'Unlock the Crypto Mine', when: { event: 'feature', feature: 'cryptomine' } },
    { id: 'THE_LAB', name: 'The Lab', description: 'Unlock the Lab', when: { event: 'feature', feature: 'lab' } },
    { id: 'BITS_10K', name: 'Bit Guy', description: 'Earn 10,000 total Bits', when: { event: 'sessionEnd', stat: 'total_bits', atLeast: 10000 } },
    { id: 'BITS_100K', name: 'Bit Getter', description: 'Earn 100,000 total Bits', when: { event: 'sessionEnd', stat: 'total_bits', atLeast: 100000 } },
    { id: 'BITS_1M', name: 'Bit Collector', description: 'Earn 1,000,000 total Bits', when: { event: 'sessionEnd', stat: 'total_bits', atLeast: 1000000 } },
    { id: 'BITS_10M', name: 'Bit Lord', description: 'Earn 10,000,000 total Bits', when: { event: 'sessionEnd', stat: 'total_bits', atLeast: 10000000 } },
    { id: 'NODES_1K', name: 'Node Hunter', description: 'Earn 1,000 total Nodes', when: { event: 'sessionEnd', stat: 'total_nodes', atLeast: 1000 } },
    { id: 'NODES_10K', name: 'Node Buster', description: 'Earn 10,000 total Nodes', when: { event: 'sessionEnd', stat: 'total_nodes', atLeast: 10000 } },
    { id: 'SP_25', name: 'SP Seeker', description: 'Earn 25 total SP', when: { event: 'levelUp', stat: 'level', atLeast: 25 } },
    { id: 'DEPLOY_GODVIRUS', name: 'Genesis', description: 'Deploy the godvirus', when: { event: 'godvirus' } },
  ],
  src: 'research/data/achievements.json',
});

// ---------------------------------------------------------------- settings, look, sound
const st = R('settings.json');
out('settings.json', {
  note: 'Options menu in on-screen order. Values are the original option values (0 = first choice).',
  options: st.options.map((o) => ({
    id: o.id,
    label: o.label,
    kind: o.kind,
    ...(o.kind === 'choice' ? { choices: o.id === 'window_size' ? 'screenScales' : o.choices } : { range: o.range }),
    default: o.default,
  })),
  spacerAfter: 'color_palette',
  extra: [{ id: 'save', label: 'save', kind: 'save' }, { id: 'achievements', label: 'achievements', kind: 'achievements' }],
  src: 'res://Scripts/Autoloads/OptionData.gd, res://Scenes/Popups/Options/OptionsPopup.tscn',
});

const post = R('post.json');
const pv = (params) => Object.fromEntries(Object.entries(params).map(([k, x]) => [k, typeof x.value === 'string' && x.value.startsWith('Color(') ? x.value.slice(6, -1).split(',').map(Number) : x.value]));
out('post.json', {
  crt: pv(post.crt.params),
  glitch: pv(post.glitch.params),
  glow: {
    intensity: 1.8,
    intensityCrtOff: 0.9,
    strength: 0.75,
    hdrThreshold: 0.1,
    hdrLuminanceCap: 0.2,
    blendMode: 'additive',
    levels: [0, 0, 1, 0, 1, 0, 0],
    normalized: true,
  },
  src: 'res://MainScene.tscn:19-55, res://Shaders/CRTShader.gdshader, res://Shaders/GlitchScreenShader.gdshader',
});

const pal = R('palette.json');
out('palette.json', {
  colors: Object.fromEntries(Object.entries(pal.colors).map(([k, c]) => [k, c.hex])),
  currency: { bits: 'RED', nodes: 'DARK_BLUE', cores: 'PURPLE', sp: 'BLUE', netcoin: 'GREEN', processors: 'YELLOW' },
  outline: {
    default: { maxed: 'YELLOW', canBuy: 'GREEN', cannotBuy: 'RED' },
    alternate: { maxed: 'VIOLET', canBuy: 'GREEN', cannotBuy: 'DARK_RED' },
  },
  ui: {
    disabled: '#6c6c6c',
    transitionDark: '#8f8f8f',
    xpBar: '#d6a129',
    progressBar: '#dcdcdc',
    bgParticles: '#2b2b2b',
    blackPanel: '#0f0f0f',
    continueBtn: '#279b3a',
    optionsBtn: '#ed4eac',
    claimBtn: '#1d8c38',
    upgradeMineBtn: '#d33dc9',
    labTab: '#c949a9',
    creditsBtn: '#2b2b2b',
    helpBtn: '#1f1f1f',
    creditsText: '#dcdcdc',
  },
  src: 'res://Scripts/MyColors.gd, scenes cited in research/visuals-audio.md',
});

out('audio.json', {
  buses: { sfxDb: -10.5236, bgmDb: 0, bgmLowpassHz: 500, src: 'res://default_bus_layout.tres' },
  bgmProfiles: {
    boot: { volume: 1, lowpassHz: 1000, sec: 0.1, from: 0 },
    menu: { volume: 1, lowpassHz: 1000, sec: 0.5 },
    shop: { volume: 0.8, lowpassHz: 800, sec: 0.5 },
    battle: { volume: 1, lowpassHz: 5000, sec: 0.5 },
    transition: { volume: 0.7, lowpassHz: 500, sec: 0.5 },
    src: 'res://Scripts/Autoloads/BGM.gd:28, res://Scripts/MainScene.gd:60,97,117, res://Scripts/Effects/SceneTransition.gd:16',
  },
  sfx: { voices: 50, defaultPitchRange: 0.05, cooldownSteps: 1, src: 'res://Scripts/Autoloads/SFX.gd' },
  loops: ['STATIC', 'VOICE_LOOP'],
});

// ---------------------------------------------------------------- strings
out('strings.en.json', {
  note: 'Text exactly as the original shows it (tooltip.netcoin keeps the five tabs the original string picks up from a backslash line continuation). {0}, {1} are filled in by the game. [icon:x] draws a currency icon, [c:NAME]...[/c] colours text.',
  'menu.title': 'nodebuster',
  'menu.newGame': 'new game',
  'menu.continue': 'continue',
  'menu.options': 'options',
  'menu.quit': 'quit',
  'menu.credits': 'credits',
  'menu.newSaveConfirm': 'Start a new save? Your old save will be permanently deleted.',
  'common.no': 'no',
  'common.yes': 'yes',
  'common.back': 'back',
  'credits.developer': 'developer',
  'credits.developerName': 'Goblobin',
  'credits.music': 'music',
  'credits.musicName': 'Holizna',
  // CreditEntry URLButtons (res://Scenes/Popups/CreditsPopup.tscn).
  'credits.developerUrl': 'https://store.steampowered.com/curator/44783508',
  'credits.musicUrl': 'https://freemusicarchive.org/music/holiznacc0/',
  'transition.session': 'INITIALIZING SESSION...',
  'transition.home': 'ENTERING HOME...',
  'transition.menu': 'RETURNING TO MENU...',
  'gameMenu.options': 'options',
  'gameMenu.mainMenu': 'main menu',
  'shop.tab.upgrades': 'Upgrades',
  'shop.tab.milestones': 'Milestones',
  'shop.tab.cryptomine': 'Crypto Mine',
  'shop.tab.lab': 'Lab',
  'shop.tab.stats': 'Stats',
  'shop.breach': 'Breach',
  'resource.bits': 'Bits',
  'resource.nodes': 'Nodes',
  'resource.cores': 'Cores',
  'resource.sp': 'SP',
  'resource.netcoin': 'Netcoin',
  'resource.processors': 'Processors',
  'tooltip.bits': '{0} are a common resource dropped by red enemies.',
  'tooltip.nodes': '{0} are an uncommon resource dropped by blue enemies.',
  'tooltip.cores': '{0} are a limited resource obtained by defeating bosses. You can only earn one Core per prestige level.',
  'tooltip.sp': '{0} is a limited resource obtained by leveling up.',
  'tooltip.netcoin': '{0} is a resource obtained by converting 					Bits in the Crypto Mine.',
  'tooltip.processors': '{0} are a rare resource dropped by yellow enemies.',
  'upgrade.level': 'Lv. {0} / {1}',
  'upgrade.max': 'MAX',
  'prestige.choose': 'choose prestige level',
  'prestige.value': 'prestige\n{0}',
  'prestige.start': 'start session',
  'prestige.info': 'Unlock a new prestige level when you beat the boss of the previous one.\nEach prestige level increases both enemy stats and resource gain.',
  'battle.health': 'health',
  'battle.xp': 'xp',
  'battle.progress': 'progress',
  'battle.prestige': 'prestige {0}',
  'battle.terminate': 'TERMINATE',
  'end.title': 'SESSION TERMINATED',
  'end.status401': 'status code 401: health reached zero',
  'end.status404': 'status code 404: {0}\n{1}',
  'end.bossDefeated': 'boss defeated',
  'end.prestigeUnlocked': 'prestige {0} unlocked',
  'end.nowhere': 'there is nowhere left to go',
  'end.status500': 'status code 500: terminated by user',
  'end.acquired': 'acquired resources:',
  'end.none': 'none',
  'end.home': 'go to home',
  'end.restart': 'new session',
  'milestone.reward': 'REWARD: {0}',
  'milestone.claim': 'claim',
  'milestone.claimed': 'claimed',
  'mine.rate': '{0} -> {1}',
  'mine.rateTooltip': 'The conversion rate of {0} to {1}',
  'mine.deposited': 'deposited',
  'mine.depositedTooltip': 'Amount of deposited {0} that are currently being processed',
  'mine.returns': 'netcoin_returns',
  'mine.returnsTooltip': 'Total amount of {0} that the deposited {1} will convert into',
  'mine.time': 'time_remaining',
  'mine.timeTooltip': 'Time until all deposited {0} are converted into {1}',
  'mine.deposit': 'deposit',
  'mine.speed': 'conversion_speed: {0}/sec',
  'mine.speedTooltip': 'The current speed of conversion. Upgrade to improve the speed.',
  'mine.upgrade': 'upgrade speed ({0})',
  'mine.help': 'Deposit {0} and they will automatically be converted into {1} over time.\nSpend {2} to improve the conversion speed.',
  'lab.header': 'godvirus research lab',
  'lab.progress': 'research progress',
  'lab.deposit': 'deposit {0}',
  'lab.ready': 'virus ready',
  'lab.deploy': 'deploy virus',
  'lab.deployed': 'virus already deployed',
  'lab.help': 'Invest {0} into developing the godvirus.',
  'stats.damage': 'damage',
  'stats.damage.desc': 'damage you deal with each attack',
  'stats.armor': 'armor',
  'stats.armor.desc': 'reduce damage from hitting enemies by this amount',
  'stats.boss_armor': 'boss_armor',
  'stats.boss_armor.desc': 'reduce damage from hitting boss enemies by this amount',
  'stats.boss_armor_mult': 'boss_armor_mult',
  'stats.boss_armor_mult.desc': 'armor against bosses is multiplied by this amount',
  'ending.deploying': 'deploying virus...',
  'ending.deployed': 'virus deployed!',
  'ending.ok': 'ok',
  'ending.title': 'nodebuster',
  'ending.dev': 'a game by Goblobin',
  'ending.music': 'with music by Holizna',
  'ending.thanks': 'thanks for playing <3',
  'options.save': 'save',
  'options.export': 'export save',
  'options.import': 'import save',
  'options.exportDone': 'save string copied',
  'options.exportHint': 'copy this string to keep your save',
  'options.importHint': 'paste a save string, then press import',
  'options.importDone': 'save imported',
  'options.copy': 'copy',
  'options.achievements': 'achievements',
  'boot.start': 'click to start',
  'boot.loading': 'loading...',
  'boot.remake': 'fan remake of nodebuster by goblobin',
});
