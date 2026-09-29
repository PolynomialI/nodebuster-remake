// Serves dist/ for local play and the Playwright tests. index.html is wrapped in
// the same skeleton the artifact host adds, under a CSP as strict as the host's
// (no network, no eval), so anything that would break in the artifact breaks here.
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const port = Number(process.argv[2] ?? 4173);

const SKELETON_HEAD =
  '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover">' +
  '<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}' +
  'body{margin:0;font:14px system-ui,sans-serif;background:#fafaf9}img{max-width:100%}[hidden]{display:none!important}</style></head><body>';
const SKELETON_TAIL = '</body></html>';
const CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' blob:",
  "style-src 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "font-src data:",
  "connect-src 'self' data: blob:",
  "worker-src blob:",
].join('; ');

const TYPES = { '.html': 'text/html; charset=utf-8', '.ogg': 'audio/ogg', '.json': 'application/json', '.png': 'image/png' };

createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
  if (url === '/favicon.ico') {
    res.writeHead(204);
    res.end();
    return;
  }
  if (url === '/' || url === '/index.html') {
    const page = readFileSync(join(root, 'index.html'), 'utf8');
    res.writeHead(200, { 'content-type': TYPES['.html'], 'content-security-policy': CSP, 'cache-control': 'no-store' });
    res.end(SKELETON_HEAD + page + SKELETON_TAIL);
    return;
  }
  const file = normalize(join(root, url));
  if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
  res.end(readFileSync(file));
}).listen(port, '127.0.0.1', () => console.log(`serving dist/ on http://127.0.0.1:${port}/`));
