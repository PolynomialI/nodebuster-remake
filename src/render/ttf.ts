// Minimal TrueType reader and monochrome rasterizer (no DOM; runs in tests too).
// A pixel is lit when its centre is inside the glyph outline (non-zero winding),
// which is how FreeType's monochrome mode draws a pixel font with hinting off,
// as the original does (antialiasing=0, hinting=0 in the font's .import).

export interface GlyphBitmap {
  /** Offset of the bitmap's top-left from the pen position on the baseline. */
  left: number;
  top: number;
  width: number;
  height: number;
  /** width*height, 1 = ink. */
  bits: Uint8Array;
  advance: number;
}

type Pt = { x: number; y: number; on: boolean };

export class TtfFont {
  readonly unitsPerEm: number;
  readonly ascender: number;
  readonly descender: number;
  private readonly view: DataView;
  private readonly tables: Record<string, { off: number; len: number }> = {};
  private readonly longLoca: boolean;
  private readonly numHMetrics: number;
  private readonly cmap = new Map<number, number>();
  private readonly glyphCache = new Map<string, GlyphBitmap>();

  constructor(buffer: ArrayBuffer) {
    const v = (this.view = new DataView(buffer));
    const n = v.getUint16(4);
    for (let i = 0; i < n; i++) {
      const o = 12 + 16 * i;
      const tag = String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
      this.tables[tag] = { off: v.getUint32(o + 8), len: v.getUint32(o + 12) };
    }
    const head = this.t('head');
    this.unitsPerEm = v.getUint16(head + 18);
    this.longLoca = v.getInt16(head + 50) === 1;
    const hhea = this.t('hhea');
    this.ascender = v.getInt16(hhea + 4);
    this.descender = v.getInt16(hhea + 6);
    this.numHMetrics = v.getUint16(hhea + 34);
    this.readCmap();
  }

  private t(tag: string): number {
    const e = this.tables[tag];
    if (!e) throw new Error(`font has no ${tag} table`);
    return e.off;
  }

  private readCmap(): void {
    const v = this.view;
    const base = this.t('cmap');
    const count = v.getUint16(base + 2);
    let best = -1;
    let bestFormat = 0;
    for (let i = 0; i < count; i++) {
      const pid = v.getUint16(base + 4 + i * 8);
      const eid = v.getUint16(base + 6 + i * 8);
      const off = base + v.getUint32(base + 8 + i * 8);
      const format = v.getUint16(off);
      const unicode = pid === 0 || (pid === 3 && (eid === 1 || eid === 10));
      if (unicode && (format === 12 || (format === 4 && bestFormat !== 12))) {
        best = off;
        bestFormat = format;
      }
    }
    if (best < 0) throw new Error('font has no unicode cmap');
    if (bestFormat === 4) {
      const segX2 = v.getUint16(best + 6);
      const ends = best + 14;
      const starts = ends + segX2 + 2;
      const deltas = starts + segX2;
      const ranges = deltas + segX2;
      for (let s = 0; s < segX2 / 2; s++) {
        const end = v.getUint16(ends + s * 2);
        const start = v.getUint16(starts + s * 2);
        const delta = v.getInt16(deltas + s * 2);
        const ro = v.getUint16(ranges + s * 2);
        for (let c = start; c <= end && c !== 0xffff; c++) {
          let g: number;
          if (ro === 0) g = (c + delta) & 0xffff;
          else {
            const gi = v.getUint16(ranges + s * 2 + ro + (c - start) * 2);
            g = gi === 0 ? 0 : (gi + delta) & 0xffff;
          }
          if (g) this.cmap.set(c, g);
        }
      }
    } else {
      const groups = v.getUint32(best + 12);
      for (let i = 0; i < groups; i++) {
        const o = best + 16 + i * 12;
        const start = v.getUint32(o);
        const end = v.getUint32(o + 4);
        const g0 = v.getUint32(o + 8);
        for (let c = start; c <= end; c++) this.cmap.set(c, g0 + (c - start));
      }
    }
  }

  glyphIndex(codePoint: number): number {
    return this.cmap.get(codePoint) ?? 0;
  }

  advanceUnits(glyph: number): number {
    const hmtx = this.t('hmtx');
    const i = Math.min(glyph, this.numHMetrics - 1);
    return this.view.getUint16(hmtx + i * 4);
  }

  private glyphOffset(glyph: number): [number, number] {
    const loca = this.t('loca');
    const v = this.view;
    const a = this.longLoca ? v.getUint32(loca + glyph * 4) : v.getUint16(loca + glyph * 2) * 2;
    const b = this.longLoca ? v.getUint32(loca + glyph * 4 + 4) : v.getUint16(loca + glyph * 2 + 2) * 2;
    return [this.t('glyf') + a, b - a];
  }

  /** Contours in font units, curves kept as on/off points. */
  contours(glyph: number, depth = 0): Pt[][] {
    const [off, len] = this.glyphOffset(glyph);
    if (len === 0 || depth > 8) return [];
    const v = this.view;
    const nc = v.getInt16(off);
    if (nc >= 0) {
      const ends: number[] = [];
      for (let i = 0; i < nc; i++) ends.push(v.getUint16(off + 10 + i * 2));
      const nPts = nc ? ends[nc - 1] + 1 : 0;
      let p = off + 10 + nc * 2;
      p += 2 + v.getUint16(p);
      const flags: number[] = [];
      while (flags.length < nPts) {
        const f = v.getUint8(p++);
        flags.push(f);
        if (f & 8) {
          const r = v.getUint8(p++);
          for (let k = 0; k < r; k++) flags.push(f);
        }
      }
      const xs: number[] = [];
      let x = 0;
      for (const f of flags) {
        if (f & 2) {
          const d = v.getUint8(p++);
          x += f & 16 ? d : -d;
        } else if (!(f & 16)) {
          x += v.getInt16(p);
          p += 2;
        }
        xs.push(x);
      }
      const ys: number[] = [];
      let y = 0;
      for (const f of flags) {
        if (f & 4) {
          const d = v.getUint8(p++);
          y += f & 32 ? d : -d;
        } else if (!(f & 32)) {
          y += v.getInt16(p);
          p += 2;
        }
        ys.push(y);
      }
      const out: Pt[][] = [];
      let s = 0;
      for (const e of ends) {
        const c: Pt[] = [];
        for (let i = s; i <= e; i++) c.push({ x: xs[i], y: ys[i], on: (flags[i] & 1) === 1 });
        out.push(c);
        s = e + 1;
      }
      return out;
    }
    // Compound glyph.
    const out: Pt[][] = [];
    let p = off + 10;
    for (;;) {
      const flags = v.getUint16(p);
      const gi = v.getUint16(p + 2);
      p += 4;
      let dx: number;
      let dy: number;
      if (flags & 1) {
        dx = v.getInt16(p);
        dy = v.getInt16(p + 2);
        p += 4;
      } else {
        dx = v.getInt8(p);
        dy = v.getInt8(p + 1);
        p += 2;
      }
      let a = 1, b = 0, c = 0, d = 1;
      const f2 = (o: number) => v.getInt16(o) / 16384;
      if (flags & 8) {
        a = d = f2(p);
        p += 2;
      } else if (flags & 0x40) {
        a = f2(p);
        d = f2(p + 2);
        p += 4;
      } else if (flags & 0x80) {
        a = f2(p);
        b = f2(p + 2);
        c = f2(p + 4);
        d = f2(p + 6);
        p += 8;
      }
      for (const cont of this.contours(gi, depth + 1)) {
        out.push(cont.map((q) => ({ x: a * q.x + c * q.y + dx, y: b * q.x + d * q.y + dy, on: q.on })));
      }
      if (!(flags & 0x20)) break;
    }
    return out;
  }

  /** Flatten contours to closed polygons (quadratic curves split into 8 segments). */
  static flatten(contours: Pt[][]): { x: number; y: number }[][] {
    return contours.map((c) => {
      const n = c.length;
      const poly: { x: number; y: number }[] = [];
      if (n === 0) return poly;
      // Start from an on-curve point (or the midpoint of two off-curve points).
      let start = c.findIndex((q) => q.on);
      const pts = start >= 0 ? [...c.slice(start), ...c.slice(0, start)] : c;
      if (start < 0) {
        const m = { x: (c[0].x + c[1 % n].x) / 2, y: (c[0].y + c[1 % n].y) / 2, on: true };
        pts.unshift(m);
      }
      poly.push({ x: pts[0].x, y: pts[0].y });
      for (let i = 1; i <= pts.length; i++) {
        const q = pts[i % pts.length];
        if (q.on) {
          poly.push({ x: q.x, y: q.y });
          continue;
        }
        const prev = poly[poly.length - 1];
        const nx = pts[(i + 1) % pts.length];
        const end = nx.on ? nx : { x: (q.x + nx.x) / 2, y: (q.y + nx.y) / 2, on: true };
        for (let k = 1; k <= 8; k++) {
          const t = k / 8;
          const u = 1 - t;
          poly.push({ x: u * u * prev.x + 2 * u * t * q.x + t * t * end.x, y: u * u * prev.y + 2 * u * t * q.y + t * t * end.y });
        }
        if (nx.on) i++;
      }
      return poly;
    });
  }

  /** Monochrome bitmap of a glyph at a pixel size, pen at integer (0, baseline). */
  glyph(codePoint: number, size: number): GlyphBitmap {
    const key = `${codePoint}:${size}`;
    const hit = this.glyphCache.get(key);
    if (hit) return hit;
    const g = this.glyphIndex(codePoint);
    const scale = size / this.unitsPerEm;
    const advance = Math.round(this.advanceUnits(g) * scale);
    const polys = TtfFont.flatten(this.contours(g));
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const poly of polys)
      for (const q of poly) {
        minX = Math.min(minX, q.x);
        maxX = Math.max(maxX, q.x);
        minY = Math.min(minY, q.y);
        maxY = Math.max(maxY, q.y);
      }
    if (!Number.isFinite(minX)) {
      const empty = { left: 0, top: 0, width: 0, height: 0, bits: new Uint8Array(0), advance };
      this.glyphCache.set(key, empty);
      return empty;
    }
    // Pixel rows/cols whose centres could be inside. y grows downward in pixels.
    const left = Math.floor(minX * scale);
    const right = Math.ceil(maxX * scale);
    const top = Math.floor(-maxY * scale);
    const bottom = Math.ceil(-minY * scale);
    const width = right - left;
    const height = bottom - top;
    const bits = new Uint8Array(width * height);
    for (let py = 0; py < height; py++) {
      const fy = -(top + py + 0.5) / scale;
      for (let px = 0; px < width; px++) {
        const fx = (left + px + 0.5) / scale;
        let wind = 0;
        for (const poly of polys) {
          for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            const a = poly[j];
            const b = poly[i];
            if (a.y <= fy) {
              if (b.y > fy && (b.x - a.x) * (fy - a.y) - (fx - a.x) * (b.y - a.y) > 0) wind++;
            } else if (b.y <= fy && (b.x - a.x) * (fy - a.y) - (fx - a.x) * (b.y - a.y) < 0) wind--;
          }
        }
        if (wind !== 0) bits[py * width + px] = 1;
      }
    }
    const bmp = { left, top, width, height, bits, advance };
    this.glyphCache.set(key, bmp);
    return bmp;
  }

  measure(text: string, size: number): number {
    let w = 0;
    for (const ch of text) w += this.glyph(ch.codePointAt(0)!, size).advance;
    return w;
  }
}
