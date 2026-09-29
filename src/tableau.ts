// Builds the scenarios in tests/visual/scenarios.json (the same ones the Godot
// harness captures from the original) so screenshots can be compared 1:1.
// Shop scenes are stepped for exactly as many 60 Hz frames as the harness lets
// the original run before its glow-free capture, then frozen.
import { STEP } from './core/loop';
import type { Currency } from './data/content';
import type { Game } from './game';
import { BattleScene } from './scenes/battleScene';
import { ShopScene } from './scenes/shopScene';
import { newProfile, setCurrency, type Profile } from './sim/profile';
import { clearMouseLocks } from './ui/pointer';

export interface Scenario {
  name: string;
  scene: 'battle' | 'menu' | 'shop';
  time?: number;
  profile?: Partial<Profile>;
  battle?: {
    cursor: [number, number];
    hp?: number;
    xp?: number;
    progress?: number;
    enemies?: { type: string; currency: Currency; x: number; y: number; rot: number; scale: number; hp: number }[];
    drops?: { currency: Currency; x: number; y: number }[];
    end?: { status: 0 | 1 | 2; collected: Partial<Record<Currency, number>> };
  };
  shop?: { treePos?: [number, number]; page?: number; hover?: string; waitFrames?: number; popup?: 'prestige' };
  /** Deploy the godvirus after the shop is built; `frames` are capture points after the press. */
  ending?: { frames: number[] };
  options?: Record<string, number>;
}

const PAGE_IDS = ['upgrades', 'milestones', 'cryptomine', 'lab', 'stats'] as const;

/** `frame` selects one of `ending.frames` (each is captured separately). */
export function applyTableau(game: Game, s: Scenario, frame?: number): void {
  // run_scenario: clear popups and mouse locks, reset the profile, freeze the mine.
  game.frozen = true;
  game.mineFrozen = true;
  game.popups.clear();
  game.hideTooltip();
  clearMouseLocks();
  const p = { ...newProfile(), ...(s.profile ?? {}) } as Profile;
  p.upgrades = { ...(s.profile?.upgrades ?? {}) };
  p.milestones = { ...(s.profile?.milestones ?? {}) };
  p.nums = { ...newProfile().nums, ...(s.profile?.nums ?? {}) };
  p.crypto_mine = { ...newProfile().crypto_mine, ...(s.profile?.crypto_mine ?? {}) };
  // Currency setters derive the *_unlocked flags, as State.set() does in the harness.
  for (const c of ['bits', 'nodes', 'cores', 'sp', 'netcoin', 'processors'] as const) {
    const v = p[c];
    p[c] = 0;
    setCurrency(p, c, v);
  }
  game.profile = p;
  for (const o of ['color_palette', 'flashing_fx', 'transition_color']) game.options[o] = s.options?.[o] ?? 0;
  const step = (n: number) => {
    for (let i = 0; i < n; i++) {
      game.step(STEP);
      game.input.endStep();
    }
  };
  if (s.scene === 'shop') {
    // build_shop: enter() (first frame), frames(2), then set up the page/popup/hover.
    const shop = new ShopScene(game);
    game.swapScene(shop);
    step(2);
    const sp = s.shop ?? {};
    if (sp.treePos) shop.tree.setPos(sp.treePos[0], sp.treePos[1]);
    if (sp.page !== undefined) shop.setPage(PAGE_IDS[sp.page]);
    if (sp.popup === 'prestige') game.breach();
    if (sp.hover) shop.tree.get(sp.hover)?.onEnter();
    const wait = sp.waitFrames ?? 60;
    if (s.ending) {
      // frames(wait), deploy; capture k (glow off) lands f_k + 6k + 2 frames later.
      step(wait);
      shop.lab.onDeploy();
      const k = Math.max(0, s.ending.frames.indexOf(frame ?? s.ending.frames[0]));
      step(s.ending.frames[k] + 6 * k + 3);
      return;
    }
    // frames(wait), then capture(): frames(2) + draw (raw), frames(2) + draw (no glow).
    step(wait + 5);
    return;
  }
  if (s.scene !== 'battle' || !s.battle) return;
  game.frozen = false;
  const b = s.battle;
  const scene = new BattleScene(game, 1);
  scene.frozen = true;
  const sim = scene.sim;
  sim.enemies = [];
  sim.cursor = { x: b.cursor[0], y: b.cursor[1] };
  if (b.hp !== undefined) sim.hp = b.hp;
  if (b.xp !== undefined) sim.xp = b.xp;
  if (b.progress !== undefined) sim.progress = b.progress;
  for (const e of b.enemies ?? []) {
    const en = e.type === 'Boss' ? sim.spawnBoss() : sim.spawnEnemy(e.currency, e.type);
    en.x = e.x;
    en.y = e.y;
    en.rotation = (e.rot * Math.PI) / 180;
    en.scale = e.scale;
    en.maxHp = 100;
    en.hp = 100 * e.hp;
  }
  for (const d of b.drops ?? []) sim.drops.push({ id: 100000 + sim.drops.length, currency: d.currency, x: d.x, y: d.y, phase: 'idle', t: 0, fromX: 0, fromY: 0, toX: 0, toY: 0 });
  game.swapScene(scene);
  if (b.end) {
    for (const [c, n] of Object.entries(b.end.collected)) sim.collected.set(c as Currency, n as number);
    sim.forceEnd(b.end.status);
    scene.view.handle(sim.events);
  }
}
