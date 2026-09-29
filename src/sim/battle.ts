// One session ("breach"), ported from the original's BattleScene.gd,
// EnemySpawner.gd, PlayerCursor.gd, Enemy.gd, PulseBolt.gd, MovingPulser.gd,
// Lightning.gd, Globals.create_explosion and XPBar.gd.
//
// Pure and headless: no rendering or audio. Each 1/60 s step runs in the
// original's frame order (physics callbacks, then _process in scene-tree order,
// then deferred calls, then queue_free). Things the view must show or play are
// pushed to `events`.
import { Rng } from '../core/rng';
import { content, type BossDef, type Currency, type EnemyType, type PrestigeLevel } from '../data/content';
import { angleDifference, box, circle, ease, easeOutQuad, overlaps, type Shape } from './geometry';
import { gain, type Profile } from './profile';
import { maxHealth, reticleSize, xpToNext, type Stats } from './stats';

export const W = 480;
export const H = 270;
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

export type EndStatus = 0 | 1 | 2; // health reached zero | boss defeated | terminated

export type SfxName = 'PULSE' | 'HIT' | 'ELECTRICITY' | 'PICKUP_START' | 'PICKUP_RESOURCE' | 'LEVEL_UP' | 'WIN' | 'LOSE';

export type SimEvent =
  | { type: 'sfx'; name: SfxName; pitchRange?: number; volumeDb?: number }
  | { type: 'shake' }
  | { type: 'attack'; x: number; y: number }
  | { type: 'hit'; id: number; x: number; y: number; color: number; alive: boolean }
  | { type: 'kill'; id: number; x: number; y: number; rotation: number; width: number; color: number }
  | { type: 'explosion'; x: number; y: number; angle: number; size: number }
  | { type: 'impact'; x: number; y: number; size: number }
  | { type: 'lightning'; x1: number; y1: number; x2: number; y2: number }
  | { type: 'dronePulse'; id: number }
  | { type: 'levelUp'; x: number; y: number }
  | { type: 'end'; status: EndStatus }
  | { type: 'achievement'; stat: string };

export interface Enemy {
  id: number;
  kind: string;
  def: EnemyType | BossDef;
  boss: boolean;
  rainbow: boolean;
  currency: Currency;
  color: number;
  x: number;
  y: number;
  rotation: number;
  rotateSpeed: number;
  scale: number;
  speed: number;
  dirX: number;
  dirY: number;
  maxHp: number;
  hp: number;
  damage: number;
  timeAlive: number;
  dead: boolean;
  /** queue_free() called: still in queries until the end of the step, like Godot. */
  removed: boolean;
  /** Gone for good (is_instance_valid() == false). */
  freed: boolean;
  dropMult: number;
  xpMult: number;
  hue: number;
}

export interface Drop {
  id: number;
  currency: Currency;
  x: number;
  y: number;
  phase: 'idle' | 'away' | 'fly' | 'gone';
  t: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}

export interface Bolt {
  id: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
  angle: number;
  damage: number;
  lifetime: number;
  age: number;
  inside: Set<number>;
  removed: boolean;
}

export interface Drone {
  id: number;
  x: number;
  y: number;
  angle: number;
  speed: number;
  barMax: number;
  bar: number;
  target: Enemy | null;
  destX: number;
  destY: number;
}

interface Chain {
  x: number;
  y: number;
  damage: number;
  hops: number;
  wait: number;
  exclude: Set<number>;
}

export interface BattleInit {
  profile: Profile;
  stats: Stats;
  seed: number;
  /** Starting cursor position (the original reads the mouse). */
  cursor?: { x: number; y: number };
}

const currencyColor = (c: Currency): number => parseInt(content.palette.colors[content.palette.currency[c]].slice(1), 16);

export class Battle {
  readonly rng: Rng;
  readonly profile: Profile;
  readonly stats: Stats;
  readonly prestige: PrestigeLevel;
  readonly bossDef: BossDef;
  readonly events: SimEvent[] = [];

  /** BattleScene.elapsed_time (stops when the session ends). */
  elapsed = 0;
  /** Simulation time since the scene started (keeps running on the end screen). */
  clock = 0;
  hp: number;
  maxHp: number;
  xp: number;
  xpMax: number;
  cursor = { x: 93, y: 127 };
  pulseTime = 0;
  readonly reticle: number;
  /** PlayerCursor.dead: set when the end screen opens. */
  dead = false;
  battleOver = false;
  status: EndStatus | null = null;
  bossSpawned: boolean;
  readonly progressVisible: boolean;
  progress = 0;
  readonly progressMax: number;
  died = false;
  /** Resources collected this session, in first-collected order (end screen). */
  readonly collected = new Map<Currency, number>();

  enemies: Enemy[] = [];
  drops: Drop[] = [];
  bolts: Bolt[] = [];
  readonly drones: Drone[] = [];
  private chains: Chain[] = [];

  /** EnemySpawner.curr_spawn_delta */
  spawnAcc: number;
  private baseHealth: number;
  private baseDamage: number;
  private weights: Record<string, number>;
  private yellowWeights: Record<string, number>;
  private deferred: (() => void)[] = [];
  private nextId = 1;
  private dronesPending: boolean;

  constructor(init: BattleInit) {
    this.rng = new Rng(init.seed);
    this.profile = init.profile;
    this.stats = init.stats;
    const p = init.profile;
    this.prestige = content.prestige.levels[Math.min(p.curr_prestige, content.prestige.max)];
    this.bossDef = content.bosses.bosses[0];
    if (init.cursor) this.cursor = { ...init.cursor };

    this.maxHp = maxHealth(this.stats, p);
    this.hp = this.maxHp;
    this.xpMax = xpToNext(p.level);
    this.xp = Math.min(p.curr_xp, this.xpMax);
    this.reticle = reticleSize(this.stats);
    this.progressMax = this.bossDef.spawnAfterSec;
    this.progressVisible = !(this.bossDef.onlyAtMaxPrestige && p.curr_prestige < p.max_prestige);
    this.bossSpawned = !this.progressVisible;

    // EnemySpawner + BattleScene.setup_prestige
    const sp = content.spawn;
    this.spawnAcc = sp.initialAccumulator;
    this.baseHealth = this.prestige.enemyBaseHealth;
    this.baseDamage = this.prestige.enemyBaseDamage;
    this.weights = { ...this.prestige.spawnWeights };
    const ex = sp.exploder;
    const exChance = this.stats[ex.chanceStat] ?? 0;
    if (exChance > 0) {
      this.weights[ex.takeWeightFrom] = (this.weights[ex.takeWeightFrom] ?? 0) - exChance;
      this.weights[ex.type] = exChance;
    }
    // set_spawn_rates() copies the weights for yellow enemies before the exploder is added.
    this.yellowWeights = { ...this.prestige.spawnWeights };
    for (const t of sp.currencyRules[0]?.excludeTypes ?? []) delete this.yellowWeights[t];
    this.dronesPending = true;
  }

  // ------------------------------------------------------------------ helpers

  private emit(e: SimEvent): void {
    this.events.push(e);
  }

  private sfx(name: SfxName, pitchRange?: number, volumeDb?: number): void {
    this.emit({ type: 'sfx', name, pitchRange, volumeDb });
  }

  /** PlayerHealthBar.adjust_health: value clamped to [0, max]; dies at 0. */
  private adjustHealth(amount: number): void {
    this.hp = Math.min(Math.max(this.hp + amount, 0), this.maxHp);
    if (this.hp <= 0) this.die();
  }

  private loseHealth(amount: number): void {
    this.hp = Math.min(Math.max(this.hp - amount, 0), this.maxHp);
  }

  private die(): void {
    this.died = true;
    this.end(0);
  }

  private end(status: EndStatus): void {
    if (this.battleOver) return;
    this.battleOver = true;
    this.status = status;
    this.dead = true;
    this.emit({ type: 'end', status });
    if (status === 0 || status === 2) this.sfx('LOSE', 0, 2);
    else this.sfx('WIN', 0);
    this.emit({ type: 'achievement', stat: 'sessionEnd' });
  }

  /** BattleScene._on_drop_collected (connected to Globals.drop_collected). */
  private dropCollected(c: Currency, amount: number): void {
    if (this.stats.health_on_pickup_drop > 0) this.adjustHealth(this.stats.health_on_pickup_drop);
    this.collected.set(c, (this.collected.get(c) ?? 0) + amount);
  }

  enemyWidth(e: Enemy): number {
    return 128 * e.scale;
  }

  enemyShape(e: Enemy): Shape {
    const h = e.def.hitbox;
    const s = e.scale;
    const c = Math.cos(e.rotation);
    const sn = Math.sin(e.rotation);
    const ox = (h.offset[0] * c - h.offset[1] * sn) * s;
    const oy = (h.offset[0] * sn + h.offset[1] * c) * s;
    if (h.shape === 'rect') return box(e.x + ox, e.y + oy, h.size![0] * s, h.size![1] * s, e.rotation);
    return circle(e.x + ox, e.y + oy, h.radius! * s);
  }

  /** ShapeCaster.box_cast / circle_cast against enemies (max_results as in the original). */
  query(shape: Shape, max = 128, exclude?: Set<number>): Enemy[] {
    const out: Enemy[] = [];
    for (const e of this.enemies) {
      if (exclude?.has(e.id)) continue;
      if (overlaps(shape, this.enemyShape(e))) {
        out.push(e);
        if (out.length >= max) break;
      }
    }
    return out;
  }

  private baseAttackDamage(): number {
    return this.stats.damage + this.stats.max_health_damage * this.maxHp;
  }

  // ------------------------------------------------------------------ step

  step(dt: number, mouse?: { x: number; y: number }): void {
    this.events.length = 0;
    this.physics(dt);
    this.process(dt, mouse);
    const d = this.deferred;
    this.deferred = [];
    for (const f of d) f();
    for (const e of this.enemies) if (e.removed) e.freed = true;
    this.enemies = this.enemies.filter((e) => !e.removed);
    this.bolts = this.bolts.filter((b) => !b.removed);
    this.drops = this.drops.filter((d) => d.phase !== 'gone');
  }

  private physics(dt: number): void {
    // Enemy._physics_process
    const des = content.enemies.despawn;
    for (const e of this.enemies) {
      if (e.removed) continue;
      e.timeAlive += dt;
      let dx = e.dirX;
      let dy = e.dirY;
      const def = e.def as EnemyType;
      if (!e.boss && def.wavy) {
        const perpLen = Math.sin(e.timeAlive * def.wavy.period) * def.wavy.amplitude;
        const vx = e.dirX * e.speed + -e.dirY * perpLen;
        const vy = e.dirY * e.speed + e.dirX * perpLen;
        const len = Math.hypot(vx, vy) || 1;
        dx = vx / len;
        dy = vy / len;
      }
      e.x += dx * e.speed * dt;
      e.y += dy * e.speed * dt;
      if (!e.boss && def.faceVelocity) e.rotation = Math.atan2(dy, dx);
      else e.rotation = (e.rotation + e.rotateSpeed * dt) % TAU;
      const w = this.enemyWidth(e) * des.marginFactor;
      if (e.timeAlive >= des.minAgeSec && (e.x > W + w || e.x < -w || e.y > H + w || e.y < -w)) {
        if (e.boss && this.bossDef.onOutOfBounds === 'reenter') this.place(e);
        else e.removed = true;
      }
    }

    // PulseBolt._physics_process + area_entered
    const pb = content.attacks.pulseBolt;
    for (const b of this.bolts) {
      if (b.removed) continue;
      b.x += b.dx * pb.speed * dt;
      b.y += b.dy * pb.speed * dt;
      b.age += dt;
      if (b.age >= b.lifetime) {
        if (this.stats.pulse_bolt_explode) {
          this.explosion(b.x, b.y, this.rng.range(0, 90), pb.explodeSize, this.stats.pulse_bolt_damage_mod, false);
          this.sfx('PULSE');
        }
        this.emit({ type: 'impact', x: b.x, y: b.y, size: pb.impactSize });
        b.removed = true;
        continue;
      }
      const shape = circle(b.x, b.y, pb.radius);
      const now = new Set<number>();
      for (const e of this.enemies) {
        if (e.removed || !overlaps(shape, this.enemyShape(e))) continue;
        now.add(e.id);
        if (b.inside.has(e.id)) continue;
        this.takeDamage(e, b.damage);
        this.emit({ type: 'impact', x: b.x, y: b.y, size: pb.impactSize });
        this.sfx('HIT', 0.2);
        this.enemyHit(e);
      }
      b.inside = now;
    }

    // PlayerCursor._physics_process: pick up drops.
    if (!this.dead) {
      const r = this.stats.drop_pickup_radius + content.economy.drops.dropRadius;
      for (const d of this.drops) {
        if (d.phase !== 'idle') continue;
        if ((d.x - this.cursor.x) ** 2 + (d.y - this.cursor.y) ** 2 <= r * r) this.pickup(d);
      }
    }
  }

  private process(dt: number, mouse?: { x: number; y: number }): void {
    this.clock += dt;
    const target = mouse ?? this.cursor;

    // Deferred setup_pulsers(): drones appear on the first frame.
    if (this.dronesPending) {
      this.dronesPending = false;
      const dr = content.attacks.drone;
      for (let i = 0; i < this.stats.auto_pulser_count; i++) {
        const barMax = dr.intervalSec / (1 + this.stats.auto_pulser_attack_speed_mod);
        this.drones.push({
          id: this.nextId++,
          angle: this.rng.range(0, TAU),
          x: this.rng.range(dr.spawnMargin, W - dr.spawnMargin),
          y: this.rng.range(dr.spawnMargin, H - dr.spawnMargin),
          speed: dr.speed * (1 + this.stats.auto_pulser_speed_mod),
          barMax,
          bar: this.rng.range(0, barMax / 2),
          target: null,
          destX: 0,
          destY: 0,
        });
      }
    }

    // BattleScene._process
    if (!this.dead) {
      const change = -this.prestige.healthLossPerSec + this.stats.health_regen + this.maxHp * this.stats.max_health_regen;
      this.adjustHealth(change * dt);
      this.elapsed += dt;
    }
    if (!this.dead && !this.bossSpawned) {
      this.progress = Math.min(this.progress + dt, this.progressMax);
      if (this.progress >= this.progressMax) {
        this.spawnBoss();
        this.bossSpawned = true;
      }
    }

    // EnemySpawner._process
    const sp = content.spawn;
    this.spawnAcc += this.stats.spawn_rate * this.stats.spawn_rate_mod * dt;
    while (this.spawnAcc >= 1) {
      this.spawnAcc -= 1;
      let currency: Currency = sp.defaultCurrency;
      for (const rule of sp.currencyRules) {
        if (this.rng.chance(this.stats[rule.chanceStat] ?? 0)) {
          currency = rule.currency;
          break;
        }
      }
      const weights = currency === sp.currencyRules[0]?.currency ? this.yellowWeights : this.weights;
      this.spawnEnemy(currency, this.rng.weighted(weights));
    }
    this.baseHealth += this.prestige.enemyHealthGrowthPerSec * dt;
    this.baseDamage += this.prestige.enemyDamageGrowthPerSec * dt;

    // EnemyDropsCreator._process
    const dr = content.economy.drops;
    for (const d of this.drops) {
      if (d.phase === 'away') {
        d.t += dt;
        const k = easeOutQuad(Math.min(d.t / dr.moveAwaySec, 1));
        d.x = d.fromX + (d.toX - d.fromX) * k;
        d.y = d.fromY + (d.toY - d.fromY) * k;
        if (d.t >= dr.moveAwaySec) {
          d.phase = 'fly';
          d.t = 0;
          d.fromX = d.x;
          d.fromY = d.y;
        }
      } else if (d.phase === 'fly') {
        d.t += dt * dr.flyRate;
        const k = ease(d.t, dr.flyEase);
        d.x = d.fromX + (target.x - d.fromX) * k;
        d.y = d.fromY + (target.y - d.fromY) * k;
        if (d.t >= 1) {
          this.sfx('PICKUP_RESOURCE', 0.1);
          d.phase = 'gone';
        }
      }
    }

    // PlayerCursor._process
    if (!this.dead) {
      this.cursor.x = Math.min(Math.max(target.x, 0), W);
      this.cursor.y = Math.min(Math.max(target.y, 0), H);
      this.pulseTime += this.stats.attacks_per_sec * (1 + this.stats.attack_speed_mod) * dt;
      if (this.pulseTime >= 1) {
        this.pulseTime -= 1;
        this.attack();
      }
    }

    // MovingPulser._process
    const dcfg = content.attacks.drone;
    for (const d of this.drones) {
      if (!this.battleOver) {
        d.bar += dt;
        if (d.bar >= d.barMax) {
          d.bar = 0;
          this.explosion(d.x, d.y, dcfg.angleDeg, dcfg.size * (1 + this.stats.auto_pulser_size_mod), 0, true);
          this.emit({ type: 'dronePulse', id: d.id });
        }
      }
      if (d.target && !d.target.freed) {
        d.destX = d.target.x;
        d.destY = d.target.y;
      } else {
        const alive = this.enemies;
        d.target = alive.length ? alive[this.rng.int(0, alive.length - 1)] : null;
      }
      const want = Math.atan2(d.destY - d.y, d.destX - d.x);
      d.angle += dcfg.turnRadPerSec * dt * Math.sign(angleDifference(d.angle, want));
      d.x += Math.cos(d.angle) * d.speed * dt;
      d.y += Math.sin(d.angle) * d.speed * dt;
    }

    // Lightning chains (SceneTreeTimer hops).
    const lc = content.attacks.lightning;
    for (const c of this.chains) {
      c.wait -= dt;
      if (c.wait > 1e-9) continue;
      const tgt = this.nearestEnemy(c.x, c.y, lc.range, c.exclude);
      if (!tgt) {
        c.hops = 0;
        continue;
      }
      this.emit({ type: 'lightning', x1: c.x, y1: c.y, x2: tgt.x, y2: tgt.y });
      this.takeDamage(tgt, c.damage);
      this.emit({ type: 'impact', x: tgt.x, y: tgt.y, size: lc.impactSize });
      this.sfx('ELECTRICITY');
      c.x = tgt.x;
      c.y = tgt.y;
      c.exclude.add(tgt.id);
      c.hops--;
      c.wait = lc.hopSec;
    }
    this.chains = this.chains.filter((c) => c.hops > 0);

    // Enemy._process: rainbow boss.
    for (const e of this.enemies) if (e.rainbow) e.hue = (e.hue + (this.bossDef.rainbowHueTurnsPerSec * dt)) % 1;
  }

  // ------------------------------------------------------------------ player

  private attack(): void {
    this.emit({ type: 'attack', x: this.cursor.x, y: this.cursor.y });
    this.sfx('PULSE');
    this.emit({ type: 'shake' });
    const results = this.query(box(this.cursor.x, this.cursor.y, this.reticle, this.reticle, 0), content.economy.reticle.maxTargets);
    const n = results.length;
    let damage = this.baseAttackDamage() * (1 + n * this.stats.damage_mod_per_enemy);
    let armorMod = 1 + n * this.stats.armor_mod_per_enemy;
    if (n <= content.economy.reticle.focusArmorMaxTargets) armorMod += this.stats.focus_armor_mod;
    armorMod += this.elapsed * this.stats.armor_mod_per_sec;
    for (const e of results) {
      // The original multiplies the shared damage variable, so the boss bonus
      // also applies to every enemy after the boss in this pulse.
      if (e.boss) damage *= 1 + this.stats.boss_damage_mod;
      this.takeDamage(e, damage);
      this.enemyHit(e);
      let armor = (this.stats.armor + this.maxHp * this.stats.max_health_armor) * armorMod;
      if (e.boss) armor = (armor + this.stats.boss_armor) * (1 + this.stats.boss_armor_mod);
      this.loseHealth(Math.max(e.damage - armor, 0));
      this.sfx('HIT', 0.2);
    }
    this.pulseBolts(this.cursor.x, this.cursor.y);
    // PlayerHealthBar._process runs later in the frame and catches 0 HP.
    if (this.hp <= 0 && !this.died) this.die();
  }

  terminate(): void {
    this.end(2);
  }

  /** Open the end screen without its gameplay consequences (visual tests). */
  forceEnd(status: EndStatus): void {
    this.events.length = 0;
    this.end(status);
  }

  /** BattleScene.enemy_hit: on-hit heals and the lightning roll. */
  private enemyHit(e: Enemy): void {
    this.adjustHealth(this.stats.health_on_hit + this.maxHp * this.stats.max_health_on_hit);
    if (this.rng.chance(this.stats.lightning_chance)) {
      const dmg = this.baseAttackDamage() * (1 + this.stats.lightning_damage_mod);
      this.chains.push({ x: e.x, y: e.y, damage: dmg, hops: this.stats.lightning_chains, wait: content.attacks.lightning.hopSec, exclude: new Set() });
    }
  }

  private nearestEnemy(x: number, y: number, r: number, exclude: Set<number>): Enemy | null {
    const hits = this.query(circle(x, y, r), Infinity, exclude);
    let best: Enemy | null = null;
    let bd = Infinity;
    for (const e of hits) {
      const d = (e.x - x) ** 2 + (e.y - y) ** 2;
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  /** Globals.create_explosion */
  explosion(x: number, y: number, angleDeg: number, size: number, damageMod = 0, effects = true): void {
    this.emit({ type: 'explosion', x, y, angle: angleDeg, size });
    if (effects) {
      this.sfx('PULSE');
      this.emit({ type: 'shake' });
    }
    const results = this.query(box(x, y, size, size, angleDeg * DEG));
    let damage = this.baseAttackDamage() * (1 + results.length * this.stats.damage_mod_per_enemy + damageMod);
    for (const e of results) {
      if (e.boss) damage *= 1 + this.stats.boss_damage_mod;
      this.takeDamage(e, damage);
      this.enemyHit(e);
      this.sfx('HIT', 0.2);
    }
  }

  /** Globals.create_pulse_bolts */
  pulseBolts(x: number, y: number): void {
    const count = this.stats.pulse_bolt_count;
    if (count <= 0) return;
    const pb = content.attacks.pulseBolt;
    const dmg = this.baseAttackDamage() * (1 + this.stats.pulse_bolt_damage_mod);
    for (let i = 0; i < count; i++) {
      const ang = (360 / count) * i + pb.firstAngleDeg;
      this.bolts.push({
        id: this.nextId++,
        x,
        y,
        dx: Math.cos(ang * DEG),
        dy: Math.sin(ang * DEG),
        angle: ang,
        damage: dmg,
        lifetime: this.rng.range(pb.lifetime[0], pb.lifetime[1]),
        age: 0,
        inside: new Set(),
        removed: false,
      });
    }
  }

  // ------------------------------------------------------------------ enemies

  private place(e: Enemy): void {
    const off = this.enemyWidth(e) * content.spawn.placement.offsetFactor;
    const side = this.rng.int(0, 3);
    const left = -off;
    const top = -off;
    const right = W + off;
    const bottom = H + off;
    if (side === 0 || side === 2) {
      e.y = side === 0 ? top : bottom;
      e.x = this.rng.range(left, right);
    } else {
      e.x = side === 1 ? right : left;
      e.y = this.rng.range(top, bottom);
    }
    const aim = this.rng.inRadius(content.spawn.placement.aimRadius);
    const tx = W / 2 + aim.x;
    const ty = H / 2 + aim.y;
    const len = Math.hypot(tx - e.x, ty - e.y) || 1;
    e.dirX = (tx - e.x) / len;
    e.dirY = (ty - e.y) / len;
  }

  spawnEnemy(currency: Currency, kind: string): Enemy {
    const def = content.enemyType.get(kind);
    if (!def) throw new Error(`unknown enemy type ${kind}`);
    const r = this.rng;
    const turns = def.spin[1] > 0 ? r.range(def.spin[0], def.spin[1]) : 0;
    const rotateSpeed = TAU * turns * (def.randomSpinDirection ? r.sign() : 1);
    const scale = r.range(def.scale[0], def.scale[1]);
    const speed = r.range(def.speed[0], def.speed[1]) * this.prestige.enemySpeedMod;
    const hp = this.baseHealth * def.healthMult;
    const e: Enemy = {
      id: this.nextId++,
      kind,
      def,
      boss: false,
      rainbow: false,
      currency,
      color: currencyColor(currency),
      x: 0,
      y: 0,
      rotation: 0,
      rotateSpeed,
      scale,
      speed,
      dirX: 1,
      dirY: 0,
      maxHp: hp,
      hp,
      damage: this.baseDamage * def.damageMult,
      timeAlive: 0,
      dead: false,
      removed: false,
      freed: false,
      dropMult: def.dropMult,
      xpMult: def.xpMult,
      hue: 0,
    };
    this.enemies.push(e);
    this.place(e);
    return e;
  }

  spawnBoss(): Enemy {
    const b = this.bossDef;
    const e: Enemy = {
      id: this.nextId++,
      kind: b.id,
      def: b,
      boss: true,
      rainbow: this.profile.curr_prestige >= b.rainbowFromPrestige,
      currency: b.currency,
      color: currencyColor(b.currency),
      x: 0,
      y: 0,
      rotation: 0,
      rotateSpeed: TAU * b.spinTurnsPerSec * (b.randomSpinDirection ? this.rng.sign() : 1),
      scale: b.scale,
      speed: b.speedIgnoresPrestige ? b.speed : b.speed * this.prestige.enemySpeedMod,
      dirX: 1,
      dirY: 0,
      maxHp: this.prestige.bossHealth,
      hp: this.prestige.bossHealth,
      damage: this.prestige.bossDamage,
      timeAlive: 0,
      dead: false,
      removed: false,
      freed: false,
      dropMult: 1,
      xpMult: 1,
      hue: 0,
    };
    this.enemies.push(e);
    this.place(e);
    return e;
  }

  /** Enemy.take_damage */
  takeDamage(e: Enemy, amount: number): void {
    let mods = 0;
    if (e.hp >= e.maxHp) mods += this.stats.undamaged_mod;
    else if (e.hp / e.maxHp <= 0.5) mods += this.stats.execute_mod;
    mods += this.elapsed * this.stats.damage_mod_per_sec;
    amount *= 1 + mods;
    if (this.rng.chance(this.stats.crit_chance)) amount *= 1 + this.stats.crit_damage;
    e.hp -= amount;
    if (e.hp <= 0 && !e.dead) {
      this.emit({ type: 'hit', id: e.id, x: e.x, y: e.y, color: e.color, alive: false });
      this.emit({ type: 'kill', id: e.id, x: e.x, y: e.y, rotation: e.rotation, width: this.enemyWidth(e), color: e.color });
      e.dead = true;
      e.removed = true;
      this.enemyDied(e);
    } else {
      this.emit({ type: 'hit', id: e.id, x: e.x, y: e.y, color: e.color, alive: true });
    }
  }

  /** EnemySpawner._on_enemy_died */
  private enemyDied(e: Enemy): void {
    const s = this.stats;
    const p = this.profile;
    const perma = s.perma_max_health_on_kill;
    this.maxHp += perma;
    p.bonus_max_health += perma;
    this.adjustHealth(s.health_on_kill);
    if (e.boss) {
      this.bossDefeated();
    } else {
      let count = 1;
      if (e.currency !== 'processors') {
        if (e.currency === 'bits') {
          count += s.bit_boost + this.prestige.bitBoost;
          p.nums.reds_killed += 1;
        } else if (e.currency === 'nodes') {
          count += s.node_boost + this.prestige.nodeBoost;
          p.nums.blues_killed += 1;
        }
        count *= e.dropMult;
        if (this.rng.chance(s.bonus_drop_chance)) count *= 2;
      } else {
        p.nums.yellows_killed += 1;
      }
      const x = e.x;
      const y = e.y;
      const scatter = this.enemyWidth(e) * content.economy.drops.scatterFactor;
      const n = Math.trunc(count);
      const c = e.currency;
      this.deferred.push(() => this.createDrops(n, c, x, y, scatter));
    }
    const def = e.def as EnemyType;
    for (const d of e.boss ? [] : def.onDeath) {
      if (d.explode) this.explosion(e.x, e.y, this.rng.range(0, 90), d.explode.size * (1 + (s[d.explode.sizeStat] ?? 0)));
      if (d.split) {
        const split = d.split;
        const { x, y, dirX, dirY, currency } = e;
        for (let i = 0; i < split.count; i++) {
          this.deferred.push(() => {
            const child = this.spawnEnemy(currency, split.type);
            const off = this.rng.inRadius(split.radius);
            child.x = x + off.x;
            child.y = y + off.y;
            child.dirX = dirX;
            child.dirY = dirY;
          });
        }
      }
    }
    if (this.rng.chance(s.enemy_death_pulse_bolt_chance)) {
      const { x, y } = e;
      this.deferred.push(() => this.pulseBolts(x, y));
    }
    p.nums.enemies_killed += 1;
    this.gainXp(this.prestige.enemyXp * e.xpMult);
  }

  private bossDefeated(): void {
    if (this.battleOver) return;
    const p = this.profile;
    const atMax = p.max_prestige === p.curr_prestige;
    if (atMax) {
      gain(p, 'cores', this.bossDef.reward.amount);
      this.dropCollected('cores', this.bossDef.reward.amount);
    }
    // The end screen reads the prestige before it is raised.
    this.end(1);
    if (atMax && this.bossDef.reward.unlockNextPrestige && p.max_prestige < content.prestige.max) {
      p.max_prestige += 1;
      p.curr_prestige += 1;
    }
  }

  // ------------------------------------------------------------------ drops, xp

  private createDrops(count: number, c: Currency, x: number, y: number, scatter: number): void {
    for (let i = 0; i < count; i++) {
      if (this.rng.chance(this.stats.autocollect_chance)) {
        this.collect(c);
      } else {
        const o = this.rng.inRadius(scatter);
        this.drops.push({ id: this.nextId++, currency: c, x: x + o.x, y: y + o.y, phase: 'idle', t: 0, fromX: 0, fromY: 0, toX: 0, toY: 0 });
      }
    }
  }

  /** EnemyDropsCreator.pickup */
  private pickup(d: Drop): void {
    const dist = Math.hypot(d.x - this.cursor.x, d.y - this.cursor.y) || 1;
    const away = content.economy.drops.moveAwayDistance;
    d.phase = 'away';
    d.t = 0;
    d.fromX = d.x;
    d.fromY = d.y;
    d.toX = d.x + ((d.x - this.cursor.x) / dist) * away;
    d.toY = d.y + ((d.y - this.cursor.y) / dist) * away;
    this.sfx('PICKUP_START');
    this.collect(d.currency);
  }

  /** EnemySpawner._on_pickup_drop */
  private collect(c: Currency): void {
    let amount = 1;
    if (c === 'bits') {
      const v = this.prestige.bitValue;
      amount = Math.trunc(v);
      if (this.rng.chance(v - amount)) amount += 1;
    }
    gain(this.profile, c, amount);
    this.dropCollected(c, amount);
  }

  /** XPBar.gain_xp (the bar clamps its value, so excess XP past one level is lost). */
  private gainXp(amount: number): void {
    this.xp = Math.min(this.xp + amount, this.xpMax);
    while (this.xp >= this.xpMax) {
      this.xp -= this.xpMax;
      this.profile.level += 1;
      gain(this.profile, 'sp', 1);
      this.dropCollected('sp', 1);
      this.xpMax = xpToNext(this.profile.level);
      this.emit({ type: 'levelUp', x: this.cursor.x, y: this.cursor.y });
      this.sfx('LEVEL_UP', 0);
      this.emit({ type: 'achievement', stat: 'level' });
    }
    this.profile.curr_xp = this.xp;
  }
}
