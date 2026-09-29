// ScreenControl.gd positioning helpers, the global Tooltip (MainScene) and the
// skill tree's UpgradeDescription panel (res://Scenes/UI/UpgradeDescription.tscn).
import { Container, NineSliceSprite, Sprite, type Texture } from 'pixi.js';
import { color, content, t, type UpgradeNode } from '../data/content';
import type { Profile } from '../sim/profile';
import { canBuy, isMaxed, levelOf, nextCost } from '../sim/shop';
import { Control, HBox, MarginBox, Root, VBox, SHRINK_CENTER } from './control';
import { tex } from './ctx';
import { numStr } from './format';
import { SpringValue } from './spring';
import { BG, lerpColor, Panel, RichLabel, solid, WHITE } from './widgets';

const SW = 480;
const SH = 270;

/** A floating panel positioned in screen space (ScreenControl.gd). */
export class ScreenPanel {
  readonly root = new Root(SW, SH);
  readonly panel: Panel;
  readonly sx = new SpringValue(1);
  readonly sy = new SpringValue(1);
  readonly rot = new SpringValue(0);
  private attached: { get: () => { x: number; y: number }; off: { x: number; y: number } } | null = null;
  visible = false;

  constructor(style: 'black' | 'solid') {
    this.panel = this.root.add(new Panel(style));
    this.root.view.visible = false;
  }

  /** force_size_update + min-size layout at (x, y). */
  protected size(): { w: number; h: number } {
    this.panel.setRect({ x: 0, y: 0, w: 0, h: 0 });
    const m = this.panel.minSize();
    this.panel.setRect({ x: 0, y: 0, w: m.w, h: m.h });
    const m2 = this.panel.minSize();
    return { w: m2.w, h: m2.h };
  }

  setPos(x: number, y: number): void {
    const { w, h } = { w: this.panel.rect.w, h: this.panel.rect.h };
    x = Math.min(Math.max(x, 0), SW - w);
    y = Math.min(Math.max(y, 0), SH - h);
    this.panel.setRect({ x: Math.round(x), y: Math.round(y), w, h });
  }

  /** center_above_or_below(control): above when it fits, otherwise below. */
  centerAboveOrBelow(target: { x: number; y: number; w: number; h: number }): void {
    const { w, h } = this.size();
    const x = target.x + Math.floor(target.w / 2 - w / 2);
    if (target.y - h >= 0) this.setPos(x, target.y - h);
    else this.setPos(x, target.y + target.h);
  }

  /** attach(control): follow a moving target, keeping the current offset. */
  attach(get: () => { x: number; y: number }): void {
    const p = get();
    this.attached = { get, off: { x: this.panel.rect.x - p.x, y: this.panel.rect.y - p.y } };
  }

  show(): void {
    this.visible = true;
    this.root.view.visible = true;
  }

  hide(): void {
    this.visible = false;
    this.attached = null;
    this.root.view.visible = false;
  }

  update(dt: number): void {
    if (this.attached) {
      const p = this.attached.get();
      this.setPos(p.x + this.attached.off.x, p.y + this.attached.off.y);
    }
    this.sx.update(dt);
    this.sy.update(dt);
    this.rot.update(dt);
    const v = this.panel.view;
    const { w, h } = this.panel.rect;
    v.pivot.set(w / 2, h / 2);
    v.position.set(this.panel.rect.x + w / 2, this.panel.rect.y + h / 2);
    v.scale.set(this.sx.value, this.sy.value);
    v.angle = this.rot.value;
  }
}

/** MainScene Tooltip: black panel, margins 4/1/3/1, label wraps past 300 px. */
export class Tooltip extends ScreenPanel {
  readonly label: RichLabel;
  constructor() {
    super('black');
    const m = this.panel.add(new MarginBox(4, 1, 3, 1));
    this.label = m.add(new RichLabel(''));
    this.label.autowrap = false;
  }

  setText(markup: string): void {
    this.label.autowrap = false;
    this.label.customMin = { w: 0, h: 0 };
    this.label.markup = markup;
    this.label.redraw();
    // MaxSizeRichTextLabel: once wider than 300 px, fix the width and wrap.
    if (this.label.minSize().w > 300) {
      this.label.customMin = { w: 300, h: 0 };
      this.label.autowrap = true;
    }
    this.show();
    this.sx.pull(-0.1, 1000, 18);
    this.sy.pull(0.3, 1000, 18);
    this.rot.pull(7, 600, 14).range(-100, 100);
  }
}

/** The skill tree's node tooltip. */
export class UpgradeDescription extends ScreenPanel {
  private icon: UpgradeIconView;
  private name: RichLabel;
  private desc: RichLabel;
  private level: RichLabel;
  private costPanel: Panel;
  private cost: RichLabel;
  node: UpgradeNode | null = null;
  readonly levelS = { sx: new SpringValue(1), sy: new SpringValue(1), rot: new SpringValue(0) };
  readonly costS = { sx: new SpringValue(1), sy: new SpringValue(1), rot: new SpringValue(0) };

  constructor(private profile: () => Profile) {
    super('black');
    this.panel.customMin = { w: 140, h: 0 };
    const m = this.panel.add(new MarginBox(2, 2, 2, 2));
    const v = m.add(new VBox(1));
    const header = v.add(new HBox());
    header.alignment = 'center';
    header.flagsV = 0;
    this.icon = header.add(new UpgradeIconView());
    this.icon.outline = 0xffffff;
    this.name = header.add(new RichLabel(''));
    this.name.autowrap = false;
    this.name.flagsV = SHRINK_CENTER;
    v.add(new Separator(0));
    this.desc = v.add(new RichLabel(''));
    v.add(new Separator(1));
    this.level = v.add(new RichLabel(''));
    this.costPanel = v.add(new Panel('solid'));
    this.cost = this.costPanel.add(new RichLabel(''));
    this.cost.autowrap = false;
    this.cost.shadow = { color: BG, x: 0, y: 1, outline: 0 };
  }

  load(n: UpgradeNode): void {
    this.node = n;
    this.icon.texture = tex(n.icon);
    this.refresh();
  }

  refresh(): void {
    const n = this.node;
    if (!n) return;
    const p = this.profile();
    this.name.markup = n.name;
    this.desc.markup = `[center]${n.description}[/center]`;
    this.level.markup = `[center]${t('upgrade.level', levelOf(p, n.id), n.maxLevel)}[/center]`;
    this.updateCost();
  }

  updateCost(): void {
    const n = this.node;
    if (!n) return;
    const p = this.profile();
    let markup: string;
    if (isMaxed(p, n)) {
      markup = `[center]${t('upgrade.max')}[/center]`;
      this.costPanel.selfModulate = lerpColor(color('YELLOW'), BG, 0.4);
    } else {
      const isFloat = n.currency === 'netcoin';
      const have = numStr(p[n.currency], isFloat);
      const cost = numStr(nextCost(p, n), isFloat);
      markup = `[center]${currencyStr(n.currency, `${have} / ${cost}`)}[/center]`;
      this.costPanel.selfModulate = lerpColor(canBuy(p, n) ? color('GREEN') : color('RED'), BG, 0.7);
    }
    if (markup !== this.cost.markup) {
      this.cost.markup = markup;
      this.size();
    } else this.costPanel.redraw();
  }

  /** show_upgrade_node: position above/below the node, attach to it, spring in. */
  showFor(n: UpgradeNode, rect: () => { x: number; y: number; w: number; h: number }): void {
    this.load(n);
    this.show();
    const r = rect();
    this.centerAboveOrBelow(r);
    this.attach(() => {
      const q = rect();
      return { x: q.x, y: q.y };
    });
    this.sx.pull(-0.3, 1000, 18).range(0.5, 1.5);
    this.sy.pull(0.5, 1000, 18).range(0.5, 1.5);
    this.rot.pull(8, 600, 14).range(-10, 10);
  }

  springLevelUp(): void {
    this.levelS.sx.pull(-0.3, 250, 12);
    this.levelS.sy.pull(0.6, 250, 12);
    this.levelS.rot.pull(6, 600, 14).range(-100, 100);
    this.costS.sx.pull(-0.3, 250, 12);
    this.costS.sy.pull(0.6, 250, 12);
    this.costS.rot.pull(-6, 600, 14).range(-100, 100);
  }

  update(dt: number): void {
    if (this.visible) this.updateCost();
    super.update(dt);
    for (const [s, l] of [
      [this.levelS, this.level],
      [this.costS, this.cost],
    ] as const) {
      s.sx.update(dt);
      s.sy.update(dt);
      s.rot.update(dt);
      const v = l.view;
      v.pivot.set(l.rect.w / 2, l.rect.h / 2);
      v.position.set(l.rect.x + l.rect.w / 2, l.rect.y + l.rect.h / 2);
      v.scale.set(s.sx.value, s.sy.value);
      v.angle = s.rot.value;
    }
  }
}

/** ResourceType.resource_str: icon, word joiners, coloured amount. */
export function currencyStr(c: string, text: string): string {
  const hex = content.palette.colors[content.palette.currency[c]];
  return `[icon:${c}] [color=${hex}]${text}[/color]`;
}

/** HSeparator with the tooltip's StyleBoxLine (grey, grows 1 px past each side). */
class Separator extends Control {
  constructor(sep: number) {
    super();
    this.customMin = { w: 3, h: sep };
  }
  redraw(): void {
    this.gfx.removeChildren();
    // HSeparator draws at (h - 1) / 2; StyleBoxLine converts to Rect2i (truncates toward zero).
    const y = Math.trunc((this.rect.h - 1) / 2);
    this.gfx.addChild(solid(-1, y, this.rect.w + 2, 1, 0x707070));
  }
}

/** res://Scenes/UI/UpgradeIcon.tscn: 16x16 frame (SkillNode.png, 1 px margins) over a BG square, icon inset 1 px. */
export class UpgradeIconView extends Control {
  outline = WHITE;
  private _tex: Texture | null = null;
  readonly inner = new Container();

  constructor() {
    super();
    this.customMin = { w: 16, h: 16 };
    this.gfx.addChild(this.inner);
  }

  set texture(t: Texture) {
    this._tex = t;
    this.redraw();
  }

  redraw(): void {
    const { w, h } = this.rect;
    this.inner.removeChildren();
    this.inner.addChild(solid(0, 0, w, h, BG));
    if (this._tex) {
      const s = new Sprite(this._tex);
      // stretch_mode KEEP_CENTERED inside the 1 px inset.
      s.position.set(1 + Math.floor((w - 2 - this._tex.width) / 2), 1 + Math.floor((h - 2 - this._tex.height) / 2));
      this.inner.addChild(s);
    }
    const frame = new NineSliceSprite({ texture: tex('ui/skill_node'), leftWidth: 1, topHeight: 1, rightWidth: 1, bottomHeight: 1, width: w, height: h });
    frame.tint = this.outline;
    this.inner.addChild(frame);
  }
}

