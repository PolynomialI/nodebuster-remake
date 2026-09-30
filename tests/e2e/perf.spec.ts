// Frame pacing during a live session with the full post chain (glow, CRT), at the
// original's 3x window and at 2560x1440. Report-only on this machine: it writes
// test-results/perf.json and fails only if frames stall outright.
import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

type NB = { scene(): string; busy(): boolean; tableau(s: unknown): void; resume(): void };

const results: Record<string, unknown> = {};

for (const [w, h] of [
  [1440, 810],
  [2560, 1440],
] as const) {
  test(`frame pacing at ${w}x${h}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await page.goto('/');
    await page.waitForFunction(() => (window as unknown as { __nb?: NB }).__nb?.scene() === 'boot');
    await page.mouse.click(10, 10);
    await page.waitForFunction(() => (window as unknown as { __nb: NB }).__nb.scene() === 'menu');
    // A busy mid-game session: many enemies, bolts and drones.
    await page.evaluate(() => {
      const nb = (window as unknown as { __nb: NB }).__nb;
      nb.tableau({ name: 'perf', scene: 'battle', profile: { upgrades: { Damage1: 15, SpawnRate1: 15, SpawnRate2: 5, SpawnRate3: 5, Size1: 10, PulseBolts1: 3, Health1: 10 } }, battle: { cursor: [240, 135] } });
      nb.resume();
    });
    await page.mouse.move(w / 2, h / 2);
    const stats = await page.evaluate(
      () =>
        new Promise<{ frames: number; mean: number; p95: number; max: number }>((resolve) => {
          const times: number[] = [];
          let last = performance.now();
          const start = last;
          const tick = (now: number) => {
            times.push(now - last);
            last = now;
            if (now - start < 4000) requestAnimationFrame(tick);
            else {
              times.shift();
              times.sort((a, b) => a - b);
              resolve({ frames: times.length, mean: times.reduce((a, b) => a + b, 0) / times.length, p95: times[Math.floor(times.length * 0.95)], max: times[times.length - 1] });
            }
          };
          requestAnimationFrame(tick);
        }),
    );
    results[`${w}x${h}`] = stats;
    mkdirSync('test-results', { recursive: true });
    writeFileSync('test-results/perf.json', JSON.stringify(results, null, 2));
    expect(stats.frames).toBeGreaterThan(60);
  });
}
