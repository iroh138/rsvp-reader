// SPDX-License-Identifier: AGPL-3.0-only
// SEC-04: production HTTP headers (hosting/_headers, Cloudflare Pages format). The browser side is tested by
// tests/e2e/csp.py; this guards the file itself against weakening and against Cloudflare's format limits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseHeaders } from '../scripts/serve.mjs';

const text = readFileSync(new URL('../hosting/_headers', import.meta.url), 'utf8');
const rules = parseHeaders(text);
const all = rules.find(r => r.path === '/*').headers;
const csp = Object.fromEntries(all['Content-Security-Policy'].split(';').map(d => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));

test('within Cloudflare Pages limits (100 rules, 2000 characters per line)', () => {
  assert.ok(rules.length <= 100);
  for (const line of text.split('\n')) assert.ok(line.length <= 2000);
});

test('CSP: nothing from other origins, no inline script, no eval, no framing', () => {
  assert.deepEqual(csp['default-src'], ["'none'"]);
  assert.deepEqual(csp['script-src'], ["'self'", "'wasm-unsafe-eval'"]);
  for (const [k, v] of Object.entries(csp)) {
    for (const src of v) {
      assert.ok(!["'unsafe-inline'", "'unsafe-eval'", '*', 'https:', 'http:'].includes(src), `${k} ${src}`);
      assert.ok(!/^(https?:)?\/\//.test(src), `${k} allows another origin: ${src}`);
    }
  }
  for (const k of ['connect-src', 'worker-src', 'style-src', 'font-src']) assert.deepEqual(csp[k], ["'self'"], k);
  for (const k of ['frame-ancestors', 'object-src', 'base-uri', 'form-action']) assert.deepEqual(csp[k], ["'none'"], k);
});

test('other security headers are set', () => {
  assert.match(all['Strict-Transport-Security'], /max-age=\d{8,}/);
  assert.equal(all['X-Content-Type-Options'], 'nosniff');
  assert.equal(all['Referrer-Policy'], 'no-referrer');
  assert.equal(all['X-Frame-Options'], 'DENY');
  assert.equal(all['Cross-Origin-Opener-Policy'], 'same-origin');
  assert.match(all['Permissions-Policy'], /camera=\(\)/);
});

test('the service worker is always revalidated', () => {
  assert.equal(rules.find(r => r.path === '/sw.js').headers['Cache-Control'], 'no-cache');
});
