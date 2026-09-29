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

/** Places children one after another; min size sums along the axis. */
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
    for (const c of kids) {
      const m = c.minSize();
      main += this.vertical ? m.h : m.w;
      cross = Math.max(cross, this.vertical ? m.w : m.h);
    }
    main += Math.max(0, kids.length - 1) * this.separation;
    return this.vertical ? { w: cross, h: main } : { w: main, h: cross };
  }

  layoutChildren(): void {
    const kids = this.shown();
    for (const c of kids) c.inContainer = true;
    const total = this.vertical ? this.rect.h : this.rect.w;
    const crossSize = this.vertical ? this.rect.w : this.rect.h;
    const mins = kids.map((c) => (this.vertical ? c.minSize().h : c.minSize().w));
    const expand = kids.map((c) => ((this.vertical ? c.flagsV : c.flagsH) & EXPAND) !== 0);
    const used = mins.reduce((a, b) => a + b, 0) + Math.max(0, kids.length - 1) * this.separation;
    let extra = Math.max(0, total - used);
    const nExpand = expand.filter(Boolean).length;
    let pos = 0;
    if (nExpand === 0) {
      if (this.alignment === 'center') pos = extra / 2;
      else if (this.alignment === 'end') pos = extra;
      extra = 0;
    }
    kids.forEach((c, i) => {
      let size = mins[i];
      if (expand[i] && nExpand) size += extra / nExpand;
      const m = c.minSize();
      const flags = this.vertical ? c.flagsH : c.flagsV;
      const cm = this.vertical ? m.w : m.h;
      let cs = crossSize;
      let co = 0;
      if (!(flags & FILL)) {
        cs = cm;
        if (flags & SHRINK_CENTER) co = Math.floor((crossSize - cm) / 2);
        else if (flags & SHRINK_END) co = crossSize - cm;
      }
      c.setRect(this.vertical ? { x: co, y: pos, w: cs, h: size } : { x: pos, y: co, w: size, h: cs });
      pos += size + this.separation;
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

/** Children fill the rect minus margins (MarginContainer, and PanelContainer's content margins). */
export class MarginBox extends Control {
  margins = { l: 0, t: 0, r: 0, b: 0 };

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
    for (const c of this.children) {
      if (!c.visible) continue;
      c.inContainer = true;
      const w = this.rect.w - l - r;
      const h = this.rect.h - t - b;
      const m = c.minSize();
      let x = l;
      let y = t;
      let cw = w;
      let ch = h;
      if (!(c.flagsH & FILL)) {
        cw = m.w;
        if (c.flagsH & SHRINK_CENTER) x += Math.floor((w - m.w) / 2);
        else if (c.flagsH & SHRINK_END) x += w - m.w;
      }
      if (!(c.flagsV & FILL)) {
        ch = m.h;
        if (c.flagsV & SHRINK_CENTER) y += Math.floor((h - m.h) / 2);
        else if (c.flagsV & SHRINK_END) y += h - m.h;
      }
      c.setRect({ x, y, w: cw, h: ch });
    }
  }
}

/** GridContainer: fixed number of columns, each as wide as its widest cell. */
export class Grid extends Control {
  hSep = 4;
  vSep = 4;

  constructor(public columns = 1) {
    super();
  }

  private cells(): { cols: number[]; rows: number[]; kids: Control[] } {
    const kids = this.children.filter((c) => c.visible);
    const cols: number[] = [];
    const rows: number[] = [];
    kids.forEach((c, i) => {
      const m = c.minSize();
      const col = i % this.columns;
      const row = Math.floor(i / this.columns);
      cols[col] = Math.max(cols[col] ?? 0, m.w);
      rows[row] = Math.max(rows[row] ?? 0, m.h);
    });
    return { cols, rows, kids };
  }

  intrinsicMin(): { w: number; h: number } {
    const { cols, rows } = this.cells();
    const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
    return { w: sum(cols) + Math.max(0, cols.length - 1) * this.hSep, h: sum(rows) + Math.max(0, rows.length - 1) * this.vSep };
  }

  layoutChildren(): void {
    const { cols, rows, kids } = this.cells();
    // Columns with EXPAND share the extra width (the Crypto Mine deposit buttons).
    const expandCols = new Set<number>();
    kids.forEach((c, i) => c.flagsH & EXPAND && expandCols.add(i % this.columns));
    const min = this.intrinsicMin();
    const extra = Math.max(0, this.rect.w - min.w);
    const widths = cols.map((w, i) => (expandCols.has(i) ? w + extra / expandCols.size : w));
    kids.forEach((c, i) => {
      c.inContainer = true;
      const col = i % this.columns;
      const row = Math.floor(i / this.columns);
      let x = 0;
      for (let k = 0; k < col; k++) x += widths[k] + this.hSep;
      let y = 0;
      for (let k = 0; k < row; k++) y += rows[k] + this.vSep;
      c.setRect({ x, y, w: widths[col], h: rows[row] });
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
