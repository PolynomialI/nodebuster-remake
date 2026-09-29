// ScrollContainer (vertical) with Godot's default-theme scrollbar: an 8 px track
// on the right and a grey rounded grabber. Wheel scrolls by page / 8.
import { Graphics } from 'pixi.js';
import { LMB, type Input } from '../core/input';
import { Control } from './control';

const BAR = 8;

export class ScrollBox extends Control {
  scroll = 0;
  private mask = new Graphics();
  private bar = new Graphics();
  private dragging: { y0: number; s0: number } | null = null;

  constructor(readonly content: Control) {
    super();
    this.add(content);
    content.inContainer = true;
    this.view.addChild(this.mask, this.bar);
    content.view.mask = this.mask;
  }

  private contentHeight(): number {
    return this.content.minSize().h;
  }

  private maxScroll(): number {
    return Math.max(0, this.contentHeight() - this.rect.h);
  }

  private hasBar(): boolean {
    return this.contentHeight() > this.rect.h;
  }

  layoutChildren(): void {
    const w = this.rect.w - (this.hasBar() ? BAR : 0);
    this.scroll = Math.min(Math.max(this.scroll, 0), this.maxScroll());
    this.content.setRect({ x: 0, y: -Math.round(this.scroll), w, h: this.contentHeight() });
  }

  redraw(): void {
    this.mask.clear().rect(0, 0, this.rect.w, this.rect.h).fill(0xffffff);
    this.bar.clear();
    if (!this.hasBar()) return;
    const x = this.rect.w - BAR;
    const h = this.rect.h;
    this.bar.roundRect(x, 0, BAR, h, 3).fill({ color: 0x000000, alpha: 0.1 });
    const page = h;
    const total = this.contentHeight();
    const gh = Math.max(16, (page / total) * h);
    const gy = (this.scroll / Math.max(1, total - page)) * (h - gh);
    this.bar.roundRect(x, gy, BAR, gh, 3).fill(0x767676);
  }

  handle(input: Input): void {
    if (!this.isVisibleInTree()) return;
    const p = this.toLocal(input.mouse.x, input.mouse.y);
    const inside = p.x >= 0 && p.y >= 0 && p.x < this.rect.w && p.y < this.rect.h;
    if (inside && input.wheel) this.scrollTo(this.scroll + (this.rect.h / 8) * input.wheel);
    const onBar = inside && this.hasBar() && p.x >= this.rect.w - BAR;
    if (onBar && input.pressed.has(LMB)) this.dragging = { y0: input.mouse.y, s0: this.scroll };
    if (this.dragging) {
      if (!input.down.has(LMB)) this.dragging = null;
      else {
        const h = this.rect.h;
        const total = this.contentHeight();
        const gh = Math.max(16, (h / total) * h);
        const per = (total - h) / Math.max(1, h - gh);
        this.scrollTo(this.dragging.s0 + (input.mouse.y - this.dragging.y0) * per);
      }
    }
  }

  scrollTo(v: number): void {
    const s = Math.min(Math.max(v, 0), this.maxScroll());
    if (s === this.scroll) return;
    this.scroll = s;
    this.layoutChildren();
    this.redraw();
  }
}
