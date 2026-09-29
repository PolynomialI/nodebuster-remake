// The BBCode subset the original's RichTextLabels use: [center] [right]
// [color=#rrggbb(aa)] [img]path[/img] [rainbow sat=.. freq=..], plus
// [icon:bits] (a currency icon) and [c:NAME] (a palette colour) for content
// strings. Lays out with word wrap (WORD_SMART), tab stops and Godot's line
// metrics, and draws into a Pixi container.
import { Container, Sprite } from 'pixi.js';
import { color as paletteColor } from '../data/content';
import { PixelFont, textPad } from '../render/pixelfont';
import { IMG_PATHS, tex, ui } from './ctx';

export type HAlign = 'left' | 'center' | 'right';

interface Run {
  kind: 'text' | 'img' | 'tab' | 'br';
  text?: string;
  img?: string;
  color: number | null;
  alpha: number;
  rainbow?: { sat: number; freq: number };
  align: HAlign;
}

export interface Shadow {
  color: number;
  x: number;
  y: number;
  /** Godot shadow_outline_size (Label default 1, RichTextLabel theme 0). */
  outline: number;
}

function parseColor(s: string): { c: number; a: number } {
  if (s.startsWith('#')) {
    const h = s.slice(1);
    const c = parseInt(h.slice(0, 6), 16);
    const a = h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return { c, a };
  }
  return { c: paletteColor(s), a: 1 };
}

/** Split markup into runs (text split into words and spaces so it can wrap). */
export function parse(markup: string, baseAlign: HAlign = 'left'): Run[] {
  const runs: Run[] = [];
  const colors: { c: number; a: number }[] = [];
  const aligns: HAlign[] = [baseAlign];
  let rainbow: { sat: number; freq: number } | undefined;
  const re = /\[(\/?)([a-z]+)(?:[=:]([^\]]*))?((?:\s+[a-z]+=[^\s\]]+)*)\]/gi;
  let last = 0;
  const pushText = (s: string) => {
    s = s.replaceAll('⁠', '');
    const cur = colors[colors.length - 1];
    const align = aligns[aligns.length - 1];
    for (const part of s.split(/(\n|\t| )/)) {
      if (part === '') continue;
      if (part === '\n') runs.push({ kind: 'br', color: null, alpha: 1, align });
      else if (part === '\t') runs.push({ kind: 'tab', color: null, alpha: 1, align });
      else runs.push({ kind: 'text', text: part, color: cur ? cur.c : null, alpha: cur ? cur.a : 1, rainbow, align });
    }
  };
  let m: RegExpExecArray | null;
  while ((m = re.exec(markup))) {
    pushText(markup.slice(last, m.index));
    last = re.lastIndex;
    const [, close, tag, arg, attrs] = m;
    const t = tag.toLowerCase();
    if (t === 'center' || t === 'right' || t === 'left') {
      if (close) aligns.pop();
      else aligns.push(t as HAlign);
    } else if (t === 'color' || t === 'c') {
      if (close) colors.pop();
      else colors.push(parseColor(arg ?? ''));
    } else if (t === 'rainbow') {
      if (close) rainbow = undefined;
      else {
        const get = (k: string, d: number) => Number(new RegExp(`${k}=([\\d.]+)`).exec(attrs ?? '')?.[1] ?? d);
        rainbow = { sat: get('sat', 0.8), freq: get('freq', 1) };
      }
    } else if (t === 'img' && !close) {
      const end = markup.indexOf('[/img]', last);
      const path = markup.slice(last, end).replace(/^res:\/\//, '');
      last = end + 6;
      re.lastIndex = last;
      runs.push({ kind: 'img', img: IMG_PATHS[path] ?? path, color: null, alpha: 1, align: aligns[aligns.length - 1] });
    } else if (t === 'icon' && !close) {
      runs.push({ kind: 'img', img: `icon/${arg}`, color: null, alpha: 1, align: aligns[aligns.length - 1] });
    }
  }
  pushText(markup.slice(last));
  return runs;
}

interface Placed {
  run: Run;
  x: number;
  w: number;
}

interface Line {
  items: Placed[];
  width: number;
  align: HAlign;
}

const SIZE = 11;

export function runWidth(r: Run, font: PixelFont): number {
  if (r.kind === 'text') return font.measure(r.text!, SIZE);
  if (r.kind === 'img') return tex(r.img!).width;
  return 0;
}

/** Break runs into lines. maxWidth = Infinity disables wrapping. */
export function layout(runs: Run[], maxWidth: number, font: PixelFont): Line[] {
  const lines: Line[] = [];
  const space = font.measure(' ', SIZE);
  const tabStop = space * 4;
  let cur: Line = { items: [], width: 0, align: runs[0]?.align ?? 'left' };
  const flush = () => {
    // Trailing spaces don't count towards the line width.
    while (cur.items.length && cur.items[cur.items.length - 1].run.kind === 'text' && cur.items[cur.items.length - 1].run.text === ' ') cur.items.pop();
    const lastItem = cur.items[cur.items.length - 1];
    cur.width = lastItem ? lastItem.x + lastItem.w : 0;
    lines.push(cur);
  };
  let x = 0;
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i];
    if (cur.items.length === 0) cur.align = r.align;
    if (r.kind === 'br') {
      flush();
      cur = { items: [], width: 0, align: runs[i + 1]?.align ?? r.align };
      x = 0;
      continue;
    }
    if (r.kind === 'tab') {
      const nx = (Math.floor(x / tabStop) + 1) * tabStop;
      cur.items.push({ run: r, x, w: nx - x });
      x = nx;
      continue;
    }
    const w = runWidth(r, font);
    const isSpace = r.kind === 'text' && r.text === ' ';
    if (!isSpace && x + w > maxWidth && cur.items.length > 0) {
      flush();
      cur = { items: [], width: 0, align: r.align };
      x = 0;
    }
    if (isSpace && cur.items.length === 0 && lines.length > 0) continue;
    cur.items.push({ run: r, x, w });
    x += w;
  }
  flush();
  return lines;
}

export const LINE_HEIGHT = PixelFont.metrics(SIZE).lineHeight;

/** Size of laid-out text. */
export function measureMarkup(markup: string, maxWidth = Infinity, align: HAlign = 'left'): { w: number; h: number; lines: number } {
  const lines = layout(parse(markup, align), maxWidth, ui.font);
  return { w: Math.max(0, ...lines.map((l) => l.width)), h: lines.length * LINE_HEIGHT, lines: lines.length };
}

function hsvToRgb(h: number, s: number, v: number): number {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  const [r, g, b] = [
    [v, t, p],
    [q, v, p],
    [p, v, t],
    [p, q, v],
    [t, p, v],
    [v, p, q],
  ][((i % 6) + 6) % 6];
  return (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
}

/** Draws laid-out lines into a container; returns rainbow glyphs to animate. */
export function drawLines(target: Container, lines: Line[], width: number, defaultColor: number, shadow: Shadow | null): { sprite: Sprite; index: number; rainbow: { sat: number; freq: number } }[] {
  target.removeChildren();
  const rainbowGlyphs: { sprite: Sprite; index: number; rainbow: { sat: number; freq: number } }[] = [];
  const font = ui.font;
  lines.forEach((line, li) => {
    // RichTextLabel: off.x += Math::floor((width - line_width) / 2) for centred lines.
    const ox = line.align === 'center' ? Math.floor((width - line.width) / 2) : line.align === 'right' ? Math.floor(width - line.width) : 0;
    const top = li * LINE_HEIGHT;
    const shadowLayer = new Container();
    const main = new Container();
    target.addChild(shadowLayer, main);
    for (const it of line.items) {
      const r = it.run;
      if (r.kind === 'text') {
        const col = r.color ?? defaultColor;
        if (r.rainbow) {
          // One sprite per character so each can take its own hue.
          let cx = Math.round(ox + it.x);
          for (const ch of r.text!) {
            const t = font.texture(ch, SIZE);
            const s = new Sprite(t);
            s.position.set(cx, top - textPad(t));
            main.addChild(s);
            rainbowGlyphs.push({ sprite: s, index: cx, rainbow: r.rainbow });
            cx += font.measure(ch, SIZE);
          }
          continue;
        }
        const t = font.texture(r.text!, SIZE);
        // TextServer rounds glyph positions (x.5 -> x+1); a sprite left at .5 would
        // sample texel edges and double or drop columns.
        const gx = Math.round(ox + it.x);
        if (shadow) addShadow(shadowLayer, t, gx, top - textPad(t), shadow);
        const s = new Sprite(t);
        s.tint = col;
        s.alpha = r.alpha;
        s.position.set(gx, top - textPad(t));
        main.addChild(s);
      } else if (r.kind === 'img') {
        const t = tex(r.img!);
        const s = new Sprite(t);
        // INLINE_ALIGNMENT_CENTER: image centre on the line box centre.
        s.position.set(Math.round(ox + it.x), Math.round(top + (LINE_HEIGHT - t.height) / 2));
        main.addChild(s);
      }
    }
  });
  return rainbowGlyphs;
}

export function addShadow(layer: Container, t: import('pixi.js').Texture, x: number, y: number, sh: Shadow): void {
  const offs: [number, number][] = [[0, 0]];
  if (sh.outline > 0)
    for (let dy = -sh.outline; dy <= sh.outline; dy++)
      for (let dx = -sh.outline; dx <= sh.outline; dx++) if (dx || dy) offs.push([dx, dy]);
  for (const [dx, dy] of offs) {
    const s = new Sprite(t);
    s.tint = sh.color;
    s.position.set(x + sh.x + dx, y + sh.y + dy);
    layer.addChild(s);
  }
}

/** Godot [rainbow]: Color.from_hsv(freq * (time + glyph_x / 50), sat, 0.8) per glyph (index = glyph x). */
export function updateRainbow(glyphs: { sprite: Sprite; index: number; rainbow: { sat: number; freq: number } }[], time: number): void {
  for (const g of glyphs) {
    const h = (((g.rainbow.freq * (time + g.index / 50)) % 1) + 1) % 1;
    g.sprite.tint = hsvToRgb(h, g.rainbow.sat, 0.8);
  }
}
