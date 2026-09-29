// Screenshot comparison with the original. The Godot harness
// (node scripts/make-harness.mjs) renders the same scenarios from the original
// game into reference/captures/; these tests build them in the remake and diff
// the 480x270 game image. Results and diff images go to test-results/visual/.
import { expect, test } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

type NB = { scene(): string; raw(): number[]; tableau(s: unknown, frame?: number): void };
type Scenario = { name: string; scene: string; maxDiff?: number; ending?: { frames: number[] } };
const scenarios = JSON.parse(readFileSync('tests/visual/scenarios.json', 'utf8')) as Scenario[];
// A scenario with ending.frames is captured once per frame (<name>_f<frame>).
const cases = scenarios.flatMap((s) => (s.ending ? s.ending.frames.map((f) => ({ s, name: `${s.name}_f${f}`, frame: f as number | undefined })) : [{ s, name: s.name, frame: undefined }]));
const OUT = 'test-results/visual';
mkdirSync(OUT, { recursive: true });
const report: Record<string, unknown> = {};

for (const { s, name, frame } of cases) {
  const ref = `reference/captures/${name}.rawng.png`;
  test(`${name} matches the original (480x270, no glow)`, async ({ page }) => {
    test.skip(!existsSync(ref), 'no reference capture (run node scripts/make-harness.mjs)');
    await page.goto('/');
    await page.waitForFunction(() => (window as unknown as { __nb?: NB }).__nb?.scene() === 'boot');
    await page.evaluate(([sc, f]) => (window as unknown as { __nb: NB }).__nb.tableau(sc, f), [s, frame] as const);
    await page.waitForTimeout(2000);
    const raw = await page.evaluate(() => (window as unknown as { __nb: NB }).__nb.raw());
    const ours = new PNG({ width: 480, height: 270 });
    ours.data = Buffer.from(raw);
    const theirs = PNG.sync.read(readFileSync(ref));
    const diff = new PNG({ width: 480, height: 270 });
    const n = pixelmatch(theirs.data, ours.data, diff.data, 480, 270, { threshold: 0.1, includeAA: true });
    writeFileSync(`${OUT}/${name}.ours.png`, PNG.sync.write(ours));
    writeFileSync(`${OUT}/${name}.diff.png`, PNG.sync.write(diff));
    const pct = (100 * n) / (480 * 270);
    report[name] = { differentPixels: n, percent: Number(pct.toFixed(3)) };
    writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
    expect(pct, `${name}: ${n} pixels differ`).toBeLessThanOrEqual(s.maxDiff ?? 0.05);
  });
}
