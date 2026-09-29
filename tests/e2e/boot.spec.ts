import { expect, test } from '@playwright/test';

type NB = {
  scene(): string;
  saveBackend(): string;
  audioState(): string;
  raw(): number[];
  size(): { w: number; h: number; scale: number };
};

test('boots to the click-to-start screen, then starts audio on click', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/');
  await page.waitForFunction(() => (window as unknown as { __nb?: NB }).__nb?.scene() === 'boot');
  const info = await page.evaluate(() => {
    const nb = (window as unknown as { __nb: NB }).__nb;
    return { size: nb.size(), backend: nb.saveBackend() };
  });
  // 1440x810 viewport -> exact 3x integer scale, like the original's default window.
  expect(info.size).toEqual({ w: 1440, h: 810, scale: 3 });
  expect(info.backend).toBe('local');
  // The 480x270 game image is the scene background (#1f1f1f) plus white text.
  const raw = await page.evaluate(() => (window as unknown as { __nb: NB }).__nb.raw());
  expect(raw.length).toBe(480 * 270 * 4);
  expect(raw.slice(0, 4)).toEqual([31, 31, 31, 255]);
  const white = raw.filter((_, i) => i % 4 === 0 && raw[i] === 220).length;
  expect(white).toBeGreaterThan(50);
  await page.screenshot({ path: 'test-results/boot.png' });
  await page.mouse.click(720, 405);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __nb: NB }).__nb.audioState())).toBe('running');
  await expect.poll(() => page.evaluate(() => (window as unknown as { __nb: NB }).__nb.scene())).toBe('shop');
  expect(errors).toEqual([]);
});
