// The original's look: glow in the 480x270 game image (.raw.png) and the window
// image with CRT (.crt.png) or without (.nocrt.png), compared with the Godot
// harness captures. Glow and CRT are smooth, so these compare mean and 99th
// percentile channel error instead of counting differing pixels. The glow model
// (src/render/post.ts) is fitted to probe captures; it still glows about 3 levels
// more than the original around dense text and thin lines, which the limits allow.
import { expect, test, type Page } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';

type NB = {
  scene(): string;
  raw(): number[];
  tableau(s: unknown, frame?: number): void;
  rawGlow(): number[];
  window(): { w: number; h: number; data: number[] };
  setTime(t: number | null): void;
  setOption(k: string, v: number): void;
};
type Scenario = { name: string; scene: string; time?: number; ending?: unknown; look?: { mean?: number; p99?: number } };
const scenarios = (JSON.parse(readFileSync('tests/visual/scenarios.json', 'utf8')) as (Scenario & { transition?: unknown })[]).filter((s) => !s.ending && !s.transition);
const OUT = 'test-results/look';
mkdirSync(OUT, { recursive: true });

function compare(ref: PNG, data: ArrayLike<number>, w: number, h: number, name: string): { mean: number; p99: number; max: number } {
  const errs = new Uint32Array(256);
  let sum = 0;
  let n = 0;
  const diff = new PNG({ width: w, height: h });
  for (let i = 0; i < w * h; i++) {
    let px = 0;
    for (let k = 0; k < 3; k++) {
      const e = Math.abs(ref.data[i * 4 + k] - data[i * 4 + k]);
      errs[e]++;
      sum += e;
      n++;
      px = Math.max(px, e);
    }
    diff.data[i * 4] = Math.min(255, px * 8);
    diff.data[i * 4 + 1] = diff.data[i * 4 + 2] = 0;
    diff.data[i * 4 + 3] = 255;
  }
  writeFileSync(`${OUT}/${name}.diff.png`, PNG.sync.write(diff));
  let acc = 0;
  let p99 = 0;
  for (let e = 0; e < 256; e++) {
    acc += errs[e];
    if (acc >= n * 0.99) {
      p99 = e;
      break;
    }
  }
  let max = 0;
  for (let e = 255; e >= 0; e--)
    if (errs[e]) {
      max = e;
      break;
    }
  return { mean: sum / n, p99, max };
}

async function build(page: Page, s: Scenario, opts: Record<string, number>): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => (window as unknown as { __nb?: NB }).__nb?.scene() === 'boot');
  await page.evaluate(
    ([sc, o]) => {
      const nb = (window as unknown as { __nb: NB }).__nb;
      nb.setTime((sc as Scenario).time ?? 1);
      // The tableau resets options to the harness's options.dat; the CRT choice comes after.
      nb.tableau(sc);
      for (const [k, v] of Object.entries(o)) nb.setOption(k, v);
    },
    [s, opts] as const,
  );
  await page.waitForTimeout(1500);
}

const report: Record<string, unknown> = {};
for (const s of scenarios) {
  for (const kind of ['raw', 'crt', 'nocrt'] as const) {
    const ref = `reference/captures/${s.name}.${kind}.png`;
    test(`${s.name} ${kind} looks like the original`, async ({ page }) => {
      test.skip(!existsSync(ref), 'no reference capture');
      await build(page, s, { crt_effect: kind === 'nocrt' ? 1 : 0 });
      const theirs = PNG.sync.read(readFileSync(ref));
      let r;
      if (kind === 'raw') {
        const data = await page.evaluate(() => (window as unknown as { __nb: NB }).__nb.rawGlow());
        const base = new PNG({ width: 480, height: 270 });
        base.data = Buffer.from(await page.evaluate(() => (window as unknown as { __nb: NB }).__nb.raw()));
        writeFileSync(`${OUT}/${s.name}.rawng.ours.png`, PNG.sync.write(base));
        const png = new PNG({ width: 480, height: 270 });
        png.data = Buffer.from(data);
        writeFileSync(`${OUT}/${s.name}.raw.ours.png`, PNG.sync.write(png));
        r = compare(theirs, data, 480, 270, `${s.name}.raw`);
      } else {
        const win = await page.evaluate(() => (window as unknown as { __nb: NB }).__nb.window());
        expect([win.w, win.h]).toEqual([theirs.width, theirs.height]);
        const png = new PNG({ width: win.w, height: win.h });
        png.data = Buffer.from(win.data);
        writeFileSync(`${OUT}/${s.name}.${kind}.ours.png`, PNG.sync.write(png));
        r = compare(theirs, win.data, win.w, win.h, `${s.name}.${kind}`);
      }
      report[`${s.name}.${kind}`] = r;
      writeFileSync(`${OUT}/report-${s.name}-${kind}.json`, JSON.stringify(r));
      const limit = kind === 'crt' ? { mean: 3, p99: 14 } : { mean: 2, p99: 10 };
      expect(r.mean, `${s.name} ${kind}: mean channel error`).toBeLessThanOrEqual(s.look?.mean ?? limit.mean);
      expect(r.p99, `${s.name} ${kind}: 99th percentile channel error`).toBeLessThanOrEqual(s.look?.p99 ?? limit.p99);
    });
  }
}
