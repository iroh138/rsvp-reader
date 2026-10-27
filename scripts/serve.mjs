// SPDX-License-Identifier: AGPL-3.0-only
// Minimal static server for local testing of dist/ (or another folder: node scripts/serve.mjs <dir> <port>).
// Binds to localhost only. Not for production.
// If the folder has a _headers file (hosting/_headers, Cloudflare Pages format), its "/*" rules and exact-path
// rules are applied, so browser tests run under the production Content-Security-Policy.
// It also redirects index.html to the directory URL the way Cloudflare Pages does.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(process.argv[2] || fileURLToPath(new URL('../dist', import.meta.url)));
const port = Number(process.argv[3] || 8080);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.wasm': 'application/wasm', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.pdf': 'application/pdf' };

// Returns [{ path, headers: { name: value } }]. Host patterns, other wildcards and "! Name" removals are ignored here.
export function parseHeaders(text) {
  const rules = [];
  let cur = null;
  for (const line of text.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) { cur = { path: line.trim(), headers: {} }; rules.push(cur); continue; }
    const m = /^\s+([A-Za-z0-9-]+):\s*(.*)$/.exec(line);
    if (m && cur) cur.headers[m[1]] = m[2].trim();
  }
  return rules;
}
let rules = [];
try { rules = parseHeaders(readFileSync(join(root, '_headers'), 'utf8')); } catch {}
const headersFor = (urlPath) => Object.assign({}, ...rules.filter(r => r.path === '/*' || r.path === urlPath).map(r => r.headers));

if (import.meta.url === `file://${process.argv[1]}`) createServer(async (req, res) => {
  const urlPath = new URL(req.url, 'http://x').pathname;
  const path = normalize(decodeURIComponent(urlPath)).replace(/^([/\\])+/, '');
  const file = join(root, path || 'index.html');
  if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
  if (path === '_headers') { res.writeHead(404).end('Not found'); return; }   // Pages does not serve it either
  // Like Cloudflare Pages: /index.html (and /dir/index.html) answers 308 to the directory URL. A service worker that
  // caches 'index.html' then holds a redirected response, which Chrome refuses for page loads (ERR_FAILED).
  if (/(^|\/)index\.html$/.test(path)) { res.writeHead(308, { Location: '/' + path.replace(/index\.html$/, '') + new URL(req.url, 'http://x').search }).end(); return; }
  try {
    const body = await readFile(file.endsWith('/') ? join(file, 'index.html') : file);
    // Same headers as production (browsers ignore Strict-Transport-Security on plain http).
    res.writeHead(200, { ...headersFor(urlPath), 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
    res.end(body);
  } catch { res.writeHead(404).end('Not found'); }
}).listen(port, '127.0.0.1', () => console.log(`Serving ${root} on http://localhost:${port}${rules.length ? ' (with _headers)' : ''}`));
