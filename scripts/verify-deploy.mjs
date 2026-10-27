// SPDX-License-Identifier: AGPL-3.0-only
// After a production deploy: checks the LIVE site, not the build (SEC-04, INF-01).
//   node scripts/verify-deploy.mjs https://<project>.pages.dev/ [dist]
// Waits until the live build.json matches dist/build.json and the edge stops answering 5xx, then checks the security
// headers against hosting/_headers, the content types that pdf.js needs, and that _headers itself is not served.
// No dependencies; Node.js 22+ (global fetch).
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parseHeaders } from './serve.mjs';

const [base, dist = 'dist'] = process.argv.slice(2);
// http is accepted only for a local server (testing this script against scripts/serve.mjs)
if (!/^(https:\/\/[^/]+|http:\/\/(127\.0\.0\.1|localhost):\d+)\/$/.test(base || '')) throw new Error('Usage: verify-deploy.mjs https://host/ [dist]');
const want = JSON.parse(await readFile(join(dist, 'build.json'), 'utf8')).version;
const expected = parseHeaders(await readFile(join(dist, '_headers'), 'utf8')).find(r => r.path === '/*').headers;
const wasm = (await readdir(join(dist, 'vendor/pdfjs/wasm'))).find(f => f.endsWith('.wasm'));

const problems = [];
// In GitHub Actions a failure is also printed as an annotation, so it shows on the run page without opening the log.
const gha = !!process.env.GITHUB_ACTIONS;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) { problems.push(what); if (gha) console.log(`::error title=Live site check::${what}`); } };
const get = (path) => fetch(new URL(path, base), { cache: 'no-store', redirect: 'manual' });
// Right after the first deploy of a project, Cloudflare's edge answers some paths with 5xx (seen: 522) for a short
// while. Those are retried for up to 3 minutes; any other answer is final.
async function getSettled(path) {
  let r;
  for (let i = 0; i < 36; i++) {
    try { r = await get(path); if (r.status < 500) return r; } catch (e) { r = null; }
    await new Promise(res => setTimeout(res, 5000));
  }
  return r || { status: 0, headers: new Headers(), text: async () => '' };
}

let live = null;
for (let i = 0; i < 24 && live !== want; i++) {
  if (i) await new Promise(r => setTimeout(r, 5000));
  try { live = (await (await get('build.json')).json()).version; } catch { live = null; }
}
check(live === want, `live version ${live} = built version ${want}`);

const page = await getSettled('');
check(page.status === 200, `GET / → ${page.status}`);
for (const [name, value] of Object.entries(expected)) check(page.headers.get(name) === value, `${name}: ${page.headers.get(name)}`);
check(!page.headers.has('access-control-allow-origin'), 'no Access-Control-Allow-Origin');

const types = { 'src/app.js': /^text\/javascript|^application\/javascript/, 'vendor/pdfjs/pdf.min.mjs': /^text\/javascript|^application\/javascript/,
  'vendor/pdfjs/pdf.worker.min.mjs': /^text\/javascript|^application\/javascript/, [`vendor/pdfjs/wasm/${wasm}`]: /^application\/wasm/,
  'manifest.webmanifest': /^application\/manifest\+json|^application\/json/, 'sw.js': /^text\/javascript|^application\/javascript/ };
for (const [path, re] of Object.entries(types)) {
  const r = await getSettled(path);
  check(r.status === 200 && re.test(r.headers.get('content-type') || ''), `${path} → ${r.status} ${r.headers.get('content-type')}`);
}
check(/no-cache/.test((await getSettled('sw.js')).headers.get('cache-control') || ''), 'sw.js is revalidated (Cache-Control: no-cache)');
const hidden = await getSettled('_headers');
check(hidden.status === 404 || !(await hidden.text()).includes('Content-Security-Policy'), `_headers is not served (${hidden.status})`);

if (problems.length) { console.error(`\n${problems.length} problem(s) on the live site.`); process.exit(1); }
console.log('\nLive site matches the build and the header policy.');
