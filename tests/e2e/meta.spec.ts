// Meta features played through the mouse and keyboard: Milestones, the Crypto
// Mine, the Lab and the godvirus ending, the prestige picker and the Escape menu.
// Screen positions are game pixels x3 (1440x810 viewport); the layouts they rely
// on are checked against the original by visual.spec.ts.
import { expect, test, type Page } from '@playwright/test';

type Profile = {
  bits: number;
  netcoin: number;
  curr_prestige: number;
  virus_deployed: boolean;
  lab_research_progress: number;
  crypto_mine: { mine_level: number; curr_bits: number };
  milestones: Record<string, boolean>;
  achievements: Record<string, boolean>;
};
type NB = {
  scene(): string;
  busy(): boolean;
  tableau(s: unknown): void;
  resume(): void;
  advance(n: number): void;
  popups(): number;
  endingFrames(): number;
  profile(): Profile;
  shop(): { page: string; dot: boolean } | null;
};

const nb = <T>(page: Page, f: (n: NB) => T): Promise<T> => page.evaluate(`(${f.toString()})(window.__nb)`) as Promise<T>;

async function click(page: Page, x: number, y: number): Promise<void> {
  await page.mouse.move(x * 3, y * 3);
  await page.waitForTimeout(80);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(80);
}

async function start(page: Page, profile: Record<string, unknown>, shop: Record<string, unknown> = {}): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/');
  await page.waitForFunction(() => (window as unknown as { __nb?: NB }).__nb?.scene() === 'boot');
  await page.mouse.click(10, 10);
  await page.waitForFunction(() => (window as unknown as { __nb: NB }).__nb.scene() === 'menu');
  await page.evaluate(
    ([p, s]) => {
      const n = (window as unknown as { __nb: NB }).__nb;
      n.tableau({ name: 'e2e', scene: 'shop', profile: p, shop: s });
      n.resume();
    },
    [profile, shop] as const,
  );
  await page.waitForTimeout(100);
  return errors;
}

test('claiming a milestone pays the reward and clears the notification dot', async ({ page }) => {
  const errors = await start(page, { bits: 100, upgrades: { Damage1: 1, Milestones: 1 }, nums: { reds_killed: 600, enemies_killed: 600 } });
  expect((await nb(page, (n) => n.shop()))!.dot).toBe(true);
  await click(page, 130, 15); // Milestones tab
  expect((await nb(page, (n) => n.shop()))!.page).toBe('milestones');
  await click(page, 334, 54); // RED DEFEATER: claim
  const p = await nb(page, (n) => n.profile());
  expect(p.milestones.Reds500).toBe(true);
  expect(p.bits).toBe(600);
  expect((await nb(page, (n) => n.shop()))!.dot).toBe(false);
  expect(errors).toEqual([]);
});

test('the Crypto Mine converts deposited Bits into Netcoin over time', async ({ page }) => {
  const errors = await start(page, { bits: 5000, processors: 3, upgrades: { Damage1: 1, CryptoMine: 1 } }, { page: 2 });
  await click(page, 147, 159); // deposit 1k
  let p = await nb(page, (n) => n.profile());
  expect(p.bits).toBe(4000);
  expect(p.crypto_mine.curr_bits).toBeGreaterThan(990);
  // One second of mining in a single synchronous call (no real frames in between).
  const [a, b] = await nb(page, (n) => {
    const x = n.profile();
    n.advance(60);
    return [x, n.profile()];
  });
  // Level 0 converts 5 Bits/s at 0.00001 Netcoin per Bit.
  expect(a.crypto_mine.curr_bits - b.crypto_mine.curr_bits).toBeCloseTo(5, 6);
  expect(b.netcoin - a.netcoin).toBeCloseTo(0.00005, 9);
  await click(page, 210, 231); // upgrade speed (1 Processor)
  p = await nb(page, (n) => n.profile());
  expect(p.crypto_mine.mine_level).toBe(1);
  expect(errors).toEqual([]);
});

test('researching and deploying the godvirus plays the ending, then the main menu', async ({ page }) => {
  const errors = await start(page, { netcoin: 1000, upgrades: { Damage1: 1, CryptoMine: 1, Laboratory: 1 } }, { page: 3 });
  await click(page, 210, 157); // deposit Netcoin
  await nb(page, (n) => n.advance(40));
  let p = await nb(page, (n) => n.profile());
  expect(p.lab_research_progress).toBe(1000);
  expect(p.netcoin).toBe(0);
  await click(page, 210, 209); // deploy virus
  p = await nb(page, (n) => n.profile());
  expect(p.virus_deployed).toBe(true);
  expect(await nb(page, (n) => n.endingFrames())).toBeGreaterThanOrEqual(0);
  // "virus deployed!" (and the Genesis achievement) 241 frames in.
  await nb(page, (n) => n.advance(260));
  p = await nb(page, (n) => n.profile());
  expect(p.achievements.DEPLOY_GODVIRUS).toBe(true);
  // Freeze, credits, then back to the main menu on the 2856th frame.
  const left = await nb(page, (n) => {
    const done = n.endingFrames();
    n.advance(2855 - done);
    return n.scene();
  });
  expect(left).toBe('shop');
  await nb(page, (n) => n.advance(1));
  expect(await nb(page, (n) => n.scene())).toBe('menu');
  expect(errors).toEqual([]);
});

test('Breach opens the prestige picker; Escape opens the game menu', async ({ page }) => {
  const errors = await start(page, { curr_prestige: 1, max_prestige: 3, upgrades: { Damage1: 1 } });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  expect(await nb(page, (n) => n.popups())).toBe(1);
  await click(page, 240, 166); // back (bottom of the 166x77 menu)
  expect(await nb(page, (n) => n.popups())).toBe(0);
  await click(page, 412, 245); // Breach
  await page.waitForTimeout(300);
  expect(await nb(page, (n) => n.popups())).toBe(1);
  await click(page, 249, 136); // +
  expect((await nb(page, (n) => n.profile())).curr_prestige).toBe(2);
  await click(page, 240, 175); // start session
  await page.waitForFunction(() => (window as unknown as { __nb: NB }).__nb.scene() === 'battle' && !(window as unknown as { __nb: NB }).__nb.busy());
  expect(await nb(page, (n) => n.popups())).toBe(0);
  expect((await nb(page, (n) => n.profile())).curr_prestige).toBe(2);
  expect(errors).toEqual([]);
});
