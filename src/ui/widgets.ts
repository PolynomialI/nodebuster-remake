// Widgets matching the original's scenes: Label, RichTextLabel (fit_content),
// ColorRect, TextureRect, PanelContainer styles from DefaultTheme.tres,
// TextureProgressBar (nine-patch bars), NinePatchRect and MyButton/TextButton.
import { Container, NineSliceSprite, Sprite, Texture, type Texture as Tex } from 'pixi.js';
import { color as pal } from '../data/content';
import { PixelFont, textPad } from '../render/pixelfont';
import { Control, MarginBox, type Rect } from './control';
import { tex, ui } from './ctx';
import { addShadow, drawLines, layout, LINE_HEIGHT, parse, updateRainbow, type HAlign, type Shadow } from './richtext';
import { SpringValue } from './spring';

export const WHITE = 0xdcdcdc;
export const BG = 0x1f1f1f;

export function solid(x: number, y: number, w: number, h: number, color: number, alpha = 1): Sprite {
  const s = new Sprite(Texture.WHITE);
  s.position.set(x, y);
  s.width = w;
  s.height = h;
  s.tint = color;
  s.alpha = alpha;
  return s;
}

export function lerpColor(a: number, b: number, t: number): number {
  const ch = (c: number, s: number) => (c >> s) & 255;
  const mix = (s: number) => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * t);
  return (mix(16) << 16) | (mix(8) << 8) | mix(0);
}

// ---- text ------------------------------------------------------------------------

export class Label extends Control {
  hAlign: HAlign = 'left';
  vAlign: 'top' | 'center' | 'bottom' = 'top';
  shadow: Shadow | null = null;
  visibleChars = -1;

  constructor(
    public text = '',
    public color = WHITE,
    public size = 11,
  ) {
    super();
  }

  private lines(): string[] {
    const t = this.visibleChars >= 0 ? [...this.text].slice(0, this.visibleChars).join('') : this.text;
    return t.split('\n');
  }

  intrinsicMin(): { w: number; h: number } {
    const ls = this.text.split('\n');
    return { w: Math.max(...ls.map((l) => ui.font.measure(l, this.size))), h: ls.length * PixelFont.metrics(this.size).lineHeight };
  }

  setText(t: string): void {
    if (t === this.text) return;
    this.text = t;
    this.redraw();
  }

  redraw(): void {
    this.gfx.removeChildren();
    const lh = PixelFont.metrics(this.size).lineHeight;
    const all = this.text.split('\n');
    const total = all.length * lh;
    let y = Math.floor(this.vAlign === 'top' ? 0 : this.vAlign === 'center' ? (this.rect.h - total) / 2 : this.rect.h - total);
    for (const line of this.lines()) {
      // Alignment uses the full line (Godot lays out all text, then hides characters).
      const full = all.shift() ?? line;
      const w = ui.font.measure(full, this.size);
      // Label: int(size.width - line_width) / 2 (integer division).
      const x = Math.floor(this.hAlign === 'left' ? 0 : this.hAlign === 'center' ? (this.rect.w - w) / 2 : this.rect.w - w);
      if (line) {
        const t = ui.font.texture(line, this.size);
        if (this.shadow) addShadow(this.gfx, t, x, y - textPad(t), this.shadow);
        const s = new Sprite(t);
        s.tint = this.color;
        s.position.set(x, y - textPad(t));
        this.gfx.addChild(s);
      }
      y += lh;
    }
  }
}

/** RichTextLabel with fit_content = true and BBCode on. */
export class RichLabel extends Control {
  autowrap = true;
  shadow: Shadow | null = null;
  visibleRatio = 1;
  private rainbow: ReturnType<typeof drawLines> = [];
  /** ItemFX.elapsed_time: advances only while the label is visible in the tree. */
  private fxTime = 0;

  constructor(
    public markup = '',
    public color = WHITE,
  ) {
    super();
  }

  private wrapWidth(): number {
    return this.autowrap && this.rect.w > 0 ? this.rect.w : Infinity;
  }

  intrinsicMin(): { w: number; h: number } {
    const lines = layout(parse(this.markup), this.wrapWidth(), ui.font);
    return { w: this.autowrap ? 0 : Math.max(0, ...lines.map((l) => l.width)), h: lines.length * LINE_HEIGHT };
  }

  setMarkup(m: string): void {
    if (m === this.markup) return;
    this.markup = m;
    this.relayoutUp();
  }

  /** Content changed size: lay out the nearest anchored ancestor again. */
  relayoutUp(): void {
    let c: Control = this;
    while (c.parent && c.inContainer) c = c.parent;
    if (c.parent) c.layoutAnchored({ x: 0, y: 0, w: c.parent.rect.w, h: c.parent.rect.h });
    else c.setRect(c.rect);
  }

  redraw(): void {
    let runs = parse(this.markup);
    if (this.visibleRatio < 1) {
      // visible_ratio reveals characters in order.
      const total = runs.reduce((n, r) => n + (r.kind === 'text' ? [...r.text!].length : 1), 0);
      let left = Math.floor(total * this.visibleRatio);
      runs = runs.flatMap((r) => {
        if (left <= 0) return [];
        const n = r.kind === 'text' ? [...r.text!].length : 1;
        if (n <= left) {
          left -= n;
          return [r];
        }
        const part = { ...r, text: [...r.text!].slice(0, left).join('') };
        left = 0;
        return [part];
      });
    }
    const lines = layout(runs, this.wrapWidth(), ui.font);
    this.rainbow = drawLines(this.gfx, lines, this.rect.w, this.color, this.shadow);
    if (this.rainbow.length) updateRainbow(this.rainbow, this.fxTime);
  }

  /** NOTIFICATION_INTERNAL_PROCESS: text effects advance while visible in the tree. */
  tick(dt: number): void {
    if (!this.rainbow.length || !this.isVisibleInTree()) return;
    this.fxTime += dt;
    updateRainbow(this.rainbow, this.fxTime);
  }
}

// ---- rects, textures, panels --------------------------------------------------------

export class ColorRect extends Control {
  constructor(
    public color: number,
    public alpha = 1,
  ) {
    super();
  }
  redraw(): void {
    this.gfx.removeChildren();
    this.gfx.addChild(solid(0, 0, this.rect.w, this.rect.h, this.color, this.alpha));
  }
}

export class TextureRect extends Control {
  sprite: Sprite;
  constructor(
    public texture: Tex,
    public mode: 'keep' | 'keep_centered' = 'keep',
  ) {
    super();
    this.sprite = new Sprite(texture);
    this.gfx.addChild(this.sprite);
  }
  intrinsicMin(): { w: number; h: number } {
    return { w: this.texture.width, h: this.texture.height };
  }
  redraw(): void {
    this.sprite.texture = this.texture;
    if (this.mode === 'keep_centered') this.sprite.position.set(Math.floor((this.rect.w - this.texture.width) / 2), Math.floor((this.rect.h - this.texture.height) / 2));
    else this.sprite.position.set(0, 0);
  }
}

export type PanelStyle = 'box' | 'filled' | 'black' | 'outlined' | 'solid';

const PANEL: Record<PanelStyle, { tex?: string; margin?: number; content: number; flat?: number }> = {
  box: { tex: 'ui/box', margin: 1, content: 1 },
  filled: { tex: 'ui/filled_panel', margin: 1, content: 1 },
  outlined: { tex: 'ui/panel_outline', margin: 3, content: 1 },
  black: { flat: 0x0f0f0f, content: 0 },
  solid: { flat: 0xffffff, content: 0 },
};

/** PanelContainer with one of the theme's panel styles (self_modulate tints the style only). */
export class Panel extends MarginBox {
  selfModulate = 0xffffff;
  selfAlpha = 1;

  constructor(readonly style: PanelStyle) {
    const c = PANEL[style].content;
    super(c, c, c, c);
    this.truncate = false;
  }

  redraw(): void {
    this.gfx.removeChildren();
    const s = PANEL[this.style];
    if (s.tex) {
      const m = s.margin!;
      const n = new NineSliceSprite({ texture: tex(s.tex), leftWidth: m, topHeight: m, rightWidth: m, bottomHeight: m, width: this.rect.w, height: this.rect.h });
      n.tint = this.selfModulate;
      n.alpha = this.selfAlpha;
      this.gfx.addChild(n);
    } else {
      this.gfx.addChild(solid(0, 0, this.rect.w, this.rect.h, mulColor(s.flat!, this.selfModulate), this.selfAlpha));
    }
  }
}

export function mulColor(a: number, b: number): number {
  const ch = (c: number, s: number) => ((c >> s) & 255) / 255;
  const m = (s: number) => Math.round(ch(a, s) * ch(b, s) * 255);
  return (m(16) << 16) | (m(8) << 8) | m(0);
}

// ---- TextureProgressBar (nine-patch bar) ----------------------------------------------

/** res://Scenes/UI/TextureProgressBar.tscn: outline (WHITE), fill (colour), inner ring (BG), BG behind. */
export class Bar extends Control {
  value = 1;
  max = 1;

  constructor(public fill: number) {
    super();
  }

  redraw(): void {
    const { w, h } = this.rect;
    const g = this.gfx;
    g.removeChildren();
    g.addChild(solid(0, 0, w, h, BG));
    const nine = (id: string, tint: number) => {
      const n = new NineSliceSprite({ texture: tex(id), leftWidth: 2, topHeight: 2, rightWidth: 2, bottomHeight: 2, width: w, height: h });
      n.tint = tint;
      return n;
    };
    g.addChild(nine('ui/bar_outline', WHITE));
    const ratio = this.max > 0 ? Math.min(Math.max(this.value / this.max, 0), 1) : 0;
    const filled = w * ratio;
    const right = Math.min(filled, w - 2);
    if (right > 2) g.addChild(solid(2, 2, right - 2, h - 4, this.fill));
    g.addChild(nine('ui/bar_inner', BG));
  }

  set(value: number, max: number): void {
    const v = Math.min(Math.max(value, 0), max);
    if (v === this.value && max === this.max) return;
    this.value = v;
    this.max = max;
    this.redraw();
  }
}

// ---- Buttons ---------------------------------------------------------------------

export interface Interactive {
  contains(gx: number, gy: number): boolean;
  onEnter(): void;
  onExit(): void;
  onDown(): void;
  onUp(): void;
  onClick(): void;
}

/** MyButton + TextButton: outline, inline and main rects with a centred shadowed label. */
export class TextButton extends Control implements Interactive {
  disabled = false;
  hovered = false;
  down = false;
  readonly visuals = new Container();
  readonly label: RichLabel;
  readonly rot = new SpringValue(0);
  readonly sx = new SpringValue(1);
  readonly sy = new SpringValue(1);
  jumpT = -1;
  onPressed: (() => void) | null = null;
  onHover: (() => void) | null = null;
  onUnhover: (() => void) | null = null;
  outlineColor = WHITE;
  inlineColor = BG;
  /** The main_color setter writes self_modulate directly: re-set every frame, it hides hover/disabled tints. */
  fixedMain = false;

  constructor(
    text: string,
    public mainColor = pal('DARK_BLUE'),
  ) {
    super();
    this.gfx.addChild(this.visuals);
    this.label = new RichLabel(`[center]${text}[/center]`);
    this.label.shadow = { color: BG, x: 0, y: 1, outline: 0 };
  }

  setText(text: string): void {
    this.label.markup = `[center]${text}[/center]`;
    this.redraw();
  }

  setEnabled(v: boolean): void {
    this.disabled = !v;
    this.redraw();
  }

  mainNow(): number {
    const PURE = 0xffffff;
    if (this.fixedMain) return this.mainColor;
    if (this.disabled) return this.hovered ? lerpColor(0x6c6c6c, PURE, 0.2) : 0x6c6c6c;
    if (this.down) return lerpColor(this.mainColor, PURE, this.hovered ? 0.3 : 0.2);
    return this.hovered ? lerpColor(this.mainColor, PURE, 0.2) : this.mainColor;
  }

  redraw(): void {
    const { w, h } = this.rect;
    this.visuals.removeChildren();
    this.visuals.pivot.set(w / 2, h / 2);
    this.visuals.position.set(w / 2, h / 2);
    this.visuals.addChild(solid(0, 0, w, h, this.outlineColor), solid(1, 1, w - 2, h - 2, this.inlineColor), solid(2, 2, w - 4, h - 4, this.mainNow()));
    // TextButton: label spans the width (made odd to avoid half-pixel centring) and is centred vertically.
    const lw = Math.floor(w) % 2 === 1 ? w : w + 1;
    const lm = this.label.minSize().h || LINE_HEIGHT;
    const top = h / 2 + (Math.floor(h) % 2 === 1 ? 1 : 0);
    const size = Math.floor(h) % 2 === 1 ? -1 : 0;
    const grow = lm - size;
    this.label.setRect({ x: 0, y: top - grow / 2, w: lw, h: lm });
    this.visuals.addChild(this.label.view);
  }

  update(dt: number): void {
    this.rot.update(dt);
    this.sx.update(dt);
    this.sy.update(dt);
    this.visuals.angle = this.rot.value;
    this.visuals.scale.set(this.sx.value, this.sy.value);
    let jy = 0;
    if (this.jumpT >= 0) {
      this.jumpT += dt;
      const half = 0.05;
      jy = this.jumpT < half ? -8 * (this.jumpT / half) : this.jumpT < 2 * half ? -8 * (1 - (this.jumpT - half) / half) : 0;
      if (this.jumpT >= 2 * half) this.jumpT = -1;
    }
    this.visuals.position.set(this.rect.w / 2, this.rect.h / 2 + jy);
  }

  contains(gx: number, gy: number): boolean {
    return super.contains(gx, gy);
  }

  onEnter(): void {
    this.hovered = true;
    this.redraw();
    this.rot.pull(-6, 600, 14).range(-100, 100);
    ui.playSfx('BUTTON_HOVER', { pitchRange: 0.1 });
    this.onHover?.();
  }

  onExit(): void {
    this.hovered = false;
    this.redraw();
    this.onUnhover?.();
  }

  onDown(): void {
    if (this.disabled) return;
    this.sx.pull(0.08, 500, 12);
    this.sy.pull(-0.1, 500, 12);
    this.down = true;
    this.redraw();
    ui.playSfx('BUTTON_DOWN');
  }

  onUp(): void {
    if (!this.down) return;
    this.down = false;
    this.redraw();
    ui.playSfx('BUTTON_UP');
  }

  onClick(): void {
    if (this.disabled) return;
    this.jumpT = 0;
    this.sx.pull(0.2, 500, 12);
    this.sy.pull(-0.3, 500, 12);
    this.rot.pull(3, 300, 14).range(-100, 100);
    this.onPressed?.();
  }
}

export function rectOf(c: Control): Rect {
  return c.rect;
}
