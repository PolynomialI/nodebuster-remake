import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TtfFont } from '../../src/render/ttf';

const FONT = 'reference/extracted/Themes/retro-pixel-cute-prop.ttf';

describe.skipIf(!existsSync(FONT))('TtfFont (game font)', () => {
  const buf = readFileSync(FONT);
  const font = new TtfFont(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

  it('reads the metrics the layout relies on', () => {
    expect(font.unitsPerEm).toBe(1100);
    expect(font.ascender).toBe(1100);
    expect(font.descender).toBe(-400);
  });

  it('has whole-pixel advances at 11 px and 22 px', () => {
    for (const ch of 'nodebuster 0123456789 +%/.,:') {
      const a11 = font.glyph(ch.codePointAt(0)!, 11).advance;
      expect(Number.isInteger(a11)).toBe(true);
      expect(font.glyph(ch.codePointAt(0)!, 22).advance).toBe(a11 * 2);
    }
  });

  it('rasterizes glyphs as solid pixel shapes (22 px = 11 px doubled)', () => {
    for (const ch of 'ckatsx0%') {
      const g11 = font.glyph(ch.codePointAt(0)!, 11);
      const g22 = font.glyph(ch.codePointAt(0)!, 22);
      expect(g11.bits.some((b) => b)).toBe(true);
      // Each 11 px pixel becomes a 2x2 block at 22 px: the outlines sit on the pixel grid.
      for (let y = 0; y < g11.height; y++)
        for (let x = 0; x < g11.width; x++) {
          const on = g11.bits[y * g11.width + x];
          const X = (g11.left + x) * 2 - g22.left;
          const Y = (g11.top + y) * 2 - g22.top;
          for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) expect(g22.bits[(Y + dy) * g22.width + X + dx] ?? 0).toBe(on);
        }
    }
  });
});
