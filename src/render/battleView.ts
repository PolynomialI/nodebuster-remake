// Draws a Battle: scene background, enemies, drops, bolts, drones, reticle,
// effects and the HUD (res://GameScenes/BattleScene.tscn), plus the end screen
// (res://Scenes/UI/BattleEndScreen.tscn).
import { BgParticles } from './bgParticles';
import { Container, Graphics, Rectangle, Sprite, Texture } from 'pixi.js';
import { color, content, t } from '../data/content';
import type { Battle, Drone, Enemy, SimEvent } from '../sim/battle';
import { Control, Root, VBox, SHRINK_CENTER, MarginBox } from '../ui/control';
import { tex, ui } from '../ui/ctx';
import type { Pointer } from '../ui/pointer';
import { SpringValue } from '../ui/spring';
import { Bar, BG, ColorRect, Label, lerpColor, Panel, RichLabel, solid, TextButton, WHITE } from '../ui/widgets';
import { CornerBox, FxLayer, Shake } from './fx';

const DEG = 180 / Math.PI;

function hueShift(rgb: number, turns: number): number {
  const r = ((rgb >> 16) & 255) / 255;
  const g = ((rgb >> 8) & 255) / 255;
  const b = (rgb & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (((h / 6 + turns) % 1) + 1) % 1;
  const s = max ? d / max : 0;
  const v = max;
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const tt = v * (1 - (1 - f) * s);
  const [R, G, B] = [[v, tt, p], [q, v, p], [p, v, tt], [p, q, v], [tt, p, v], [v, p, q]][i % 6];
  return (Math.round(R * 255) << 16) | (Math.round(G * 255) << 8) | Math.round(B * 255);
}

/** TextureProgressBar with an outline texture over a mask texture filled by HP. */
class MaskBar {
  readonly view = new Container();
  private over: Sprite;
  private fill: Sprite;
  private fillTex: Texture;
  private pie: Graphics | null = null;
  private ratio = -1;
  private readonly offY: number;

  constructor(
    overId: string,
    private maskId: string,
    offset: [number, number],
    private mode: string,
  ) {
    const o = tex(overId);
    const m = tex(maskId);
    this.fillTex = new Texture({ source: m.source, frame: new Rectangle(0, 0, m.width, m.height) });
    this.fill = new Sprite(this.fillTex);
    this.fill.position.set(offset[0], offset[1]);
    this.offY = offset[1];
    this.over = new Sprite(o);
    this.view.addChild(this.fill, this.over);
    this.view.pivot.set(o.width / 2, o.height / 2);
    if (mode === 'clockwise_and_counter_clockwise') {
      this.pie = new Graphics();
      this.pie.position.set(offset[0], offset[1]);
      this.view.addChild(this.pie);
      this.fill.mask = this.pie;
    }
  }

  get width(): number {
    return this.over.texture.width;
  }

  set tint(c: number) {
    this.over.tint = c;
    this.fill.tint = c;
  }

  setRatio(r: number): void {
    r = Math.min(Math.max(r, 0), 1);
    if (r === this.ratio) return;
    this.ratio = r;
    const m = tex(this.maskId);
    const w = m.width;
    const h = m.height;
    this.fill.visible = r > 0;
    if (this.mode === 'bottom_to_top') {
      this.fillTex.frame.copyFrom(new Rectangle(0, h - h * r, w, h * r));
      this.fillTex.updateUvs();
      this.fill.texture = this.fillTex;
      this.fill.y = this.offY + (h - h * r);
    } else if (this.mode === 'left_to_right') {
      this.fillTex.frame.copyFrom(new Rectangle(0, 0, w * r, h));
      this.fillTex.updateUvs();
      this.fill.texture = this.fillTex;
    } else if (this.pie) {
      // Symmetric radial fill from the top (radial_initial_angle 0, both directions).
      const g = this.pie;
      g.clear();
      if (r >= 1) g.rect(0, 0, w, h).fill(0xffffff);
      else if (r > 0) {
        const cx = w / 2;
        const cy = h / 2;
        const R = Math.hypot(w, h);
        const half = Math.PI * r;
        g.moveTo(cx, cy);
        const steps = 32;
        for (let i = 0; i <= steps; i++) {
          const a = -Math.PI / 2 - half + (2 * half * i) / steps;
          g.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
        }
        g.closePath().fill(0xffffff);
      }
    }
  }

}

class EnemyView {
  readonly view = new Container();
  readonly bar: MaskBar;
  private spring = new SpringValue(1);
  private flashLeft = 0;
  private hue = 0;

  constructor(readonly enemy: Enemy) {
    const d = enemy.def;
    this.bar = new MaskBar(d.sprite, d.mask, d.maskOffset, d.fillMode);
    this.view.addChild(this.bar.view);
    this.sync(0, true);
  }

  /** Enemy.pulse(): scale spring on the bar, white for 0.1 s (flash only if enabled). */
  pulse(): void {
    this.spring.pull(10 / (128 * this.enemy.scale), 250, 12).range(content.effects.enemyHitSpring.min, content.effects.enemyHitSpring.max);
    this.flashLeft = content.enemies.hitFlashSec;
  }

  sync(dt: number, flashing: boolean): void {
    const e = this.enemy;
    this.view.position.set(e.x, e.y);
    this.view.rotation = e.rotation;
    this.view.scale.set(e.scale);
    this.spring.update(dt);
    this.bar.view.scale.set(this.spring.value);
    this.bar.setRatio(e.hp / e.maxHp);
    if (this.flashLeft > 0) {
      this.flashLeft -= dt;
      // After the flash the original resets modulate to the base colour (rainbow restarts).
      if (this.flashLeft <= 0) this.hue = 0;
    }
    if (e.rainbow) this.hue = (this.hue + dt) % 1;
    const base = e.rainbow ? hueShift(e.color, this.hue) : e.color;
    this.bar.tint = this.flashLeft > 0 && flashing ? WHITE : base;
  }
}

class DroneView {
  readonly view = new Container();
  private bar: MaskBar;
  private spring = new SpringValue(1);
  private flash = 0;
  constructor(readonly drone: Drone) {
    this.bar = new MaskBar('battle/pulser', 'battle/pulser_mask', [4, 4], 'bottom_to_top');
    this.view.addChild(this.bar.view);
  }
  pulse(): void {
    this.spring.pull(0.4, 250, 12);
    this.flash = content.attacks.drone.flashSec;
  }
  sync(dt: number): void {
    const d = this.drone;
    this.view.position.set(d.x, d.y);
    this.spring.update(dt);
    this.bar.view.scale.set(this.spring.value);
    this.bar.setRatio(d.bar / d.barMax);
    if (this.flash > 0) this.flash -= dt;
    this.bar.tint = this.flash > 0 ? WHITE : color('BLUE');
  }
}

export class BattleView {
  readonly root = new Container();
  readonly world = new Container();
  readonly fx = new FxLayer();
  readonly shake = new Shake();
  private enemies = new Map<number, EnemyView>();
  private drops = new Map<number, Sprite>();
  private bolts = new Map<number, Sprite>();
  private drones = new Map<number, DroneView>();
  private enemyLayer = new Container();
  private dropLayer = new Container();
  private boltLayer = new Container();
  private droneLayer = new Container();
  private reticle: CornerBox;
  private dot: Sprite;
  private cursorLayer = new Container();
  readonly hud: Root;
  private health!: Bar;
  private healthText!: Label;
  private xp!: Bar;
  private xpText!: Label;
  private progress!: Bar;
  terminate!: TextButton;
  private end: EndScreen | null = null;
  flashing = true;
  /** BattleScene.tscn BGParticles. */
  readonly particles = new BgParticles();
  onHome: () => void = () => {};
  onRestart: () => void = () => {};

  constructor(
    readonly battle: Battle,
    private pointer: Pointer,
  ) {
    // ColorRect background bigger than the screen so shake never shows an edge.
    this.world.addChild(solid(-95, -84, 776, 476, BG));
    this.world.addChild(this.particles.view);
    this.world.addChild(this.enemyLayer, this.dropLayer, this.boltLayer, this.cursorLayer, this.droneLayer, this.fx.view);
    this.reticle = new CornerBox(battle.reticle, color('BLUE'), 0, false);
    this.dot = new Sprite(tex('fx/square32'));
    this.dot.anchor.set(0.5);
    this.dot.scale.set(content.economy.reticle.dotScale);
    this.cursorLayer.addChild(this.dot, this.reticle.view);
    this.hud = new Root(480, 270);
    this.buildHud();
    this.root.addChild(this.world, this.hud.view);
    for (const d of battle.drones) this.addDrone(d);
  }

  private buildHud(): void {
    const b = this.battle;
    const hud = this.hud;
    const barW = Math.min(Math.max(76 + ((b.maxHp - 10) / 8000) * 124, 76), 200);
    this.health = hud.add(new Bar(color('RED')).place(10, 10, 10 + barW, 22));
    const tag = (c: Control, text: string, y: number) => c.add(new Label(text).place(2, y, 42, y + 12));
    tag(this.health, t('battle.health'), -10);
    this.healthText = this.health.add(new Label(''));
    this.healthText.setAnchorsPreset('full');
    this.healthText.hAlign = 'center';
    this.healthText.shadow = { color: BG, x: 1, y: 1, outline: 0 };
    this.xp = hud.add(new Bar(0xd6a129).place(10, 33, 86, 45));
    tag(this.xp, t('battle.xp'), -11);
    this.xpText = this.xp.add(new Label(''));
    this.xpText.setAnchorsPreset('full');
    this.xpText.hAlign = 'center';
    this.xpText.shadow = { color: BG, x: 1, y: 1, outline: 0 };
    this.terminate = hud.add(new TextButton(t('battle.terminate'), color('RED')).place(415, 237, 477, 257));
    this.terminate.onPressed = () => this.battle.terminate();
    this.pointer.register(this.terminate);
    this.progress = hud.add(new Bar(WHITE).place(3, 261, 477, 267));
    tag(this.progress, t('battle.progress'), -11);
    this.progress.setVisible(b.progressVisible);
    const p = b.profile;
    if (p.max_prestige > 0) {
      const pl = hud.add(new Label(t('battle.prestige', p.curr_prestige)));
      pl.setAnchorsPreset('topright').place(-40, 0, 0, 9);
      pl.growH = 'begin';
      pl.hAlign = 'right';
    }
    hud.layout();
  }

  private addDrone(d: Drone): void {
    const v = new DroneView(d);
    this.drones.set(d.id, v);
    this.droneLayer.addChild(v.view);
  }

  handle(events: readonly SimEvent[]): void {
    for (const e of events) {
      switch (e.type) {
        case 'shake':
          this.shake.shake();
          break;
        case 'attack':
          this.reticle.pulse(0);
          break;
        case 'hit':
          this.fx.particles('hit', e.x, e.y, e.color);
          if (e.alive) this.enemies.get(e.id)?.pulse();
          break;
        case 'kill':
          this.fx.impact(e.x, e.y, e.width + content.effects.squareImpact.grow, e.color, e.rotation * DEG);
          break;
        case 'explosion':
          this.fx.explosion(e.x, e.y, e.angle, e.size);
          break;
        case 'impact':
          this.fx.impact(e.x, e.y, e.size, color('BLUE'));
          break;
        case 'lightning':
          this.fx.lightning(e.x1, e.y1, e.x2, e.y2);
          break;
        case 'dronePulse':
          this.drones.get(e.id)?.pulse();
          break;
        case 'levelUp':
          this.fx.particles('levelUp', e.x, e.y, color('YELLOW'));
          this.fx.text(content.effects.levelUpText, e.x, e.y, color('YELLOW'));
          break;
        case 'end':
          this.showEnd(e.status);
          break;
      }
    }
  }

  private showEnd(status: 0 | 1 | 2): void {
    this.cursorLayer.visible = false;
    this.end = new EndScreen(this.battle, status, this.pointer);
    this.end.onHome = () => this.onHome();
    this.end.onRestart = () => this.onRestart();
    this.hud.view.addChild(this.end.root.view);
  }

  update(dt: number): void {
    const b = this.battle;
    this.shake.update(dt);
    this.root.position.set(-this.shake.offset.x, -this.shake.offset.y);
    this.fx.flashing = this.flashing;
    // Enemies
    const seen = new Set<number>();
    for (const e of b.enemies) {
      seen.add(e.id);
      let v = this.enemies.get(e.id);
      if (!v) {
        v = new EnemyView(e);
        this.enemies.set(e.id, v);
        this.enemyLayer.addChild(v.view);
      }
      v.sync(dt, this.flashing);
    }
    for (const [id, v] of this.enemies)
      if (!seen.has(id)) {
        v.view.destroy({ children: true });
        this.enemies.delete(id);
      }
    // Drops (drawn from their top-left, like canvas_item_add_texture_rect at the drop position)
    const dseen = new Set<number>();
    for (const d of b.drops) {
      dseen.add(d.id);
      let s = this.drops.get(d.id);
      if (!s) {
        s = new Sprite(tex(`drop/${d.currency}`));
        s.tint = color(content.palette.currency[d.currency]);
        this.drops.set(d.id, s);
        this.dropLayer.addChild(s);
      }
      s.position.set(d.x, d.y);
    }
    for (const [id, s] of this.drops)
      if (!dseen.has(id)) {
        s.destroy();
        this.drops.delete(id);
      }
    // Bolts: 14x6 rect centred, rotated to the flight direction.
    const bseen = new Set<number>();
    const pb = content.attacks.pulseBolt;
    for (const bo of b.bolts) {
      bseen.add(bo.id);
      let s = this.bolts.get(bo.id);
      if (!s) {
        s = new Sprite(Texture.WHITE);
        s.anchor.set(0.5);
        s.width = pb.spriteSize[0];
        s.height = pb.spriteSize[1];
        s.tint = color('BLUE');
        s.angle = bo.angle;
        this.bolts.set(bo.id, s);
        this.boltLayer.addChild(s);
      }
      s.position.set(bo.x, bo.y);
    }
    for (const [id, s] of this.bolts)
      if (!bseen.has(id)) {
        s.destroy();
        this.bolts.delete(id);
      }
    for (const d of b.drones) this.drones.get(d.id)?.sync(dt);
    // Reticle
    this.reticle.resize(b.reticle);
    this.reticle.update(dt);
    this.reticle.view.position.set(b.cursor.x, b.cursor.y);
    this.dot.position.set(b.cursor.x, b.cursor.y);
    this.fx.update(dt);
    // HUD
    this.health.set(b.hp, b.maxHp);
    this.healthText.setText(`${b.hp.toFixed(1)}/${Math.trunc(b.maxHp)}`);
    this.xp.set(b.xp, b.xpMax);
    this.xpText.setText(`${Math.trunc((b.xp * 100) / b.xpMax)}%`);
    if (b.progressVisible) this.progress.set(b.progress, b.progressMax);
    this.terminate.update(dt);
    this.end?.update(dt);
  }

  destroy(): void {
    this.pointer.clear();
    this.fx.clear();
    this.root.destroy({ children: true });
  }
}

/** res://Scenes/UI/BattleEndScreen.tscn */
class EndScreen {
  readonly root: Root;
  private labels: RichLabel[] = [];
  private t = 0;
  private buttons: TextButton[] = [];
  onHome = () => {};
  onRestart = () => {};

  constructor(b: Battle, status: 0 | 1 | 2, pointer: Pointer) {
    this.root = new Root(480, 270);
    const scr = this.root.add(new Control());
    scr.setAnchorsPreset('full').place(-40, -44, 40, 44);
    const bgCol = lerpColor(BG, status === 1 ? color('GREEN') : color('RED'), 0.2);
    const bg = scr.add(new ColorRect(bgCol, 0.6));
    bg.setAnchorsPreset('full');
    const box = scr.add(new VBox());
    box.setAnchorsPreset('center').place(-182, -20, 182, 20);
    box.growH = box.growV = 'both';
    const rich = (m: string, col = WHITE) => {
      const l = box.add(new RichLabel(`[center]${m}[/center]`, col));
      this.labels.push(l);
      return l;
    };
    const space = (h: number) => {
      const c = box.add(new Control());
      c.customMin = { w: 0, h };
    };
    rich(t('end.title'), color('RED'));
    space(14);
    let status2: string;
    if (status === 0) status2 = t('end.status401');
    else if (status === 2) status2 = t('end.status500');
    else {
      const sub = b.profile.curr_prestige < content.prestige.max ? `[color=#eed345]${t('end.prestigeUnlocked', b.profile.max_prestige + 1)}[/color]` : t('end.nowhere');
      status2 = t('end.status404', `[color=#eed345]${t('end.bossDefeated')}[/color]`, sub);
    }
    rich(status2);
    space(14);
    rich(t('end.acquired'));
    const panel = box.add(new Panel('box'));
    panel.selfModulate = WHITE;
    panel.flagsH = SHRINK_CENTER;
    const margin = panel.add(new MarginBox(6, 2, 6, 2));
    const icon = (c: string) => `[img]Sprites/UI/${{ bits: 'Red', nodes: 'Blue', cores: 'Purple', sp: 'SP', netcoin: 'Netcoin', processors: 'Processors' }[c]}.png[/img]`;
    const colHex = (c: string) => content.palette.colors[content.palette.currency[c]];
    const lines = [...b.collected].map(([c, n]) => `${icon(c)} [color=${colHex(c)}]${n}[/color]`);
    const res = margin.add(new RichLabel(`[center]${lines.length ? lines.join('\n') : t('end.none')}[/center]`));
    res.autowrap = false;
    this.labels.push(res);
    space(14);
    const home = box.add(new TextButton(t('end.home')));
    home.customMin = { w: 120, h: 16 };
    home.flagsH = SHRINK_CENTER;
    home.onPressed = () => this.onHome();
    space(8);
    const restart = box.add(new TextButton(t('end.restart'), color('RED')));
    restart.customMin = { w: 120, h: 16 };
    restart.flagsH = SHRINK_CENTER;
    restart.onPressed = () => this.onRestart();
    this.buttons = [home, restart];
    for (const bt of this.buttons) pointer.register(bt);
    for (const l of this.labels) l.visibleRatio = 0;
    this.root.layout();
    this.root.layout();
  }

  update(dt: number): void {
    // Labels reveal together over 0.5 s (visible_ratio tween), with typing sounds.
    if (this.t < 0.5) {
      this.t += dt;
      const r = Math.min(this.t / 0.5, 1);
      for (const l of this.labels) {
        l.visibleRatio = r;
        l.redraw();
      }
      ui.playSfx('TYPE', { pitchRange: 0.1, cooldownSteps: 3 });
    }
    for (const b of this.buttons) b.update(dt);
  }
}
