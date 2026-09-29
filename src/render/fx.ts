// Visual effects driven by simulation events, ported from the original's
// Effects.gd, SquareImpact.gd, CornerBox.gd, ElectricityEffect.gd,
// FloatingText.gd, the particle scenes and Shaker.gd. Visual randomness uses its
// own RNG so it never disturbs the simulation.
import { Container, Graphics, NineSliceSprite, Sprite } from 'pixi.js';
import { Rng } from '../core/rng';
import { content, color } from '../data/content';
import { tex, ui } from '../ui/ctx';
import { SpringValue } from '../ui/spring';
import { solid } from '../ui/widgets';
import { PixelFont, textPad } from './pixelfont';

const WHITE = 0xdcdcdc;
const vrng = new Rng(0xfeed);

interface Fx {
  update(dt: number): boolean; // false = finished
  view: Container;
}

/** Shaker.ShakeInstance: interpolated noise with linear decay. */
class ShakeInstance {
  private elapsed = 0;
  private samples: number[];
  constructor(
    private magnitude: number,
    private duration: number,
    private frequency: number,
  ) {
    this.samples = Array.from({ length: Math.floor(duration * frequency) }, () => 2 * vrng.next() - 1);
  }
  get alive(): boolean {
    return this.elapsed < this.duration;
  }
  update(dt: number): void {
    this.elapsed += dt;
  }
  amplitude(): number {
    if (!this.alive) return 0;
    const s = this.elapsed * this.frequency;
    const s0 = Math.floor(s);
    const n = (i: number) => (i < this.samples.length ? this.samples[i] : 0);
    const k = (this.duration - this.elapsed) / this.duration;
    return this.magnitude * (n(s0) + (s - s0) * (n(s0 + 1) - n(s0))) * k;
  }
}

export class Shake {
  private x: ShakeInstance[] = [];
  private y: ShakeInstance[] = [];
  offset = { x: 0, y: 0 };
  intensity = 0.9;

  /** MyCamera.shake() */
  shake(): void {
    const s = content.effects.screenShake;
    const strength = s.magnitude * this.intensity;
    this.x.push(new ShakeInstance(strength, s.durationSec, s.frequency));
    this.y.push(new ShakeInstance(strength, s.durationSec, s.frequency));
  }

  update(dt: number): void {
    let ox = 0;
    let oy = 0;
    for (const s of this.x) {
      s.update(dt);
      ox += s.amplitude();
    }
    for (const s of this.y) {
      s.update(dt);
      oy += s.amplitude();
    }
    this.x = this.x.filter((s) => s.alive);
    this.y = this.y.filter((s) => s.alive);
    this.offset = { x: ox, y: oy };
  }
}

/** SquareImpact.gd: a filled square that shrinks from 1.4x, flashes white, then disappears. */
class SquareImpact implements Fx {
  view = new Container();
  private t = 0;
  private sprite: Sprite;
  constructor(x: number, y: number, rotationDeg: number, size: number, private col: number, flashing: boolean) {
    this.sprite = solid(-size / 2, -size / 2, size, size, flashing ? WHITE : col);
    this.view.addChild(this.sprite);
    this.view.position.set(x, y);
    this.view.angle = rotationDeg;
    this.view.scale.set(content.effects.squareImpact.startScale);
  }
  update(dt: number): boolean {
    const c = content.effects.squareImpact;
    this.t += dt;
    const k = Math.min(this.t / c.shrinkSec, 1);
    this.view.scale.set(c.startScale + (1 - c.startScale) * k);
    if (this.t >= c.flashSec) this.sprite.tint = this.col;
    return this.t < c.flashSec + c.holdSec;
  }
}

/** CornerBox.tscn used by explosions: pulses, then flickers out. */
export class CornerBox implements Fx {
  view = new Container();
  private box: NineSliceSprite;
  private fill: Sprite;
  private t = 0;
  private scaleS = new SpringValue(1);
  private rotS: SpringValue;
  private flickerAt = -1;
  constructor(public size: number, private col: number, baseDeg = 0, pulse = true) {
    this.box = new NineSliceSprite({ texture: tex('fx/box_corners'), leftWidth: 5, topHeight: 5, rightWidth: 5, bottomHeight: 5, width: size, height: size });
    this.fill = solid(0, 0, size, size, 0xffffff, 0.133333);
    this.view.addChild(this.fill, this.box);
    this.view.pivot.set(size / 2, size / 2);
    this.rotS = new SpringValue(baseDeg);
    this.view.angle = baseDeg;
    this.tint(col);
    if (pulse) this.pulse(baseDeg);
  }
  tint(c: number): void {
    this.box.tint = c;
    this.fill.tint = c;
  }
  resize(size: number): void {
    if (size === this.size) return;
    this.size = size;
    this.box.width = this.box.height = size;
    this.fill.width = this.fill.height = size;
    this.view.pivot.set(size / 2, size / 2);
  }
  /** CornerBox.pulse(base_dangle) */
  pulse(baseDeg = 0): void {
    const c = content.effects.cornerBoxPulse;
    this.tint(WHITE);
    this.t = 0;
    this.scaleS.pull(c.springScalePx / this.size, c.springStiffness, 12, 1);
    this.rotS.pull(vrng.sign() * c.rotateDeg, 600, 14, baseDeg).range(-100, 100);
  }
  startFlicker(): void {
    this.flickerAt = 0;
  }
  update(dt: number): boolean {
    this.t += dt;
    if (this.t >= content.effects.cornerBoxPulse.flashSec) this.tint(this.col);
    this.scaleS.update(dt);
    this.rotS.update(dt);
    this.view.scale.set(this.scaleS.value);
    this.view.angle = this.rotS.value;
    const ex = content.attacks.explosion;
    if (this.flickerAt >= 0) {
      this.flickerAt += dt;
      const flips = Math.floor(this.flickerAt / ex.flickerStepSec);
      this.view.visible = flips % 2 === 0;
      if (flips >= ex.flickerSteps) return false;
    }
    return true;
  }
}

class ExplosionBox implements Fx {
  view: Container;
  private t = 0;
  private flickering = false;
  constructor(private box: CornerBox) {
    this.view = box.view;
  }
  update(dt: number): boolean {
    this.t += dt;
    if (!this.flickering && this.t >= content.attacks.explosion.flickerDelaySec) {
      this.flickering = true;
      this.box.startFlicker();
    }
    return this.box.update(dt);
  }
}

/** ElectricityEffect.gd: jagged line whose width tweens to 0. */
class Electricity implements Fx {
  view = new Graphics();
  private t = 0;
  private points: { x: number; y: number }[] = [];
  constructor(x1: number, y1: number, x2: number, y2: number, private col: number) {
    const lc = content.attacks.lightning;
    const dist = Math.hypot(x2 - x1, y2 - y1);
    const dx = (x2 - x1) / (dist || 1);
    const dy = (y2 - y1) / (dist || 1);
    const n = 1 + Math.ceil(dist / lc.segment);
    this.points.push({ x: x1, y: y1 });
    for (let i = 0; i < n; i++) {
      const d = (dist / n) * i + (dist / n) * vrng.range(0.7, 1.3);
      const j = vrng.range(-(lc.jitter + 6), lc.jitter + 6);
      this.points.push({ x: x1 + dx * d - dy * j, y: y1 + dy * d + dx * j });
    }
    this.points.push({ x: x2, y: y2 });
    this.draw(lc.width);
  }
  private draw(w: number): void {
    this.view.clear();
    if (w <= 0) return;
    this.view.moveTo(this.points[0].x, this.points[0].y);
    for (const p of this.points.slice(1)) this.view.lineTo(p.x, p.y);
    this.view.stroke({ width: w, color: this.col });
  }
  update(dt: number): boolean {
    const lc = content.attacks.lightning;
    this.t += dt;
    this.draw(lc.width * (1 - Math.min(this.t / lc.fadeSec, 1)));
    return this.t < lc.fadeSec;
  }
}

type Curve = [number, number][];
function curveAt(c: Curve, t: number): number {
  if (t <= c[0][0]) return c[0][1];
  for (let i = 1; i < c.length; i++) {
    if (t <= c[i][0]) {
      const k = (t - c[i - 1][0]) / (c[i][0] - c[i - 1][0]);
      return c[i - 1][1] + (c[i][1] - c[i - 1][1]) * k;
    }
  }
  return c[c.length - 1][1];
}

interface ParticleDef {
  texture: string;
  amount: number;
  lifetime: number;
  velocity: [number, number];
  velocityCurve: Curve;
  scale: [number, number];
  scaleCurve: Curve;
  alignToVelocity: boolean;
}

/** One-shot, fully explosive GPUParticles2D burst with radial velocity. */
class Burst implements Fx {
  view = new Container();
  private t = 0;
  private parts: { s: Sprite; dx: number; dy: number; v: number; scale: number }[] = [];
  constructor(private def: ParticleDef, x: number, y: number, col: number) {
    this.view.position.set(x, y);
    for (let i = 0; i < def.amount; i++) {
      const a = vrng.range(0, Math.PI * 2);
      const s = new Sprite(tex(def.texture));
      s.anchor.set(0.5);
      s.tint = col;
      if (def.alignToVelocity) s.rotation = a + Math.PI / 2;
      this.view.addChild(s);
      this.parts.push({ s, dx: Math.cos(a), dy: Math.sin(a), v: vrng.range(def.velocity[0], def.velocity[1]), scale: vrng.range(def.scale[0], def.scale[1]) });
    }
  }
  update(dt: number): boolean {
    this.t += dt;
    const k = Math.min(this.t / this.def.lifetime, 1);
    const vk = curveAt(this.def.velocityCurve, k);
    const sk = curveAt(this.def.scaleCurve, k);
    for (const p of this.parts) {
      p.s.x += p.dx * p.v * vk * dt;
      p.s.y += p.dy * p.v * vk * dt;
      p.s.scale.set(p.scale * sk);
    }
    return this.t < this.def.lifetime;
  }
}

/** FloatingText.gd ("LEVEL UP"). */
class FloatingText implements Fx {
  view = new Container();
  private t = 0;
  private sprite: Sprite;
  private blink: { period: number; next: number; count: number };
  private baseY: number;
  constructor(text: string, x: number, y: number, col: number) {
    const f = content.effects.floatingText;
    const t = ui.font.texture(text, 11);
    this.sprite = new Sprite(t);
    this.sprite.tint = col;
    const w = ui.font.measure(text, 11);
    const h = PixelFont.metrics(11).lineHeight;
    this.view.position.set(x - w / 2, y - h / 2);
    this.baseY = this.view.y;
    this.sprite.y = -textPad(t);
    this.view.addChild(this.sprite);
    this.blink = { period: f.durationSec / 2.5, next: f.durationSec / 2.5, count: 0 };
  }
  update(dt: number): boolean {
    const f = content.effects.floatingText;
    this.t += dt;
    const k = Math.min(this.t / f.riseSec, 1);
    this.view.y = this.baseY - f.rise * (1 - (1 - k) * (1 - k));
    // visible_ratio 0 -> 1 over revealSec: crop the texture width.
    const r = Math.min(this.t / f.revealSec, 1);
    this.sprite.scale.x = 1;
    this.sprite.width = Math.max(1, this.sprite.texture.width * r);
    // MyTimer.create_repeating(duration / 2.5, 0.8): blinks faster until under one frame.
    if (this.t >= this.blink.next) {
      this.view.visible = !this.view.visible;
      this.blink.period *= f.blinkDecrement;
      this.blink.next += this.blink.period;
      if (this.blink.period <= 0.0167) return false;
    }
    return true;
  }
}

export class FxLayer {
  readonly view = new Container();
  private items: Fx[] = [];
  flashing = true;

  add(fx: Fx): void {
    this.items.push(fx);
    this.view.addChild(fx.view);
  }

  impact(x: number, y: number, size: number, col: number, rotationDeg = 0): void {
    this.add(new SquareImpact(x, y, rotationDeg, size, col, this.flashing));
  }

  explosion(x: number, y: number, angleDeg: number, size: number): void {
    const box = new CornerBox(size, color('BLUE'), angleDeg);
    box.view.position.set(x, y);
    this.add(new ExplosionBox(box));
  }

  lightning(x1: number, y1: number, x2: number, y2: number): void {
    this.add(new Electricity(x1, y1, x2, y2, color('BLUE')));
  }

  particles(kind: 'hit' | 'levelUp', x: number, y: number, col: number): void {
    this.add(new Burst(content.effects.particles[kind] as ParticleDef, x, y, col));
  }

  text(text: string, x: number, y: number, col: number): void {
    this.add(new FloatingText(text, x, y, col));
  }

  update(dt: number): void {
    this.items = this.items.filter((f) => {
      const alive = f.update(dt);
      if (!alive) f.view.destroy({ children: true });
      return alive;
    });
  }

  clear(): void {
    for (const f of this.items) f.view.destroy({ children: true });
    this.items = [];
  }
}
