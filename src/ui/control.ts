// A small subset of Godot's Control layout, enough to transcribe the original's
// .tscn UI scenes: anchors + offsets + grow directions, minimum sizes, size
// flags, and the containers the game uses (VBox, HBox, Margin, Panel, Grid,
// Center). Rects are in game pixels and may be fractional, like Godot with
// snap_controls_to_pixels = false; the GPU rounds them the same way.
import { Container } from 'pixi.js';

export const FILL = 1;
export const EXPAND = 2;
export const SHRINK_CENTER = 4;
export const SHRINK_END = 8;

export type Grow = 'begin' | 'end' | 'both';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export class Control {
  readonly view = new Container();
  /** The control's own drawing, always below its children's views. */
  readonly gfx = new Container();
  readonly children: Control[] = [];
  parent: Control | null = null;
  rect: Rect = { x: 0, y: 0, w: 0, h: 0 };
  customMin = { w: 0, h: 0 };
  /** Anchors (0-1 of the parent) and offsets, as in the .tscn. */
  anchors = { l: 0, t: 0, r: 0, b: 0 };
  offsets = { l: 0, t: 0, r: 0, b: 0 };
  growH: Grow = 'end';
  growV: Grow = 'end';
  flagsH = FILL;
  flagsV = FILL;
  /** Laid out by a parent container rather than by anchors. */
  inContainer = false;
  visible = true;
  pivot = { x: 0, y: 0 };
  name = '';

  constructor() {
    this.view.addChild(this.gfx);
  }

  add<T extends Control>(c: T): T {
    c.parent = this;
    this.children.push(c);
    this.view.addChild(c.view);
    return c;
  }

  remove(c: Control): void {
    const i = this.children.indexOf(c);
    if (i >= 0) this.children.splice(i, 1);
    c.parent = null;
    this.view.removeChild(c.view);
  }

  clear(): void {
    for (const c of [...this.children]) this.remove(c);
  }

  /** The control's own minimum size (content), before custom_minimum_size. */
  intrinsicMin(): { w: number; h: number } {
    return { w: 0, h: 0 };
  }

  minSize(): { w: number; h: number } {
    const m = this.intrinsicMin();
    return { w: Math.max(m.w, this.customMin.w), h: Math.max(m.h, this.customMin.h) };
  }

  setAnchorsPreset(preset: 'full' | 'center' | 'topleft' | 'topright' | 'bottomleft' | 'bottomright' | 'centertop'): this {
    const a = {
      full: [0, 0, 1, 1],
      center: [0.5, 0.5, 0.5, 0.5],
      topleft: [0, 0, 0, 0],
      topright: [1, 0, 1, 0],
      bottomleft: [0, 1, 0, 1],
      bottomright: [1, 1, 1, 1],
      centertop: [0.5, 0, 0.5, 0],
    }[preset];
    this.anchors = { l: a[0], t: a[1], r: a[2], b: a[3] };
    return this;
  }

  place(l: number, t: number, r: number, b: number): this {
    this.offsets = { l, t, r, b };
    return this;
  }

  /** Position from anchors/offsets inside the parent rect, then grow to the minimum size. */
  layoutAnchored(parent: Rect): void {
    let l = parent.w * this.anchors.l + this.offsets.l;
    let t = parent.h * this.anchors.t + this.offsets.t;
    let r = parent.w * this.anchors.r + this.offsets.r;
    let b = parent.h * this.anchors.b + this.offsets.b;
    const m = this.minSize();
    const grow = (a: number, z: number, min: number, g: Grow): [number, number] => {
      const d = min - (z - a);
      if (d <= 0) return [a, z];
      if (g === 'begin') return [a - d, z];
      if (g === 'end') return [a, z + d];
      return [a - d / 2, z + d / 2];
    };
    [l, r] = grow(l, r, m.w, this.growH);
    [t, b] = grow(t, b, m.h, this.growV);
    this.setRect({ x: l, y: t, w: r - l, h: b - t });
  }

  setRect(r: Rect): void {
    this.rect = r;
    this.view.position.set(r.x + this.pivot.x, r.y + this.pivot.y);
    this.view.pivot.set(this.pivot.x, this.pivot.y);
    this.layoutChildren();
    this.redraw();
  }

  /** Default: children are anchored inside this control. */
  layoutChildren(): void {
    const inner = { x: 0, y: 0, w: this.rect.w, h: this.rect.h };
    for (const c of this.children) if (!c.inContainer) c.layoutAnchored(inner);
  }

  redraw(): void {}

  setVisible(v: boolean): void {
    this.visible = v;
    this.view.visible = v;
  }

  /** Point in this control's coordinates (for hit testing). */
  toLocal(gx: number, gy: number): { x: number; y: number } {
    const p = this.view.toLocal({ x: gx, y: gy }, this.rootView());
    return { x: p.x, y: p.y };
  }

  private rootView(): Container {
    let c: Container = this.view;
    while (c.parent) c = c.parent;
    return c;
  }

  contains(gx: number, gy: number): boolean {
    if (!this.isVisibleInTree()) return false;
    const p = this.toLocal(gx, gy);
    return p.x >= 0 && p.y >= 0 && p.x < this.rect.w && p.y < this.rect.h;
  }

  isVisibleInTree(): boolean {
    let v: Container | null = this.view;
    while (v) {
      if (!v.visible) return false;
      v = v.parent;
    }
    return true;
  }
}

/** Container::fit_child_in_rect: FILL takes the rect, otherwise the minimum size placed by the shrink flag. */
export function fitChildInRect(c: Control, r: Rect): void {
  c.inContainer = true;
  const m = c.minSize();
  let { x, y, w, h } = r;
  if (!(c.flagsH & FILL)) {
    w = m.w;
    if (c.flagsH & SHRINK_END) x += r.w - m.w;
    else if (c.flagsH & SHRINK_CENTER) x += Math.floor((r.w - m.w) / 2);
  }
  if (!(c.flagsV & FILL)) {
    h = m.h;
    if (c.flagsV & SHRINK_END) y += r.h - m.h;
    else if (c.flagsV & SHRINK_CENTER) y += Math.floor((r.h - m.h) / 2);
  }
  c.setRect({ x, y, w, h });
}

const f32 = Math.fround;

/** BoxContainer (Godot 4.2 box_container.cpp): integer sizes, expanding children share the stretch space evenly. */
export class BoxContainer extends Control {
  separation = 4;
  alignment: 'begin' | 'center' | 'end' = 'begin';

  constructor(readonly vertical: boolean) {
    super();
  }

  private shown(): Control[] {
    return this.children.filter((c) => c.visible);
  }

  intrinsicMin(): { w: number; h: number } {
    const kids = this.shown();
    let main = 0;
    let cross = 0;
    kids.forEach((c, i) => {
      const m = c.minSize();
      main += Math.trunc(this.vertical ? m.h : m.w) + (i ? this.separation : 0);
      cross = Math.max(cross, Math.trunc(this.vertical ? m.w : m.h));
    });
    return this.vertical ? { w: cross, h: main } : { w: main, h: cross };
  }

  /** BoxContainer::_resort */
  layoutChildren(): void {
    const kids = this.shown();
    if (!kids.length) return;
    const W = Math.trunc(this.rect.w);
    const H = Math.trunc(this.rect.h);
    let stretchMin = 0;
    let stretchAvail = 0;
    let ratioTotal = 0;
    const msc = kids.map((c) => {
      const m = c.minSize();
      const min = Math.trunc(this.vertical ? m.h : m.w);
      const stretch = ((this.vertical ? c.flagsV : c.flagsH) & EXPAND) !== 0;
      stretchMin += min;
      if (stretch) {
        stretchAvail += min;
        ratioTotal += 1;
      }
      return { min, stretch, final: min };
    });
    const stretchMax = (this.vertical ? H : W) - (kids.length - 1) * this.separation;
    const stretchDiff = Math.max(0, stretchMax - stretchMin);
    stretchAvail += stretchDiff;
    let hasStretched = false;
    while (ratioTotal > 0) {
      hasStretched = true;
      let refit = true;
      let error = 0;
      for (const m of msc) {
        if (!m.stretch) continue;
        const px = f32(f32(stretchAvail) / ratioTotal);
        error = f32(error + f32(px - Math.trunc(px)));
        if (px < m.min) {
          m.stretch = false;
          ratioTotal -= 1;
          refit = false;
          stretchAvail -= m.min;
          m.final = m.min;
          break;
        }
        m.final = Math.trunc(px);
        if (error >= 1) {
          m.final += 1;
          error = f32(error - 1);
        }
      }
      if (refit) break;
    }
    let ofs = 0;
    if (!hasStretched) {
      if (this.alignment === 'center') ofs = Math.trunc(stretchDiff / 2);
      else if (this.alignment === 'end') ofs = stretchDiff;
    }
    kids.forEach((c, i) => {
      if (i) ofs += this.separation;
      const from = ofs;
      let to = ofs + msc[i].final;
      if (msc[i].stretch && i === kids.length - 1) to = this.vertical ? H : W;
      const size = to - from;
      fitChildInRect(c, this.vertical ? { x: 0, y: from, w: W, h: size } : { x: from, y: 0, w: size, h: H });
      ofs = to;
    });
  }
}

export class VBox extends BoxContainer {
  constructor(separation = 4) {
    super(true);
    this.separation = separation;
  }
}

export class HBox extends BoxContainer {
  constructor(separation = 4) {
    super(false);
    this.separation = separation;
  }
}

/**
 * Children fill the rect minus margins: MarginContainer (integer inner size) and,
 * with truncate off, PanelContainer's style content margins.
 */
export class MarginBox extends Control {
  margins = { l: 0, t: 0, r: 0, b: 0 };
  protected truncate = true;

  constructor(l = 0, t = 0, r = 0, b = 0) {
    super();
    this.margins = { l, t, r, b };
  }

  intrinsicMin(): { w: number; h: number } {
    let w = 0;
    let h = 0;
    for (const c of this.children) {
      if (!c.visible) continue;
      const m = c.minSize();
      w = Math.max(w, m.w);
      h = Math.max(h, m.h);
    }
    return { w: w + this.margins.l + this.margins.r, h: h + this.margins.t + this.margins.b };
  }

  layoutChildren(): void {
    const { l, t, r, b } = this.margins;
    let w = this.rect.w - l - r;
    let h = this.rect.h - t - b;
    if (this.truncate) {
      w = Math.trunc(w);
      h = Math.trunc(h);
    }
    for (const c of this.children) if (c.visible) fitChildInRect(c, { x: l, y: t, w, h });
  }
}

/** GridContainer (Godot 4.2 grid_container.cpp): expanded columns share the space in whole pixels. */
export class Grid extends Control {
  hSep = 4;
  vSep = 4;

  constructor(public columns = 1) {
    super();
  }

  private cells(): { colMin: number[]; rowMin: number[]; kids: Control[] } {
    const kids = this.children.filter((c) => c.visible);
    const colMin: number[] = [];
    const rowMin: number[] = [];
    kids.forEach((c, i) => {
      const m = c.minSize();
      const col = i % this.columns;
      const row = Math.floor(i / this.columns);
      colMin[col] = Math.max(colMin[col] ?? 0, Math.trunc(m.w));
      rowMin[row] = Math.max(rowMin[row] ?? 0, Math.trunc(m.h));
    });
    return { colMin, rowMin, kids };
  }

  intrinsicMin(): { w: number; h: number } {
    const { colMin, rowMin } = this.cells();
    const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
    return { w: sum(colMin) + Math.max(0, colMin.length - 1) * this.hSep, h: sum(rowMin) + Math.max(0, rowMin.length - 1) * this.vSep };
  }

  layoutChildren(): void {
    const { colMin, rowMin, kids } = this.cells();
    const n = kids.length;
    const colExp = new Set<number>();
    const rowExp = new Set<number>();
    kids.forEach((c, i) => {
      if (c.flagsH & EXPAND) colExp.add(i % this.columns);
      if (c.flagsV & EXPAND) rowExp.add(Math.floor(i / this.columns));
    });
    const maxCol = Math.min(n, this.columns);
    const maxRow = Math.ceil(n / this.columns);
    for (let i = n; i < this.columns; i++) colExp.add(i);
    let remW = this.rect.w;
    let remH = this.rect.h;
    colMin.forEach((w, i) => {
      if (!colExp.has(i)) remW -= w;
    });
    rowMin.forEach((h, i) => {
      if (!rowExp.has(i)) remH -= h;
    });
    remH -= this.vSep * Math.max(maxRow - 1, 0);
    remW -= this.hSep * Math.max(maxCol - 1, 0);
    const shrink = (exp: Set<number>, mins: number[], rem: number): number => {
      let fit = false;
      while (!fit && exp.size > 0) {
        fit = true;
        const keys = [...exp].sort((a, b) => a - b);
        let maxIndex = keys[0];
        for (const e of keys) {
          if ((mins[e] ?? 0) > (mins[maxIndex] ?? 0)) maxIndex = e;
          if (fit && rem / exp.size < (mins[e] ?? 0)) fit = false;
        }
        if (!fit) {
          exp.delete(maxIndex);
          rem -= mins[maxIndex] ?? 0;
        }
      }
      return rem;
    };
    remW = shrink(colExp, colMin, remW);
    remH = shrink(rowExp, rowMin, remH);
    const colExpand = colExp.size ? Math.trunc(remW / colExp.size) : 0;
    let colPixels = colExp.size ? Math.trunc(remW - colExp.size * colExpand) : 0;
    const rowExpand = rowExp.size ? Math.trunc(remH / rowExp.size) : 0;
    let rowPixels = rowExp.size ? Math.trunc(remH - rowExp.size * rowExpand) : 0;
    let colPixelIndex = 0;
    for (let i = 0; i < maxCol && colPixels > 0; i++)
      if (colExp.has(i)) {
        colPixelIndex = i + 1;
        colPixels--;
      }
    let rowPixelIndex = 0;
    for (let i = 0; i < maxRow && rowPixels > 0; i++)
      if (rowExp.has(i)) {
        rowPixelIndex = i + 1;
        rowPixels--;
      }
    let colOfs = 0;
    let rowOfs = 0;
    kids.forEach((c, i) => {
      const row = Math.floor(i / this.columns);
      const col = i % this.columns;
      if (col === 0) {
        colOfs = 0;
        if (row > 0) {
          rowOfs += (rowExp.has(row - 1) ? rowExpand : rowMin[row - 1]) + this.vSep;
          if (rowExp.has(row - 1) && row - 1 < rowPixelIndex) rowOfs++;
        }
      }
      let w = colExp.has(col) ? colExpand : colMin[col];
      let h = rowExp.has(row) ? rowExpand : rowMin[row];
      if (colExp.has(col) && col < colPixelIndex) w++;
      if (rowExp.has(row) && row < rowPixelIndex) h++;
      fitChildInRect(c, { x: colOfs, y: rowOfs, w, h });
      colOfs += w + this.hSep;
    });
  }
}

/** Stack of anchored layers; the root of each screen. */
export class Root extends Control {
  constructor(w: number, h: number) {
    super();
    this.rect = { x: 0, y: 0, w, h };
  }

  layout(): void {
    this.setRect(this.rect);
  }
}
