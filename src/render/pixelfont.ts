// Pixel-exact text in the original's font (retro-pixel-cute-prop.ttf, imported
// with antialiasing and hinting off). Glyphs are rasterized by src/render/ttf.ts
// (pixel lit when its centre is inside the outline) and laid out by advance
// width; the font has no kerning table.
//
// Metrics (DefaultTheme.tres: spacing_top -2, spacing_bottom -1):
//   ascent = size, descent = size * 4/11, line height = ascent + descent - 3,
//   baseline = ascent - 2 below the line top.
import { CanvasSource, Texture } from 'pixi.js';
import { TtfFont } from './ttf';

function dataUrlBytes(url: string): ArrayBuffer {
  const b64 = url.slice(url.indexOf(',') + 1);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

/** Room above/below the line box for glyphs that overhang it. */
const PAD = 4;

export class PixelFont {
  private readonly cache = new Map<string, Texture>();

  private constructor(readonly ttf: TtfFont) {}

  static async load(dataUrl: string): Promise<PixelFont> {
    return new PixelFont(new TtfFont(dataUrlBytes(dataUrl)));
  }

  static metrics(size: number): { ascent: number; descent: number; lineHeight: number; baseline: number } {
    const ascent = size;
    const descent = Math.round((size * 4) / 11);
    return { ascent, descent, lineHeight: ascent + descent - 3, baseline: ascent - 2 };
  }

  measure(text: string, size = 11): number {
    return this.ttf.measure(text, size);
  }

  /** White glyphs on transparent, one line tall plus PAD above and below; tint the sprite for colour. */
  texture(text: string, size = 11): Texture {
    const key = `${size}\u0000${text}`;
    let tex = this.cache.get(key);
    if (tex) return tex;
    const m = PixelFont.metrics(size);
    const w = Math.max(1, this.measure(text, size) + 2);
    const h = m.lineHeight + PAD * 2;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(w, h);
    const d = img.data;
    let pen = 0;
    const base = PAD + m.baseline;
    for (const ch of text) {
      const g = this.ttf.glyph(ch.codePointAt(0)!, size);
      for (let y = 0; y < g.height; y++) {
        const py = base + g.top + y;
        if (py < 0 || py >= h) continue;
        for (let x = 0; x < g.width; x++) {
          if (!g.bits[y * g.width + x]) continue;
          const px = pen + g.left + x;
          if (px < 0 || px >= w) continue;
          const i = (py * w + px) * 4;
          d[i] = d[i + 1] = d[i + 2] = d[i + 3] = 255;
        }
      }
      pen += g.advance;
    }
    ctx.putImageData(img, 0, 0);
    tex = new Texture({ source: new CanvasSource({ resource: canvas, scaleMode: 'nearest' }) });
    this.cache.set(key, tex);
    return tex;
  }
}

/** Sprites showing a text texture sit PAD px above their line box. */
export function textPad(_tex?: Texture): number {
  return PAD;
}
