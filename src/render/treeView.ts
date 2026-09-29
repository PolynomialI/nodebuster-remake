// The skill tree (res://Scripts/Shop/UpgradeTree.gd, UpgradeNode.gd,
// UpgradesPage.gd): nodes at their tree positions, 1 px connection lines between
// visible nodes, outline colours by state, pan (right-drag, WASD/arrows) and
// zoom (wheel: 1, 0.75, 0.5) with the original's clamping.
import { Container, Graphics } from 'pixi.js';
import { content, color, type UpgradeNode } from '../data/content';
import { easeOutQuad } from '../sim/geometry';
import type { Profile } from '../sim/profile';
import { canBuy, isMaxed, isUnlocked, levelOf } from '../sim/shop';
import { tex } from '../ui/ctx';
import { SpringValue } from '../ui/spring';
import { UpgradeIconView } from '../ui/tooltip';
import { lerpColor, BG, type Interactive } from '../ui/widgets';

const SW = 480;
const SH = 270;
const PAN_SPEED = 260;
const SCALES = [1, 0.75, 0.5];

export class NodeView implements Interactive {
  readonly icon = new UpgradeIconView();
  readonly view = new Container();
  readonly scaleS = new SpringValue(1);
  readonly rotS = new SpringValue(0);
  visible = false;
  onEnterCb: () => void = () => {};
  onExitCb: () => void = () => {};
  onClickCb: () => void = () => {};

  constructor(
    readonly node: UpgradeNode,
    private tree: TreeView,
  ) {
    this.view.position.set(node.pos[0], node.pos[1]);
    this.icon.setRect({ x: 0, y: 0, w: node.size[0], h: node.size[1] });
    this.icon.texture = tex(node.icon);
    this.view.addChild(this.icon.view);
  }

  center(): { x: number; y: number } {
    return { x: this.node.pos[0] + this.node.size[0] / 2, y: this.node.pos[1] + this.node.size[1] / 2 };
  }

  /** Screen rect of the node's Control (position scaled by the tree, size not, as in Godot). */
  screenRect(): { x: number; y: number; w: number; h: number } {
    const t = this.tree;
    return { x: t.pos.x + this.node.pos[0] * t.scale, y: t.pos.y + this.node.pos[1] * t.scale, w: this.node.size[0], h: this.node.size[1] };
  }

  contains(gx: number, gy: number): boolean {
    if (!this.visible) return false;
    const t = this.tree;
    const lx = (gx - t.pos.x) / t.scale - this.node.pos[0];
    const ly = (gy - t.pos.y) / t.scale - this.node.pos[1];
    return lx >= 0 && ly >= 0 && lx < this.node.size[0] && ly < this.node.size[1];
  }

  onEnter(): void {
    this.onEnterCb();
  }
  onExit(): void {
    this.onExitCb();
  }
  onDown(): void {
    this.tree.sfx('BUTTON_DOWN');
  }
  onUp(): void {
    this.tree.sfx('BUTTON_UP');
  }
  onClick(): void {
    this.onClickCb();
  }

  /** UpgradeIcon.setup_outline_color + the level-0 dimming from update_upgrade_visiblity. */
  refresh(p: Profile, palette: number): void {
    const n = this.node;
    let c: number;
    if (isMaxed(p, n)) c = color(palette === 0 ? 'YELLOW' : 'VIOLET');
    else if (canBuy(p, n)) c = color('GREEN');
    else c = color(palette === 0 ? 'RED' : 'DARK_RED');
    if (c !== this.icon.outline) {
      this.icon.outline = c;
      this.icon.redraw();
    }
    this.view.tint = levelOf(p, n.id) === 0 ? lerpColor(0xffffff, BG, 0.5) : 0xffffff;
  }

  /** UpgradeNode.spring(): icon pops (scale +0.4) and twists 12 degrees. */
  spring(): void {
    this.scaleS.pull(0.4, 250, 12);
    this.rotS.pull(12, 600, 14).range(-100, 100);
  }

  update(dt: number): void {
    this.scaleS.update(dt);
    this.rotS.update(dt);
    const v = this.icon.view;
    // UpgradeIcon pivot_offset (8, 8).
    v.pivot.set(8, 8);
    v.position.set(8, 8);
    v.scale.set(this.scaleS.value);
    v.angle = this.rotS.value;
  }
}

export class TreeView {
  readonly view = new Container();
  private lines = new Graphics();
  readonly nodes: NodeView[] = [];
  private byId = new Map<string, NodeView>();
  pos = { x: 0, y: 0 };
  private realPos = { x: 0, y: 0 };
  scale = 1;
  private zoomIndex = 0;
  private zoom: { t: number; fromS: number; toS: number; fromP: { x: number; y: number }; toP: { x: number; y: number } } | null = null;
  private topLeft = { x: 999, y: 999 };
  private botRight = { x: -999, y: -999 };
  sfx: (name: string) => void = () => {};
  onMoved: (pos: { x: number; y: number }) => void = () => {};

  constructor(
    private profile: () => Profile,
    private palette: () => number,
  ) {
    this.view.addChild(this.lines);
    for (const n of content.upgrades.nodes) {
      const v = new NodeView(n, this);
      this.nodes.push(v);
      this.byId.set(n.id, v);
      this.view.addChild(v.view);
    }
    this.refreshAll();
  }

  get(id: string): NodeView | undefined {
    return this.byId.get(id);
  }

  /** update_upgrade_visiblity for every node, lines and the tree bounds. */
  refreshAll(): void {
    const p = this.profile();
    for (const v of this.nodes) {
      v.visible = isUnlocked(p, v.node);
      v.view.visible = v.visible;
      v.refresh(p, this.palette());
      if (v.visible) {
        this.topLeft.x = Math.min(this.topLeft.x, v.node.pos[0]);
        this.topLeft.y = Math.min(this.topLeft.y, v.node.pos[1]);
        this.botRight.x = Math.max(this.botRight.x, v.node.pos[0] + v.node.size[0]);
        this.botRight.y = Math.max(this.botRight.y, v.node.pos[1] + v.node.size[1]);
      }
    }
    this.drawLines();
  }

  private drawLines(): void {
    const g = this.lines;
    g.clear();
    const done = new Set<string>();
    for (const v of this.nodes) {
      for (const id of v.node.links) {
        const key = [v.node.id, id].sort().join('|');
        if (done.has(key)) continue;
        done.add(key);
        const o = this.byId.get(id)!;
        if (!v.visible || !o.visible) continue;
        const a = v.center();
        const b = o.center();
        g.moveTo(a.x, a.y).lineTo(b.x, b.y);
      }
    }
    g.stroke({ width: 1, color: color('WHITE') });
  }

  /** UpgradeTree.set_tree_pos: keep visible nodes within 100 px of the screen. */
  setPos(x: number, y: number): void {
    const H_OFF = 100;
    const V_OFF = 100;
    if (x + this.botRight.x < H_OFF) x = H_OFF - this.botRight.x;
    if (y + this.botRight.y < V_OFF) y = V_OFF - this.botRight.y;
    if (x + this.topLeft.x >= SW - H_OFF) x = SW - H_OFF - this.topLeft.x;
    if (y + this.topLeft.y >= SH - V_OFF) y = SH - V_OFF - this.topLeft.y;
    this.realPos = { x, y };
    this.pos = { x: Math.round(x), y: Math.round(y) };
    this.view.position.set(this.pos.x, this.pos.y);
    this.onMoved(this.realPos);
  }

  move(dx: number, dy: number): void {
    this.setPos(this.realPos.x + dx, this.realPos.y + dy);
  }

  /** Mouse wheel: scale steps 1, 0.75, 0.5, keeping the point under the mouse. */
  zoomBy(dir: number, mouse: { x: number; y: number }): void {
    this.zoomIndex = Math.min(Math.max(this.zoomIndex + dir, 0), SCALES.length - 1);
    const target = SCALES[this.zoomIndex];
    const diff = this.scale - target;
    const local = { x: (mouse.x - this.pos.x) / this.scale, y: (mouse.y - this.pos.y) / this.scale };
    this.zoom = { t: 0, fromS: this.scale, toS: target, fromP: { ...this.pos }, toP: { x: this.pos.x + local.x * diff, y: this.pos.y + local.y * diff } };
  }

  update(dt: number, keys: { left: boolean; right: boolean; up: boolean; down: boolean }): void {
    let hx = (keys.left ? 1 : 0) - (keys.right ? 1 : 0);
    let vy = (keys.up ? 1 : 0) - (keys.down ? 1 : 0);
    const len = Math.hypot(hx, vy);
    if (len > 0) {
      hx /= len;
      vy /= len;
    }
    // UpgradesPage._process always calls move_tree (which also re-applies the clamp).
    this.move(hx * dt * PAN_SPEED, vy * dt * PAN_SPEED);
    if (this.zoom) {
      const z = this.zoom;
      z.t = Math.min(z.t + dt / 0.2, 1);
      const k = easeOutQuad(z.t);
      this.scale = z.fromS + (z.toS - z.fromS) * k;
      this.view.scale.set(this.scale);
      this.setPos(z.fromP.x + (z.toP.x - z.fromP.x) * k, z.fromP.y + (z.toP.y - z.fromP.y) * k);
      if (z.t >= 1) this.zoom = null;
    }
    for (const n of this.nodes) n.update(dt);
  }
}
