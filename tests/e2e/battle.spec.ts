import { expect, test } from '@playwright/test';

type BattleInfo = { enemies: number; hp: number; elapsed: number; status: number | null; cursor: { x: number; y: number }; kills: number };
type NB = { scene(): string; busy(): boolean; battle(): BattleInfo | null; profile(): { sessions: number; achievements: Record<string, boolean> } };
const nb = (page: import('@playwright/test').Page) => page.evaluate(() => (window as unknown as { __nb: NB }).__nb.battle());

test('a session runs, follows the mouse, and TERMINATE ends it', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/');
  await page.waitForFunction(() => (window as unknown as { __nb?: NB }).__nb?.scene() === 'boot');
  await page.mouse.click(720, 405);
  await page.waitForFunction(() => (window as unknown as { __nb: NB }).__nb.scene() === 'menu');
  // No save yet: "new game" (108..186, 178..208) goes straight to the shop.
  await page.mouse.move(147 * 3, 193 * 3);
  await page.waitForTimeout(100);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForFunction(() => (window as unknown as { __nb: NB }).__nb.scene() === 'shop' && !(window as unknown as { __nb: NB }).__nb.busy());
  // Breach button at (376..448, 235..255) in game pixels.
  await page.mouse.move(412 * 3, 245 * 3);
  await page.waitForTimeout(100);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForFunction(() => (window as unknown as { __nb: NB }).__nb.scene() === 'battle' && !(window as unknown as { __nb: NB }).__nb.busy());
  // The reticle follows the mouse (game pixels = screen pixels / 3).
  for (let i = 0; i < 40; i++) {
    await page.mouse.move(720 + 300 * Math.sin(i / 6), 405 + 200 * Math.cos(i / 9));
    await page.waitForTimeout(100);
  }
  await page.mouse.move(600, 300);
  await page.waitForTimeout(200);
  const mid = await nb(page);
  expect(mid!.cursor.x).toBeCloseTo(200, 0);
  expect(mid!.cursor.y).toBeCloseTo(100, 0);
  expect(mid!.elapsed).toBeGreaterThan(3);
  expect(mid!.enemies).toBeGreaterThan(0);
  expect(mid!.hp).toBeLessThan(10);
  const prof = await page.evaluate(() => (window as unknown as { __nb: NB }).__nb.profile());
  expect(prof.sessions).toBe(1);
  expect(prof.achievements.FIRST_SESSION).toBe(true);
  // TERMINATE sits at (415..477, 237..257) in game pixels.
  await page.mouse.move(1338, 741);
  await page.waitForTimeout(100);
  await page.mouse.down();
  await page.mouse.up();
  await expect.poll(async () => (await nb(page))!.status).toBe(2);
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'test-results/battle-end.png' });
  // "new session": the end screen's second button, centred horizontally.
  await page.waitForTimeout(700);
  const box = await page.evaluate(() => (window as unknown as { __nb: NB }).__nb.battle());
  expect(box!.status).toBe(2);
  expect(errors).toEqual([]);
});
