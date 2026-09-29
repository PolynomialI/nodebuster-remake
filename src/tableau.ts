// Builds the scenarios in tests/visual/scenarios.json (the same ones the Godot
// harness captures from the original) so screenshots can be compared 1:1.
import type { Game } from './game';
import { BattleScene } from './scenes/battleScene';
import { ShopScene } from './scenes/shopScene';
import { setCurrency } from './sim/profile';
import type { Currency } from './data/content';
import { newProfile, type Profile } from './sim/profile';

export interface BattleInitScenario {
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
  shop?: { treePos?: [number, number]; page?: number; hover?: string; waitFrames?: number };
  options?: Record<string, number>;
}

export function applyTableau(game: Game, s: BattleInitScenario): void {
  const p = { ...newProfile(), ...(s.profile ?? {}) } as Profile;
  p.upgrades = { ...(s.profile?.upgrades ?? {}) };
  p.nums = { ...newProfile().nums, ...(s.profile?.nums ?? {}) };
  // Currency setters derive the *_unlocked flags, as State.set() does in the harness.
  for (const c of ['bits', 'nodes', 'cores', 'sp', 'netcoin', 'processors'] as const) {
    const v = p[c];
    p[c] = 0;
    setCurrency(p, c, v);
  }
  game.profile = p;
  for (const o of ['color_palette', 'flashing_fx', 'transition_color']) game.options[o] = s.options?.[o] ?? 0;
  if (s.scene === 'shop') {
    const shop = new ShopScene(game);
    game.swapScene(shop);
    if (s.shop?.treePos) shop.tree.setPos(s.shop.treePos[0], s.shop.treePos[1]);
    if (s.shop?.page !== undefined) shop.setPage((['upgrades', 'milestones', 'cryptomine', 'lab', 'stats'] as const)[s.shop.page]);
    if (s.shop?.hover) shop.tree.get(s.shop.hover)?.onEnter();
    return;
  }
  if (s.scene !== 'battle' || !s.battle) return;
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
