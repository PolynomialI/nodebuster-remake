import { expect, test } from '@playwright/test';

type Shop = { treePos: { x: number; y: number }; scale: number; visible: string[]; page: string };
type NB = { scene(): string; tableau(s: unknown): void; shop(): Shop | null; profile(): { bits: number; upgrades: Record<string, number> } };
const call = <T>(page: import('@playwright/test').Page, f: (nb: NB) => T) => page.evaluate(f as never) as Promise<T>;

test('buying, panning and zooming the skill tree', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.waitForFunction(() => (window as unknown as { __nb?: NB }).__nb?.scene() === 'boot');
  await page.evaluate(() => (window as unknown as { __nb: NB }).__nb.tableau({ name: 'e2e', scene: 'shop', profile: { bits: 10 } }));
  await page.waitForTimeout(300);
  let shop = await page.evaluate(() => (window as unknown as { __nb: NB }).__nb.shop());
  expect(shop!.visible).toEqual(['Damage1']);
  // power sits at tree (215,133), 16x16; screen = game * 3.
  await page.mouse.move((215 + 8) * 3, (133 + 8) * 3);
  await page.waitForTimeout(100);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(100);
  const prof = await page.evaluate(() => (window as unknown as { __nb: NB }).__nb.profile());
  expect(prof.upgrades.Damage1).toBe(1);
  expect(prof.bits).toBe(9);
  shop = await page.evaluate(() => (window as unknown as { __nb: NB }).__nb.shop());
  expect([...shop!.visible].sort()).toEqual(['Damage1', 'DamagePerEnemy1', 'Health1', 'SpawnRate1']);
  await page.screenshot({ path: 'test-results/shop-bought.png' });
  // Arrow left moves the tree right at 260 px/s.
  await page.keyboard.down('ArrowLeft');
  await page.waitForTimeout(250);
  await page.keyboard.up('ArrowLeft');
  shop = await page.evaluate(() => (window as unknown as { __nb: NB }).__nb.shop());
  expect(shop!.treePos.x).toBeGreaterThan(20);
  // Wheel down zooms out to 0.75.
  await page.mouse.move(720, 405);
  await page.mouse.wheel(0, 100);
  await page.waitForTimeout(400);
  shop = await page.evaluate(() => (window as unknown as { __nb: NB }).__nb.shop());
  expect(shop!.scale).toBeCloseTo(0.75, 5);
  expect(errors).toEqual([]);
  void call;
});
