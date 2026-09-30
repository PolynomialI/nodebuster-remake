// Builds dist/nodebuster.html: one self-contained file that runs when opened
// straight from disk (file://, no server). Chrome won't fetch neighbouring files
// from a file:// page, so the streamed audio (music, ending noise) is inlined as
// data: URIs, and the artifact's body-only page is wrapped in a full document.
// Without an artifact host, saves go to localStorage (src/core/save.ts).
// Run after `npm run build`.
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
let page = readFileSync(join(dist, 'index.html'), 'utf8');
if (page.includes('<head>')) throw new Error('dist/index.html is not packaged yet; run npm run build first');

// Every streamed file's path appears once as a string literal in the bundle
// (the minifier writes it with quotes or backticks).
const { files } = JSON.parse(readFileSync(join(dist, 'files.json'), 'utf8'));
for (const { path } of files) {
  if (!path.endsWith('.ogg')) continue;
  const literal = ['"', "'", '`'].map((q) => q + path + q).find((l) => page.includes(l));
  const count = literal ? page.split(literal).length - 1 : 0;
  if (count !== 1) throw new Error(`expected ${path} once in the bundle, found ${count}`);
  const uri = `data:audio/ogg;base64,${readFileSync(join(dist, path)).toString('base64')}`;
  page = page.replace(literal, () => `"${uri}"`);
}

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
</head>
<body>
${page}
</body>
</html>
`;
const out = join(dist, 'nodebuster.html');
writeFileSync(out, html);
console.log(`dist/nodebuster.html  ${(statSync(out).size / 1024 / 1024).toFixed(2)} MB`);
