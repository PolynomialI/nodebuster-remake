// A single-line pixel-font label, positioned by its line box like a Godot Label.
import { Container, Sprite } from 'pixi.js';
import { PixelFont, textPad } from './pixelfont';

export type Align = 'left' | 'center' | 'right';

export class Label extends Container {
  private sprite = new Sprite();
  private _text: string | null = null;
  private _color = 0xdcdcdc;

  constructor(
    private readonly font: PixelFont,
    text = '',
    readonly size = 11,
    color = 0xdcdcdc,
  ) {
    super();
    this.addChild(this.sprite);
    this._color = color;
    this.text = text;
  }

  get text(): string {
    return this._text ?? '';
  }

  set text(v: string) {
    if (v === this._text) return;
    this._text = v;
    const tex = this.font.texture(v || ' ', this.size);
    this.sprite.texture = tex;
    this.sprite.y = -textPad(tex);
    this.sprite.tint = this._color;
  }

  set color(c: number) {
    this._color = c;
    this.sprite.tint = c;
  }

  /** Advance width of the text in pixels. */
  get textWidth(): number {
    return this.font.measure(this.text, this.size);
  }

  get lineHeight(): number {
    return PixelFont.metrics(this.size).lineHeight;
  }

  /** Place the line box so its horizontal alignment point is at x. */
  placeAt(x: number, y: number, align: Align = 'left'): this {
    const w = this.textWidth;
    this.x = Math.round(align === 'left' ? x : align === 'center' ? x - w / 2 : x - w);
    this.y = Math.round(y);
    return this;
  }
}
