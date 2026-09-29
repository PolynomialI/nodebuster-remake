// The home screen (res://GameScenes/ShopScene.tscn, Scripts/Shop/ShopScene.gd):
// tab bar, resource panels, the skill tree page (other pages in meta phases),
// the upgrade tooltip and the Breach button.
import { Container } from 'pixi.js';
import { RMB } from '../core/input';
import { color, content, CURRENCIES, t, type Currency } from '../data/content';
import type { Game } from '../game';
import { TreeView, type NodeView } from '../render/treeView';
import { buy } from '../sim/shop';
import { features, type Feature } from '../sim/stats';
import { HBox, Root, VBox } from '../ui/control';
import { Pointer } from '../ui/pointer';
import { ResourcePanel } from '../ui/resourcePanel';
import { Tooltip, UpgradeDescription } from '../ui/tooltip';
import { BG, solid, TextButton } from '../ui/widgets';
import type { Scene } from './scene';

const PAGES = ['upgrades', 'milestones', 'cryptomine', 'lab', 'stats'] as const;
type Page = (typeof PAGES)[number];

export class ShopScene implements Scene {
  readonly name = 'shop';
  readonly root = new Container();
  readonly pointer = new Pointer();
  readonly tree: TreeView;
  readonly ui = new Root(480, 270);
  private tabs: Record<Page, TextButton>;
  private panels: ResourcePanel[] = [];
  private description: UpgradeDescription;
  private tooltip = new Tooltip();
  private breach: TextButton;
  page: Page = 'upgrades';
  private pages: Record<Page, Container>;
  private rmbDown = false;
  private labHue = 0;
  private readonly labBase = 0xc949a9;

  constructor(private game: Game) {
    const g = game;
    this.root.addChild(solid(-135, -85, 776, 476, BG));
    // Pages
    this.tree = new TreeView(
      () => g.profile,
      () => g.options.color_palette,
    );
    this.tree.sfx = (n) => g.sfx(n);
    this.pages = { upgrades: new Container(), milestones: new Container(), cryptomine: new Container(), lab: new Container(), stats: new Container() };
    this.pages.upgrades.addChild(this.tree.view);
    for (const p of PAGES) this.root.addChild(this.pages[p]);
    this.tree.setPos(0, 0);
    // Tabs (TabButtons HBox at 6,6 - 86,25)
    const tabBox = this.ui.add(new HBox());
    tabBox.place(6, 6, 86, 25);
    const names: Record<Page, string> = { upgrades: t('shop.tab.upgrades'), milestones: t('shop.tab.milestones'), cryptomine: t('shop.tab.cryptomine'), lab: t('shop.tab.lab'), stats: t('shop.tab.stats') };
    this.tabs = {} as Record<Page, TextButton>;
    for (const p of PAGES) {
      const b = tabBox.add(new TextButton(names[p], p === 'lab' ? 0xc949a9 : undefined));
      b.customMin = { w: 80, h: 0 };
      b.onPressed = () => this.setPage(p);
      this.tabs[p] = b;
      this.pointer.register(b);
    }
    // Resource panels (VBox at 17,36 - 90,36, separation 1)
    const res = this.ui.add(new VBox(1));
    res.place(17, 36, 90, 36);
    for (const c of CURRENCIES) {
      const panel = res.add(new ResourcePanel(c));
      panel.onHover = () => this.showResourceTooltip(panel);
      panel.onUnhover = () => this.tooltip.hide();
      this.panels.push(panel);
      this.pointer.register(panel);
    }
    this.root.addChild(this.ui.view);
    // Upgrade tooltip, then Breach (drawn above the tooltip, as in the scene order).
    this.description = new UpgradeDescription(() => g.profile);
    this.root.addChild(this.description.root.view);
    const bRoot = new Root(480, 270);
    this.breach = bRoot.add(new TextButton(t('shop.breach')));
    this.breach.place(376, 235, 448, 255);
    this.breach.onPressed = () => g.breach();
    this.pointer.register(this.breach);
    bRoot.layout();
    this.root.addChild(bRoot.view);
    this.root.addChild(this.tooltip.root.view);
    // Tree nodes are hover/click targets (registered after the UI so panels win when overlapping).
    for (const v of this.tree.nodes) this.hookNode(v);
    this.pointer.registerFirst(...this.tree.nodes);
    this.refreshTabs();
    this.setPage('upgrades');
    this.syncPanels();
    this.ui.layout();
    this.ui.layout();
  }

  private hookNode(v: NodeView): void {
    v.onEnterCb = () => {
      this.description.showFor(v.node, () => v.screenRect());
      this.game.sfx('BUTTON_HOVER', { pitchRange: 0.1 });
    };
    v.onExitCb = () => this.description.hide();
    v.onClickCb = () => this.buy(v);
  }

  private buy(v: NodeView): void {
    const g = this.game;
    const before = features(g.profile.upgrades);
    if (!buy(g.profile, v.node)) return;
    this.panels.find((p) => p.currency === v.node.currency)?.squash();
    this.description.refresh();
    this.description.springLevelUp();
    v.spring();
    this.tree.refreshAll();
    const after = features(g.profile.upgrades);
    for (const f of after) if (!before.has(f)) this.onFeature(f);
  }

  private onFeature(f: Feature): void {
    this.refreshTabs();
    this.game.checkAchievements('feature');
  }

  private refreshTabs(): void {
    const f = features(this.game.profile.upgrades);
    const shown: Record<Page, boolean> = { upgrades: true, milestones: f.has('milestones'), cryptomine: f.has('cryptomine'), lab: f.has('lab'), stats: false };
    for (const p of PAGES) this.tabs[p].setVisible(shown[p]);
    this.ui.layout();
  }

  setPage(p: Page): void {
    for (const q of PAGES) {
      this.tabs[q].setEnabled(q !== p);
      this.pages[q].visible = q === p;
    }
    this.page = p;
    this.description.hide();
  }

  private showResourceTooltip(panel: ResourcePanel): void {
    const c = panel.currency;
    const name = `[icon:${c}] [color=${content.palette.colors[content.palette.currency[c]]}]${t(`resource.${c}`)}[/color]`;
    this.tooltip.setText(t(`tooltip.${c}`, name));
    this.tooltip.centerAboveOrBelow(panelScreenRect(panel));
    this.game.sfx('BUTTON_HOVER');
  }

  private syncPanels(): void {
    const p = this.game.profile;
    const page = this.page;
    const vis: Record<Currency, boolean> = {
      bits: page === 'upgrades' || page === 'cryptomine',
      nodes: p.nodes_unlocked && page === 'upgrades',
      cores: p.cores_unlocked && page === 'upgrades',
      sp: p.sp_unlocked && page === 'upgrades',
      netcoin: p.netcoin_unlocked && (page === 'upgrades' || page === 'cryptomine' || page === 'lab'),
      processors: p.processors_unlocked && (page === 'upgrades' || page === 'cryptomine'),
    };
    let changed = false;
    for (const panel of this.panels) {
      const v = vis[panel.currency];
      if (v !== panel.visible) {
        panel.setVisible(v);
        changed = true;
      }
      panel.set(p[panel.currency]);
    }
    if (changed) this.ui.layout();
  }

  update(dt: number): void {
    const input = this.game.input;
    // Right-drag pans the tree (and blocks other hovers while held).
    if (input.pressed.has(RMB) && this.page === 'upgrades') {
      this.rmbDown = true;
      this.pointer.lock();
      this.game.sfx('MOUSE_DOWN');
    }
    if (input.released.has(RMB) && this.rmbDown) {
      this.rmbDown = false;
      this.pointer.unlock();
      this.game.sfx('MOUSE_UP');
    }
    if (this.page === 'upgrades') {
      if (this.rmbDown) this.tree.move(input.motion.x, input.motion.y);
      if (input.wheel && !this.pointer.locked) this.tree.zoomBy(input.wheel > 0 ? 1 : -1, input.mouse);
      const k = input.keys;
      this.tree.update(dt, { left: k.has('KeyA') || k.has('ArrowLeft'), right: k.has('KeyD') || k.has('ArrowRight'), up: k.has('KeyW') || k.has('ArrowUp'), down: k.has('KeyS') || k.has('ArrowDown') });
    }
    this.pointer.update(input);
    this.syncPanels();
    for (const p of PAGES) this.tabs[p].update(dt);
    // lab_btn.main_color.h += delta * 0.2 (kept as a float hue, like Godot's Color).
    this.labHue = (this.labHue + dt * 0.2) % 1;
    this.tabs.lab.mainColor = hueStep(this.labBase, this.labHue);
    if (this.tabs.lab.visible) this.tabs.lab.redraw();
    for (const panel of this.panels) panel.update(dt);
    this.breach.update(dt);
    this.description.update(dt);
    this.tooltip.update(dt);
    for (const v of this.tree.nodes) v.refresh(this.game.profile, this.game.options.color_palette);
  }
}

function panelScreenRect(c: { view: Container; rect: { w: number; h: number } }): { x: number; y: number; w: number; h: number } {
  const p = c.view.getGlobalPosition();
  const piv = c.view.pivot;
  return { x: p.x - piv.x, y: p.y - piv.y, w: c.rect.w, h: c.rect.h };
}

function hueStep(rgb: number, turns: number): number {
  const r = ((rgb >> 16) & 255) / 255;
  const g = ((rgb >> 8) & 255) / 255;
  const b = (rgb & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (((h / 6 + turns) % 1) + 1) % 1;
  const s = max ? d / max : 0;
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const v = max;
  const [R, G, B] = [[v, v * (1 - (1 - f) * s), v * (1 - s)], [v * (1 - f * s), v, v * (1 - s)], [v * (1 - s), v, v * (1 - (1 - f) * s)], [v * (1 - s), v * (1 - f * s), v], [v * (1 - (1 - f) * s), v * (1 - s), v], [v, v * (1 - s), v * (1 - f * s)]][i % 6];
  return (Math.round(R * 255) << 16) | (Math.round(G * 255) << 8) | Math.round(B * 255);
}

export { color };
