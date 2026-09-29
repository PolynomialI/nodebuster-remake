// Side-by-side for inspection: original | remake | diff, cropped and upscaled.
// node scripts/sbs.mjs <name> [x y w h] [scale]
import { PNG } from 'pngjs';
import { readFileSync, writeFileSync } from 'node:fs';
const [name, x0 = 0, y0 = 0, w = 480, h = 270, sc = 2] = process.argv.slice(2).map((v, i) => (i ? Number(v) : v));
const imgs = [`reference/captures/${name}.rawng.png`, `test-results/visual/${name}.ours.png`, `test-results/visual/${name}.diff.png`].map((f) => PNG.sync.read(readFileSync(f)));
const out = new PNG({ width: (w * sc + 4) * 3, height: h * sc });
for (let k = 0; k < 3; k++)
  for (let y = 0; y < h * sc; y++)
    for (let x = 0; x < w * sc; x++) {
      const src = imgs[k];
      const i = ((y0 + Math.floor(y / sc)) * src.width + x0 + Math.floor(x / sc)) * 4;
      const o = (y * out.width + k * (w * sc + 4) + x) * 4;
      out.data.set(src.data.slice(i, i + 4), o);
    }
writeFileSync(`test-results/visual/${name}.sbs.png`, PNG.sync.write(out));
