// res://Scenes/UI/ResourcePanel.tscn: outlined panel, BG fill, icon, amount (right-aligned).
import { color, content, type Currency } from '../data/content';
import { Control, HBox, MarginBox, EXPAND, SHRINK_END } from './control';
import { tex } from './ctx';
import { numStr } from './format';
import { SpringValue } from './spring';
import { BG, Panel, RichLabel, solid, TextureRect, WHITE, type Interactive } from './widgets';

export class ResourcePanel extends Panel implements Interactive {
  readonly amount: RichLabel;
  private value = NaN;
  private flash = 0;
  readonly sx = new SpringValue(1);
  readonly sy = new SpringValue(1);
  readonly rot = new SpringValue(0);
  onHover: () => void = () => {};
  onUnhover: () => void = () => {};
  readonly panelS = { sx: new SpringValue(1), sy: new SpringValue(1) };

  constructor(readonly currency: Currency) {
    super('outlined');
    this.selfModulate = WHITE;
    const m = this.add(new MarginBox(1, 0, 1, 0));
    const h = m.add(new HBox(2));
    h.add(new TextureRect(tex(`icon/${currency}`), 'keep_centered'));
    this.amount = h.add(new RichLabel(''));
    this.amount.autowrap = false;
    this.amount.flagsH = EXPAND | SHRINK_END;
  }

  /** The BG ColorRect is show_behind_parent: under the outline, filling the content rect. */
  redraw(): void {
    super.redraw();
    this.gfx.addChildAt(solid(1, 1, this.rect.w - 2, this.rect.h - 2, BG), 0);
  }

  private colorNow(): number {
    return this.flash > 0 ? WHITE : color(content.palette.currency[this.currency]);
  }

  set(v: number): void {
    if (v === this.value) return;
    this.value = v;
    this.amount.color = this.colorNow();
    this.amount.setMarkup(`[right]${numStr(v, this.currency === 'netcoin')}[/right]`);
  }

  /** ResourcePanel.squash(): the amount squashes, twists and flashes white for 0.1 s. */
  squash(): void {
    const w = this.amount.rect.w || 1;
    const mag = 9 / w;
    this.sx.pull(-mag, 150, 10);
    this.sy.pull(mag, 150, 10);
    this.rot.pull(16, 600, 14).range(-100, 100);
    this.flash = 0.1;
    this.amount.color = WHITE;
    this.amount.redraw();
  }

  contains(gx: number, gy: number): boolean {
    return super.contains(gx, gy);
  }
  onEnter(): void {
    this.panelS.sx.pull(0.3, 150, 10, 1);
    this.panelS.sy.pull(0.5, 150, 10, 1);
    this.onHover();
  }
  onExit(): void {
    this.onUnhover();
  }
  onDown(): void {}
  onUp(): void {}
  onClick(): void {}

  update(dt: number): void {
    if (this.flash > 0) {
      this.flash -= dt;
      if (this.flash <= 0) {
        this.amount.color = this.colorNow();
        this.amount.redraw();
      }
    }
    for (const s of [this.sx, this.sy, this.rot, this.panelS.sx, this.panelS.sy]) s.update(dt);
    const a = this.amount.view;
    a.pivot.set(this.amount.rect.w / 2, this.amount.rect.h / 2);
    a.position.set(this.amount.rect.x + this.amount.rect.w / 2, this.amount.rect.y + this.amount.rect.h / 2);
    a.scale.set(this.sx.value, this.sy.value);
    a.angle = this.rot.value;
    const v = this.view;
    v.pivot.set(this.rect.w / 2, this.rect.h / 2);
    v.position.set(this.rect.x + this.rect.w / 2, this.rect.y + this.rect.h / 2);
    v.scale.set(this.panelS.sx.value, this.panelS.sy.value);
  }
}

export type { Control };
