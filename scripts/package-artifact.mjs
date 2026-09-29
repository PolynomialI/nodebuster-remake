// Turns Vite's dist/index.html into the form the Claude artifact host expects:
// no <!doctype>/<html>/<head>/<body> of its own (the host wraps the page in its
// skeleton), with <title> and <style> first, then the body, then the scripts.
// Also checks the size limits: every file <= 16 MB, whole build <= 25 MB.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const html = readFileSync(join(dist, 'index.html'), 'utf8');

// Walk the head the way a browser tokenizes it: a <script> or <style> ends at
// the first matching close tag.
function takeElements(section) {
  const found = [];
  const re = /<(title|style|script|meta|link)\b[^>]*>/gi;
  let m;
  while ((m = re.exec(section))) {
    const tag = m[1].toLowerCase();
    if (tag === 'meta' || tag === 'link') continue;
    const close = section.indexOf(`</${tag}>`, re.lastIndex);
    if (close < 0) throw new Error(`Unclosed <${tag}> in dist/index.html`);
    found.push({ tag, text: section.slice(m.index, close + tag.length + 3) });
    re.lastIndex = close + tag.length + 3;
  }
  return found;
}

const headStart = html.indexOf('<head>');
const headEnd = html.indexOf('</head>');
const bodyOpen = html.indexOf('<body');
const bodyStart = html.indexOf('>', bodyOpen) + 1;
const bodyEnd = html.lastIndexOf('</body>');
if (headStart < 0 || headEnd < 0 || bodyOpen < 0 || bodyEnd < 0) throw new Error('dist/index.html has no head/body; was it already packaged?');

const head = takeElements(html.slice(headStart + 6, headEnd));
const pick = (t) => head.filter((e) => e.tag === t).map((e) => e.text);
const title = pick('title');
if (title.length !== 1) throw new Error('dist/index.html needs exactly one <title>');
const page = [...title, ...pick('style'), html.slice(bodyStart, bodyEnd).trim(), ...pick('script')].join('\n');
writeFileSync(join(dist, 'index.html'), page + '\n');

// Size report.
const MB = 1024 * 1024;
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else files.push({ path: relative(dist, p).replaceAll('\\', '/'), size: statSync(p).size });
  }
})(dist);
files.sort((a, b) => a.path.localeCompare(b.path));
let total = 0;
for (const f of files) {
  total += f.size;
  if (f.size > 16 * MB) throw new Error(`${f.path} is ${(f.size / MB).toFixed(2)} MB, over the 16 MB per-file limit`);
}
if (total > 25 * MB) throw new Error(`Build is ${(total / MB).toFixed(2)} MB, over the 25 MB budget`);
writeFileSync(join(dist, 'files.json'), JSON.stringify({ totalBytes: total, files }, null, 2) + '\n');
for (const f of files) console.log(`${(f.size / 1024).toFixed(0).padStart(8)} KB  ${f.path}`);
console.log(`${(total / MB).toFixed(2).padStart(8)} MB  total (${files.length} files)`);
