// Screenshot comparison with the original. The Godot harness
// (node scripts/make-harness.mjs) renders the same scenarios from the original
// game into reference/captures/; these tests build them in the remake and diff
// the 480x270 game image. Results and diff images go to test-results/visual/.
import { expect, test } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

type NB = { scene(): string; raw(): number[]; tableau(s: unknown): void };
const scenarios = JSON.parse(readFileSync('tests/visual/scenarios.json', 'utf8')) as { name: string; scene: string; maxDiff?: number }[];
const OUT = 'test-results/visual';
mkdirSync(OUT, { recursive: true });
const report: Record<string, unknown> = {};

for (const s of scenarios) {
  const ref = `reference/captures/${s.name}.rawng.png`;
  test(`${s.name} matches the original (480x270, no glow)`, async ({ page }) => {
    test.skip(!existsSync(ref), 'no reference capture (run node scripts/make-harness.mjs)');
    await page.goto('/');
    await page.waitForFunction(() => (window as unknown as { __nb?: NB }).__nb?.scene() === 'boot');
    await page.evaluate((sc) => (window as unknown as { __nb: NB }).__nb.tableau(sc), s);
    await page.waitForTimeout(2000);
    const raw = await page.evaluate(() => (window as unknown as { __nb: NB }).__nb.raw());
    const ours = new PNG({ width: 480, height: 270 });
    ours.data = Buffer.from(raw);
    const theirs = PNG.sync.read(readFileSync(ref));
    const diff = new PNG({ width: 480, height: 270 });
    const n = pixelmatch(theirs.data, ours.data, diff.data, 480, 270, { threshold: 0.1, includeAA: true });
    writeFileSync(`${OUT}/${s.name}.ours.png`, PNG.sync.write(ours));
    writeFileSync(`${OUT}/${s.name}.diff.png`, PNG.sync.write(diff));
    const pct = (100 * n) / (480 * 270);
    report[s.name] = { differentPixels: n, percent: Number(pct.toFixed(3)) };
    writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
    expect(pct, `${s.name}: ${n} pixels differ`).toBeLessThanOrEqual(s.maxDiff ?? 0.05);
  });
}
