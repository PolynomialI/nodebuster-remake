// The shop's other tabs: Milestones, Crypto Mine and Lab
// (res://GameScenes/ShopScene.tscn, Scripts/Shop/*Page.gd, Scenes/Shop/MilestoneEntry.tscn).
import { Container, Rectangle, Texture } from 'pixi.js';
import type { Input } from '../core/input';
import { color, content, t } from '../data/content';
import type { Profile } from '../sim/profile';
import { claimMilestone, deposit, labDeposit, milestoneProgress, mineMaxed, mineReturns, mineSecondsLeft, mineSpeed, upgradeMine, type MilestoneDef } from '../sim/meta';
import { Control, Grid, HBox, MarginBox, Root, VBox, EXPAND, FILL, SHRINK_CENTER, SHRINK_END } from '../ui/control';
import { tex } from '../ui/ctx';
import { numStr } from '../ui/format';
import type { Pointer } from '../ui/pointer';
import { ScrollBox } from '../ui/scroll';
import { SpringValue } from '../ui/spring';
import { currencyStr } from '../ui/tooltip';
import { Bar, BG, Label, lerpColor, Panel, RichLabel, TextButton, TextureRect, WHITE, type Interactive } from '../ui/widgets';

const hexA = (c: number) => `#${c.toString(16).padStart(6, '0')}ff`;
const colored = (s: string, c: number) => `[color=${hexA(c)}]${s}[/color]`;

export interface PageCtx {
  profile: () => Profile;
  pointer: Pointer;
  sfx: (name: string, opts?: { pitchRange?: number; pitchOffset?: number; cooldownSteps?: number }) => void;
  squash: (c: 'bits' | 'nodes' | 'netcoin' | 'processors') => void;
  tooltip: (markup: string, target: Control) => void;
  hideTooltip: () => void;
  onChanged: () => void;
}

// ---- Milestones ---------------------------------------------------------------------

class MilestoneEntry extends Panel {
  readonly claim: TextButton;
  private unlock: RichLabel;
  constructor(readonly m: MilestoneDef) {
    super('box');
    const h = this.add(new HBox());
    const iconPanel = h.add(new Panel('box'));
    iconPanel.flagsV = SHRINK_CENTER;
    iconPanel.add(new TextureRect(tex(m.icon)));
    const v = h.add(new VBox(0));
    v.flagsH = EXPAND | FILL;
    v.add(new RichLabel(m.name));
    this.unlock = v.add(new RichLabel(''));
    v.add(new RichLabel(colored(`REWARD: ${currencyStr(m.reward.currency, m.rewardText)}`, color('YELLOW'))));
    this.claim = h.add(new TextButton(t('milestone.claim'), 0x1d8c38));
    this.claim.customMin = { w: 50, h: 20 };
    this.claim.flagsH = SHRINK_END;
    this.claim.flagsV = SHRINK_CENTER;
  }

  load(p: Profile): void {
    const prog = Math.min(Math.max(milestoneProgress(p, this.m), 0), 1);
    this.unlock.markup = `${this.m.text} ${colored(`(${(prog * 100).toFixed(1)}%)`, color('GREEN'))}`;
    if (p.milestones[this.m.id]) this.setClaimed();
    else this.claim.setEnabled(prog >= 1);
  }

  setClaimed(): void {
    this.view.tint = lerpColor(0xffffff, BG, 0.7);
    this.claim.setEnabled(false);
    this.claim.setText(t('milestone.claimed'));
  }

  claimable(): boolean {
    return !this.claim.disabled;
  }
}

export class MilestonesPage {
  readonly root = new Root(480, 270);
  readonly view: Container;
  private entries: MilestoneEntry[] = [];
  readonly scroll: ScrollBox;

  constructor(ctx: PageCtx) {
    this.view = this.root.view;
    const list = new VBox();
    list.flagsH = EXPAND | FILL;
    this.scroll = this.root.add(new ScrollBox(list));
    this.scroll.place(16, 35, 368, 252);
    for (const m of content.milestones.milestones) {
      const e = list.add(new MilestoneEntry(m));
      e.load(ctx.profile());
      e.claim.onPressed = () => {
        if (claimMilestone(ctx.profile(), m)) {
          e.setClaimed();
          ctx.onChanged();
        }
      };
      this.entries.push(e);
      ctx.pointer.register(e.claim);
    }
    this.root.layout();
    this.root.layout();
  }

  anyClaimable(): boolean {
    return this.entries.some((e) => e.claimable());
  }

  update(dt: number, input: Input, active: boolean): void {
    if (active) this.scroll.handle(input);
    for (const e of this.entries) e.claim.update(dt);
  }
}

// ---- springs on controls ---------------------------------------------------------------

/** Springer.squash / Springer.rotate / Jumper.jump applied to a Control around a pivot. */
class Sway {
  readonly sx = new SpringValue(1);
  readonly sy = new SpringValue(1);
  readonly rot = new SpringValue(0);
  private jumpT = -1;
  private jumpForce = 0;
  private jumpDur = 0;

  constructor(private c: Control) {}

  setPivot(x: number, y: number): void {
    this.c.pivot = { x, y };
  }

  squash(x: number, y: number): void {
    this.sx.pull(x, 250, 12);
    this.sy.pull(y, 250, 12);
  }

  rotate(deg: number): void {
    this.rot.pull(deg, 600, 14).range(-100, 100);
  }

  jump(force: number, duration: number): void {
    this.jumpT = 0;
    this.jumpForce = force;
    this.jumpDur = duration;
  }

  update(dt: number): void {
    this.sx.update(dt);
    this.sy.update(dt);
    this.rot.update(dt);
    let jy = 0;
    if (this.jumpT >= 0) {
      this.jumpT += dt;
      const half = this.jumpDur / 2;
      jy = this.jumpT < half ? -this.jumpForce * (this.jumpT / half) : this.jumpT < this.jumpDur ? -this.jumpForce * (1 - (this.jumpT - half) / half) : 0;
      if (this.jumpT >= this.jumpDur) this.jumpT = -1;
    }
    const v = this.c.view;
    const { x, y } = this.c.pivot;
    v.pivot.set(x, y);
    v.position.set(this.c.rect.x + x, this.c.rect.y + y + jy);
    v.scale.set(this.sx.value, this.sy.value);
    v.angle = this.rot.value;
  }
}

/** A label with a hover tooltip that squashes (CryptoMinePage._on_label_mouse_entered). */
class HoverTip implements Interactive {
  readonly sway: Sway;
  constructor(
    readonly c: Control,
    private text: () => string,
    private ctx: PageCtx,
  ) {
    this.sway = new Sway(c);
  }
  contains(gx: number, gy: number): boolean {
    return this.c.contains(gx, gy);
  }
  onEnter(): void {
    this.sway.setPivot(this.c.rect.w / 2, this.c.rect.h / 2);
    this.ctx.tooltip(this.text(), this.c);
    this.ctx.sfx('BUTTON_HOVER', { pitchRange: 0.2 });
    this.sway.squash(0.4, 0.2);
  }
  onExit(): void {
    this.ctx.hideTooltip();
  }
  onDown(): void {}
  onUp(): void {}
  onClick(): void {}
}

// ---- StatEntry --------------------------------------------------------------------

/** res://Scenes/Shop/StatEntry.tscn: "[right]name:[/right]" and a value, both expanding. */
class StatEntry extends HBox {
  readonly label: RichLabel;
  readonly value: RichLabel;
  desc = '';
  readonly hover: HoverTip;
  private valueSway: Sway;

  constructor(ctx: PageCtx) {
    super();
    this.label = this.add(new RichLabel(''));
    this.label.autowrap = false;
    this.label.flagsH = EXPAND | FILL;
    this.value = this.add(new RichLabel(''));
    this.value.autowrap = false;
    this.value.flagsH = EXPAND | FILL;
    this.hover = new HoverTip(this, () => this.desc, ctx);
    this.valueSway = new Sway(this.value);
  }

  setup(stat: string, value: string): void {
    this.label.setMarkup(`[right]${stat}:[/right]`);
    this.value.setMarkup(value);
  }

  /** squash_value(): pivot on the text's size (RTLSizer), squash by 9 px of its width, twist 16. */
  squashValue(): void {
    const m = this.value.intrinsicMin();
    this.valueSway.setPivot(m.w / 2, m.h / 2);
    const mag = 9 / Math.max(1, m.w);
    this.valueSway.squash(-mag, mag);
    this.valueSway.rotate(16);
  }

  tick(dt: number): void {
    this.hover.sway.update(dt);
    this.valueSway.update(dt);
  }
}

// ---- Crypto Mine ---------------------------------------------------------------------

/** res://Scripts/Shop/CryptoMinePage.gd */
export class CryptoMinePage {
  readonly root = new Root(480, 270);
  readonly view: Container;
  private deposited: StatEntry;
  private returns: StatEntry;
  private time: StatEntry;
  private deposits: TextButton[] = [];
  private speed: RichLabel;
  private speedTip: HoverTip;
  private rateTip: HoverTip;
  private upgrade: TextButton;
  private help: TextButton;

  constructor(private ctx: PageCtx) {
    this.view = this.root.view;
    this.deposited = new StatEntry(ctx);
    this.returns = new StatEntry(ctx);
    this.time = new StatEntry(ctx);
    const name = (c: string) => `[icon:${c}] [color=${content.palette.colors[content.palette.currency[c]]}]${t(`resource.${c}`)}[/color]`;
    const panel = this.root.add(new Panel('box'));
    panel.selfModulate = WHITE;
    panel.place(115, 48, 304, 220);
    const m = panel.add(new MarginBox(0, 4, 0, 0));
    const v = m.add(new VBox(2));
    const rate = v.add(new RichLabel(`[center]${t('mine.rate', currencyStr('bits', '1'), currencyStr('netcoin', '0.00001'))}[/center]`));
    this.rateTip = new HoverTip(rate, () => t('mine.rateTooltip', name('bits'), name('netcoin')), ctx);
    const sp = (h: number) => {
      const c = v.add(new Control());
      c.customMin = { w: 0, h };
    };
    sp(8);
    v.add(this.deposited);
    v.add(this.returns);
    v.add(this.time);
    sp(14);
    const tag = v.add(new Label(t('mine.deposit')));
    tag.hAlign = 'center';
    const grid = v.add(new Grid(3));
    grid.hSep = grid.vSep = 1;
    for (const d of content.cryptomine.deposits) {
      const b = grid.add(new TextButton(`[icon:bits] ${d.label}`, 0x1d8c38));
      b.customMin = { w: 46, h: 20 };
      b.flagsH = EXPAND | FILL;
      b.onPressed = () => {
        if (!deposit(ctx.profile(), d.amount)) return;
        ctx.squash('bits');
        this.refresh();
        this.deposited.squashValue();
        ctx.sfx('PLINK');
      };
      this.deposits.push(b);
    }
    sp(14);
    this.speed = v.add(new RichLabel(''));
    this.speedTip = new HoverTip(this.speed, () => t('mine.speedTooltip'), ctx);
    this.upgrade = v.add(new TextButton(t('mine.upgrade', currencyStr('processors', '1')), 0xd33dc9));
    this.upgrade.customMin = { w: 0, h: 18 };
    this.upgrade.onPressed = () => {
      if (!upgradeMine(ctx.profile())) return;
      ctx.squash('processors');
      this.refresh();
      const s = this.speedTip.sway;
      s.setPivot(this.speed.rect.w / 2, this.speed.rect.h / 2);
      s.squash(-0.1, 0.1);
      s.rotate(4);
      s.jump(4, 0.1);
    };
    this.help = this.root.add(new TextButton('?', BG));
    this.help.customMin = { w: 16, h: 16 };
    this.help.place(309, 48, 325, 64);
    this.help.onHover = () => ctx.tooltip(t('mine.help', name('bits'), name('netcoin'), name('processors')), this.help);
    this.help.onUnhover = () => ctx.hideTooltip();
    this.deposited.desc = t('mine.depositedTooltip', name('bits'));
    this.returns.desc = t('mine.returnsTooltip', name('netcoin'), name('bits'));
    this.time.desc = t('mine.timeTooltip', name('bits'), name('netcoin'));
    // Hover targets, bottom to top (buttons sit above the labels).
    for (const h of [this.rateTip, this.deposited.hover, this.returns.hover, this.time.hover, this.speedTip]) ctx.pointer.register(h);
    for (const b of [...this.deposits, this.upgrade, this.help]) ctx.pointer.register(b);
    this.refresh();
    this.root.layout();
    this.root.layout();
  }

  /** CryptoMinePage._process (labels) plus the bits/processors change handlers (buttons). */
  refresh(): void {
    const p = this.ctx.profile();
    this.deposited.setup(t('mine.deposited'), currencyStr('bits', String(Math.ceil(p.crypto_mine.curr_bits))));
    this.returns.setup(t('mine.returns'), currencyStr('netcoin', numStr(mineReturns(p), true)));
    const left = mineSecondsLeft(p);
    const mm = String(Math.floor(left / 60)).padStart(2, '0');
    const ss = String(Math.floor(left % 60)).padStart(2, '0');
    this.time.setup(t('mine.time'), colored(`${mm}:${ss}`, color('YELLOW')));
    this.speed.setMarkup(`[center]${t('mine.speed', currencyStr('bits', String(mineSpeed(p))))}[/center]`);
    content.cryptomine.deposits.forEach((d, i) => this.deposits[i].setEnabled(p.bits >= d.amount));
    this.upgrade.setEnabled(!mineMaxed(p) && p.processors >= content.cryptomine.upgradeCost.amount);
  }

  update(dt: number, active: boolean): void {
    if (active) this.refresh();
    for (const e of [this.deposited, this.returns, this.time]) e.tick(dt);
    this.rateTip.sway.update(dt);
    this.speedTip.sway.update(dt);
    for (const b of [...this.deposits, this.upgrade, this.help]) b.update(dt);
  }
}

// ---- Lab ------------------------------------------------------------------------------

export class LabPage {
  readonly root = new Root(480, 270);
  readonly view: Container;
  private bar: Bar;
  private progressText: RichLabel;
  private depositBtn: TextButton;
  private virusBox: VBox;
  private godvirus: TextureRect;
  private godTex: Texture;
  private deploy: TextButton;
  private deployed: Label;
  private header: RichLabel;
  private tag: RichLabel;
  private help: TextButton;
  private shown = 0;
  private tween: { from: number; to: number; t: number } | null = null;
  private elapsed = 0;
  onDeploy: () => void = () => {};

  constructor(private ctx: PageCtx) {
    this.view = this.root.view;
    const p = ctx.profile();
    const panel = this.root.add(new Panel('box'));
    panel.selfModulate = WHITE;
    panel.place(115, 48, 304, 220);
    const m = panel.add(new MarginBox(0, 4, 0, 0));
    const v = m.add(new VBox(2));
    this.header = v.add(new RichLabel(`[center][rainbow sat=0.5 freq=0.2]${t('lab.header')}[/rainbow][/center]`));
    const sp = (h: number) => {
      const c = v.add(new Control());
      c.customMin = { w: 0, h };
      return c;
    };
    sp(10);
    this.tag = v.add(new RichLabel(`[center]${t('lab.progress')}[/center]`));
    this.bar = v.add(new Bar(0x4ff264));
    this.bar.customMin = { w: 170, h: 8 };
    this.bar.flagsH = SHRINK_CENTER;
    this.progressText = v.add(new RichLabel(''));
    sp(18);
    this.depositBtn = v.add(new TextButton('', color('RED')));
    this.depositBtn.customMin = { w: 0, h: 16 };
    this.depositBtn.onPressed = () => {
      const q = ctx.profile();
      labDeposit(q);
      ctx.squash('netcoin');
      this.tween = { from: this.shown, to: q.lab_research_progress, t: 0 };
    };
    ctx.pointer.register(this.depositBtn);
    this.virusBox = v.add(new VBox());
    this.virusBox.add(new RichLabel(`[center]${t('lab.ready')}[/center]`, color('RED')));
    const g = tex(content.lab.godvirus.sprite);
    const fs = content.lab.godvirus.frameSize;
    this.godTex = new Texture({ source: g.source, frame: new Rectangle(0, 0, fs[0], fs[1]) });
    this.godvirus = this.virusBox.add(new TextureRect(this.godTex));
    this.godvirus.flagsH = SHRINK_CENTER;
    this.deploy = this.virusBox.add(new TextButton(t('lab.deploy'), color('RED')));
    this.deploy.customMin = { w: 0, h: 16 };
    this.deploy.onPressed = () => this.onDeploy();
    ctx.pointer.register(this.deploy);
    this.deployed = v.add(new Label(t('lab.deployed')));
    this.deployed.hAlign = 'center';
    this.help = this.root.add(new TextButton('?', BG));
    this.help.customMin = { w: 16, h: 16 };
    this.help.place(309, 48, 325, 64);
    const netName = `[icon:netcoin] [color=${content.palette.colors.GREEN}]${t('resource.netcoin')}[/color]`;
    this.help.onHover = () => ctx.tooltip(t('lab.help', netName), this.help);
    this.help.onUnhover = () => ctx.hideTooltip();
    ctx.pointer.register(this.help);
    this.shown = p.lab_research_progress;
    if (p.virus_deployed) {
      this.deployed.setVisible(true);
      for (const c of [this.virusBox, this.depositBtn, this.bar, this.progressText, this.tag] as Control[]) c.setVisible(false);
    } else this.deployed.setVisible(false);
    this.refresh();
    this.root.layout();
    this.root.layout();
  }

  private refresh(): void {
    const p = this.ctx.profile();
    if (p.virus_deployed) return;
    const goal = content.lab.goalNetcoin;
    this.bar.set(this.shown, goal);
    this.progressText.setMarkup(`[center]${currencyStr('netcoin', numStr(this.shown, true))}\n/ ${currencyStr('netcoin', numStr(goal, true))}[/center]`);
    const ready = this.shown >= goal;
    if (this.virusBox.visible !== ready || this.depositBtn.visible === ready) {
      this.virusBox.setVisible(ready);
      this.depositBtn.setVisible(!ready);
      this.root.layout();
    }
    this.depositBtn.setText(t('lab.deposit', currencyStr('netcoin', numStr(p.netcoin, true))));
    this.depositBtn.setEnabled(p.netcoin !== 0);
  }

  update(dt: number, active: boolean): void {
    const p = this.ctx.profile();
    if (active && !p.virus_deployed) {
      if (this.tween) {
        const tw = this.tween;
        tw.t = Math.min(tw.t + dt / content.lab.depositTweenSec, 1);
        this.shown = tw.from + (tw.to - tw.from) * (1 - (1 - tw.t) * (1 - tw.t));
        this.ctx.sfx('TICK', { pitchRange: 0, pitchOffset: tw.t * content.lab.depositTweenSec, cooldownSteps: 2 });
        if (tw.t >= 1) this.tween = null;
      }
      this.refresh();
      // Godvirus: 5 frames of 32 px at 10 fps (snappedi(elapsed * 320, 32) % 160).
      this.elapsed += dt;
      const gv = content.lab.godvirus;
      const x = (Math.round((this.elapsed * gv.frameSize[0] * gv.fps) / gv.frameSize[0]) * gv.frameSize[0]) % (gv.frameSize[0] * gv.frames);
      if (this.godTex.frame.x !== x) {
        this.godTex.frame.x = x;
        this.godTex.updateUvs();
      }
    }
    this.header.tick(dt);
    for (const b of [this.depositBtn, this.deploy, this.help]) b.update(dt);
  }
}

